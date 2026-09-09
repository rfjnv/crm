import { Router, Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_ANALYTICS_LINE_REVENUE_DI,
} from '../../lib/analytics';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';

const router = Router();
router.use(authenticate);

const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;

/**
 * Рабочий день компании — те же числа, что показывает страница «Посещаемость»:
 * начало 09:00, допуск 15 минут. Допуск не дробится: пришёл в 9:16 — опоздание
 * считается все 16 минут от 09:00, а не одна минута сверх допуска.
 */
const WORK_START_MIN = 9 * 60;
const GRACE_MIN = 15;
const LATE_THRESHOLD_MIN = WORK_START_MIN + GRACE_MIN;

/**
 * Перерыв, после которого покупка считается возвратом клиента.
 *
 * 60, а не 30: часть постоянных клиентов закупается раз в месяц, и при 30 днях
 * обычная пауза между их покупками уже засчитывалась как «вернулся».
 */
const RETURN_GAP_DAYS = 60;

/**
 * Лид засчитывается, если клиент купил в течение этого срока ПОСЛЕ контакта.
 */
const LEAD_WINDOW_DAYS = 14;

/**
 * Клиент, купивший в эти дни ДО контакта, лидом не считается: он и так покупал,
 * это не привлечение. Главный барьер против накрутки — см. запрос лидов ниже.
 */
const LEAD_RECENT_BUYER_DAYS = 30;

/**
 * Внутренняя компания: её сотрудники не участвуют в KPI отдела продаж.
 * Тот же фильтр уже применяется к списку менеджеров для клиента в Telegram-сервисе.
 */
const INTERNAL_COMPANY = 'grand-astra';

/** Без продаж столько дней — товар считается мёртвым (как на странице «Мёртвые товары»). */
const DEAD_NO_SALES_DAYS = 90;

/** Границы месяца по календарю Ташкента как UTC-моменты. */
function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - TASHKENT_OFFSET),
    end: new Date(Date.UTC(year, month, 1) - TASHKENT_OFFSET),
  };
}

function parsePeriod(req: Request): { year: number; month: number } {
  const nowTk = new Date(Date.now() + TASHKENT_OFFSET);
  const year = Number(req.query.year) || nowTk.getUTCFullYear();
  const month = Number(req.query.month) || nowTk.getUTCMonth() + 1;
  if (!Number.isInteger(year) || year < 2020 || year > 2099) throw new AppError(400, 'Некорректный год');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new AppError(400, 'Некорректный месяц');
  return { year, month };
}

/** Минуты от начала дня по Ташкенту. */
function minutesOfDayTashkent(d: Date): number {
  const t = new Date(d.getTime() + TASHKENT_OFFSET);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/** Рабочих дней в месяце: понедельник–пятница, выходные не в счёт. */
function workdaysInMonth(year: number, month: number): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= days; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

/**
 * «Семья» товара для группировки в топе: у большинства менеджеров весь топ
 * занимает самоклейка разных форматов, и список превращается в «самоклейка,
 * самоклейка, самоклейка». Убираем размеры, числа и единицы, берём первое слово.
 */
function productFamily(name: string): string {
  const cleaned = name
    .replace(/d+([.,]d+)?s*[xх*]s*d+([.,]d+)?(s*[xх*]s*d+([.,]d+)?)?/gi, ' ')
    .replace(/d+([.,]d+)?s*(мкм|мм|см|м|кг|гр|г|л)/gi, ' ')
    .replace(/[d]+/g, ' ')
    .replace(/[-–—/:(),."]+/g, ' ')
    .replace(/s+/g, ' ')
    .trim();
  // Два слова, а не одно: «Самоклеящаяся» и «Уф» читаются как обрубки, нужно
  // «Самоклеящаяся бумага» и «УФ лаки». Регистр НЕ трогаем — иначе аббревиатуры
  // («УФ», «CTCP») превращаются в «Уф» и «Ctcp».
  const all = cleaned.split(' ').filter(Boolean);
  // Если второе слово служебное («Химия и …»), берём третье — иначе выходит обрубок.
  const STOP = new Set(['и', 'для', 'с', 'на', 'по', 'из', 'от']);
  const take = all[1] && STOP.has(all[1].toLowerCase()) ? 3 : 2;
  const label = all.slice(0, take).join(' ');
  return label || name.trim() || 'Без названия';
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return map;
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role as Role;
    const isManager = role === 'MANAGER';
    if (!isManager && role !== 'ADMIN' && role !== 'SUPER_ADMIN' && role !== 'HR') {
      throw new AppError(403, 'Недостаточно прав');
    }

    const { year, month } = parsePeriod(req);
    const { start, end } = monthBounds(year, month);

    /** Менеджер видит только себя; админ может сузить выборку до одного человека. */
    const onlyUserId = isManager
      ? req.user!.userId
      : (typeof req.query.managerId === 'string' && req.query.managerId) || null;
    const userFilter = onlyUserId ? Prisma.sql` AND d.manager_id = ${onlyUserId}` : Prisma.empty;

    const managers = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(onlyUserId ? { id: onlyUserId } : { role: { in: ['MANAGER', 'ADMIN'] } }),
        OR: [{ companyId: null }, { company: { name: { not: INTERNAL_COMPANY } } }],
      },
      select: { id: true, fullName: true, department: true },
      orderBy: { fullName: 'asc' },
    });
    const ids = managers.map((m) => m.id);
    if (ids.length === 0) {
      res.json({ period: { year, month }, rows: [] });
      return;
    }

    const deadCutoff = new Date(start.getTime() - DEAD_NO_SALES_DAYS * 86400000);

    const [goals, factRaw, assortRaw, deadRaw, clientNotesRaw, boardRaw, clientsRaw, leadsRaw, attendance] =
      await Promise.all([
        // ──── 1. План на месяц (модель уже есть — та же, что в «Пользователях») ────
        prisma.userMonthlyGoal.findMany({
          where: { userId: { in: ids }, year, month },
          select: { userId: true, revenueTarget: true, dealsTarget: true, callNotesTarget: true },
        }),
        prisma.$queryRaw<{ manager_id: string; revenue: string; deals: string }[]>(
          Prisma.sql`SELECT d.manager_id,
             COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text as revenue,
             COUNT(DISTINCT d.id)::text as deals
           FROM deal_items di
           JOIN deals d ON d.id = di.deal_id
           WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
             AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${start}
             AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${end}${userFilter}
           GROUP BY d.manager_id`,
        ),

        // ──── 2. Ассортимент ────
        prisma.$queryRaw<{
          manager_id: string; product_id: string; name: string; unit: string;
          category: string; qty: string; revenue: string;
        }[]>(
          Prisma.sql`SELECT d.manager_id, p.id as product_id, p.name,
             COALESCE(p.unit, 'шт.') as unit,
             COALESCE(NULLIF(TRIM(p.category), ''), 'Без категории') as category,
             COALESCE(SUM(di.requested_qty), 0)::text as qty,
             COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text as revenue
           FROM deal_items di
           JOIN deals d ON d.id = di.deal_id
           JOIN products p ON p.id = di.product_id
           WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
             AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${start}
             AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${end}
             AND COALESCE(di.requested_qty, 0) > 0${userFilter}
           GROUP BY d.manager_id, p.id, p.name, p.unit, 5`,
        ),
        // Мёртвость определяем на МОМЕНТ НАЧАЛА месяца: иначе товар, поднятый как раз
        // этой продажей, уже не выглядел бы мёртвым и заслуга не засчиталась бы.
        prisma.$queryRaw<{
          manager_id: string; product_id: string; name: string; unit: string; qty: string; revenue: string;
        }[]>(
          Prisma.sql`WITH sold AS (
             SELECT d.manager_id, di.product_id,
               SUM(di.requested_qty) as qty,
               SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}) as revenue
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${end}
               AND COALESCE(di.requested_qty, 0) > 0${userFilter}
             GROUP BY d.manager_id, di.product_id
           ),
           last_before AS (
             SELECT di.product_id, MAX(${SQL_EFFECTIVE_REVENUE_ITEM_TS}) as last_ts
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${start}
               AND COALESCE(di.requested_qty, 0) > 0
             GROUP BY di.product_id
           )
           SELECT s.manager_id, s.product_id, p.name,
             COALESCE(p.unit, 'шт.') as unit,
             s.qty::text as qty, s.revenue::text as revenue
           FROM sold s
           JOIN products p ON p.id = s.product_id
           LEFT JOIN last_before lb ON lb.product_id = s.product_id
           -- Товар должен был существовать до отсечки: иначе только что заведённая
           -- позиция засчитывалась бы как «оживлённая», хотя оживлять нечего.
           WHERE p.created_at < ${deadCutoff}
             AND (lb.last_ts IS NULL OR lb.last_ts < ${deadCutoff})`,
        ),

        // ──── 3. Звонки и контакты: полная заметка клиента + строка доски звонков ────
        prisma.$queryRaw<{ user_id: string; total: string; clients: string; last_at: Date | null }[]>(
          Prisma.sql`SELECT cn.user_id, COUNT(*)::text as total,
             COUNT(DISTINCT cn.client_id)::text as clients,
             MAX(cn.created_at) as last_at
           FROM client_notes cn
           WHERE cn.deleted_at IS NULL
             AND cn.created_at >= ${start} AND cn.created_at < ${end}
             AND cn.user_id IN (${Prisma.join(ids)})
           GROUP BY cn.user_id`,
        ),
        prisma.$queryRaw<{ author_id: string; total: string; clients: string; last_at: Date | null }[]>(
          Prisma.sql`SELECT nb.author_id, COUNT(*)::text as total,
             COUNT(DISTINCT nb.client_id)::text as clients,
             MAX(nb.last_call_at) as last_at
           FROM notes_board_rows nb
           WHERE nb.last_call_at >= ${start} AND nb.last_call_at < ${end}
             AND nb.author_id IN (${Prisma.join(ids)})
           GROUP BY nb.author_id`,
        ),

        // ──── 4. Привлечение: когда этот клиент покупал в предыдущий раз ────
        prisma.$queryRaw<{
          manager_id: string; client_id: string; first_ts: Date; prev_ts: Date | null;
        }[]>(
          Prisma.sql`WITH served AS (
             SELECT d.manager_id, d.client_id, MIN(${SQL_EFFECTIVE_REVENUE_ITEM_TS}) as first_ts
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${end}${userFilter}
             GROUP BY d.manager_id, d.client_id
           ),
           prev AS (
             SELECT d.client_id, MAX(${SQL_EFFECTIVE_REVENUE_ITEM_TS}) as prev_ts
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${start}
             GROUP BY d.client_id
           )
           SELECT s.manager_id, s.client_id, s.first_ts, p.prev_ts
           FROM served s
           LEFT JOIN prev p ON p.client_id = s.client_id`,
        ),

        // ──── 6. Лиды: контакт → покупка ────
        //
        // Защита от накрутки встроена в сам запрос:
        //  1. считаем УНИКАЛЬНЫХ клиентов, а не заметки — спам заметок не помогает;
        //  2. берём только ПЕРВЫЙ контакт с клиентом в периоде;
        //  3. покупка засчитывается, только если она строго ПОСЛЕ контакта
        //     (created_at заметки проставляет сервер, задним числом не поставить);
        //  4. клиент, купивший незадолго ДО контакта, лидом не считается вовсе —
        //     иначе достаточно обзвонить тех, кто и так покупает каждый месяц.
        prisma.$queryRaw<{ manager_id: string; leads: string; converted: string }[]>(
          Prisma.sql`WITH contacts AS (
             SELECT cn.user_id AS manager_id, cn.client_id, MIN(cn.created_at) AS at
             FROM client_notes cn
             WHERE cn.deleted_at IS NULL
               AND cn.created_at >= ${start} AND cn.created_at < ${end}
               AND cn.user_id IN (${Prisma.join(ids)})
             GROUP BY cn.user_id, cn.client_id
             UNION ALL
             SELECT nb.author_id, nb.client_id, MIN(nb.last_call_at)
             FROM notes_board_rows nb
             WHERE nb.last_call_at >= ${start} AND nb.last_call_at < ${end}
               AND nb.author_id IN (${Prisma.join(ids)})
             GROUP BY nb.author_id, nb.client_id
           ),
           first_contact AS (
             SELECT manager_id, client_id, MIN(at) AS contact_at
             FROM contacts GROUP BY manager_id, client_id
           ),
           scored AS (
             SELECT fc.manager_id, fc.client_id,
               EXISTS (
                 SELECT 1 FROM deal_items di JOIN deals d ON d.id = di.deal_id
                 WHERE d.client_id = fc.client_id
                   AND ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
                   AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} > fc.contact_at
                   AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} <= fc.contact_at + (${LEAD_WINDOW_DAYS} * INTERVAL '1 day')
               ) AS converted,
               EXISTS (
                 SELECT 1 FROM deal_items di JOIN deals d ON d.id = di.deal_id
                 WHERE d.client_id = fc.client_id
                   AND ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
                   AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < fc.contact_at
                   AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= fc.contact_at - (${LEAD_RECENT_BUYER_DAYS} * INTERVAL '1 day')
               ) AS recent_buyer
             FROM first_contact fc
           )
           SELECT manager_id,
             COUNT(*)::text as leads,
             COUNT(*) FILTER (WHERE converted)::text as converted
           FROM scored
           WHERE NOT recent_buyer
           GROUP BY manager_id`,
        ),

        // ──── 5. Посещаемость ────
        prisma.attendanceRecord.findMany({
          where: {
            userId: { in: ids },
            date: {
              gte: new Date(Date.UTC(year, month - 1, 1)),
              lt: new Date(Date.UTC(year, month, 1)),
            },
          },
          select: { userId: true, checkIn: true },
        }),
      ]);

    const goalMap = new Map(goals.map((g) => [g.userId, g]));
    const factMap = new Map(factRaw.map((f) => [f.manager_id, f]));
    const assortByManager = groupBy(assortRaw, (r) => r.manager_id);
    const deadByManager = groupBy(deadRaw, (r) => r.manager_id);
    const notesMap = new Map(clientNotesRaw.map((r) => [r.user_id, r]));
    const boardMap = new Map(boardRaw.map((r) => [r.author_id, r]));
    const clientsByManager = groupBy(clientsRaw, (r) => r.manager_id);
    const attByManager = groupBy(attendance, (r) => r.userId);
    const leadsMap = new Map(leadsRaw.map((r) => [r.manager_id, r]));
    const workdays = workdaysInMonth(year, month);

    const rows = managers.map((m) => {
      const goal = goalMap.get(m.id);
      const fact = factMap.get(m.id);
      const revenueFact = fact ? Number(fact.revenue) : 0;
      const revenueTarget = goal?.revenueTarget != null ? Number(goal.revenueTarget) : null;

      const items = assortByManager.get(m.id) ?? [];
      const byCategory = new Map<string, { qty: number; revenue: number }>();
      for (const it of items) {
        const c = byCategory.get(it.category) ?? { qty: 0, revenue: 0 };
        c.qty += Number(it.qty);
        c.revenue += Number(it.revenue);
        byCategory.set(it.category, c);
      }
      const dead = deadByManager.get(m.id) ?? [];

      const notes = notesMap.get(m.id);
      const board = boardMap.get(m.id);
      const clientNotes = notes ? Number(notes.total) : 0;
      const boardCalls = board ? Number(board.total) : 0;
      const lastContact = [notes?.last_at, board?.last_at]
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

      let newClients = 0;
      let returned = 0;
      let regular = 0;
      for (const c of clientsByManager.get(m.id) ?? []) {
        if (!c.prev_ts) { newClients += 1; continue; }
        const gapDays = (c.first_ts.getTime() - c.prev_ts.getTime()) / 86400000;
        if (gapDays >= RETURN_GAP_DAYS) returned += 1;
        else regular += 1;
      }
      const served = newClients + returned + regular;

      const att = attByManager.get(m.id) ?? [];
      let onTime = 0;
      let late = 0;
      let lateMinutes = 0;
      let absent = 0;
      for (const a of att) {
        if (!a.checkIn) { absent += 1; continue; }
        const minute = minutesOfDayTashkent(a.checkIn);
        if (minute <= LATE_THRESHOLD_MIN) onTime += 1;
        else {
          late += 1;
          // Допуск сгорает целиком: считаем от 09:00, а не от 09:15.
          lateMinutes += minute - WORK_START_MIN;
        }
      }

      return {
        managerId: m.id,
        fullName: m.fullName,
        department: m.department ?? null,
        plan: {
          revenueTarget,
          dealsTarget: goal?.dealsTarget ?? null,
          callNotesTarget: goal?.callNotesTarget ?? null,
          revenueFact,
          dealsFact: fact ? Number(fact.deals) : 0,
          revenuePercent: revenueTarget && revenueTarget > 0 ? revenueFact / revenueTarget : null,
        },
        assortment: {
          positions: items.length,
          totalQty: items.reduce((s, i) => s + Number(i.qty), 0),
          topProducts: [...items]
            .sort((a, b) => Number(b.revenue) - Number(a.revenue))
            .slice(0, 5)
            .map((i) => ({
              productId: i.product_id,
              name: i.name,
              unit: i.unit,
              qty: Number(i.qty),
              revenue: Number(i.revenue),
            })),
          /** Тот же топ, но свёрнутый по «семье» товара — чтобы самоклейка не занимала весь список. */
          topGroups: [...groupBy(items, (i) => productFamily(i.name)).entries()]
            .map(([family, list]) => ({
              family,
              qty: list.reduce((s, i) => s + Number(i.qty), 0),
              revenue: list.reduce((s, i) => s + Number(i.revenue), 0),
              products: [...list]
                .sort((a, b) => Number(b.revenue) - Number(a.revenue))
                .map((i) => ({
                  productId: i.product_id,
                  name: i.name,
                  unit: i.unit,
                  qty: Number(i.qty),
                  revenue: Number(i.revenue),
                })),
            }))
            .sort((a, b) => b.revenue - a.revenue),
          byCategory: [...byCategory.entries()]
            .map(([category, v]) => ({ category, qty: v.qty, revenue: v.revenue }))
            .sort((a, b) => b.revenue - a.revenue),
          deadSold: {
            count: dead.length,
            qty: dead.reduce((s, d) => s + Number(d.qty), 0),
            revenue: dead.reduce((s, d) => s + Number(d.revenue), 0),
            products: [...dead]
              .sort((a, b) => Number(b.revenue) - Number(a.revenue))
              .slice(0, 5)
              .map((d) => ({
                productId: d.product_id,
                name: d.name,
                unit: d.unit,
                qty: Number(d.qty),
                revenue: Number(d.revenue),
              })),
          },
        },
        contacts: {
          clientNotes,
          boardCalls,
          total: clientNotes + boardCalls,
          uniqueClients: Math.max(
            notes ? Number(notes.clients) : 0,
            board ? Number(board.clients) : 0,
          ),
          lastContactAt: lastContact ? lastContact.toISOString() : null,
        },
        clients: { served, new: newClients, returned, regular },
        leads: {
          /** Уникальные клиенты, с которыми связались и которые до этого не покупали ≥30 дней. */
          contacted: leadsMap.get(m.id) ? Number(leadsMap.get(m.id)!.leads) : 0,
          converted: leadsMap.get(m.id) ? Number(leadsMap.get(m.id)!.converted) : 0,
          windowDays: LEAD_WINDOW_DAYS,
        },
        attendance: {
          /** Рабочих дней в месяце (пн–пт), выходные исключены. */
          workdays,
          days: att.length,
          onTime,
          late,
          lateMinutes,
          absent,
        },
      };
    });

    res.json({ period: { year, month }, rows });
  }),
);

export { router as managerKpiRoutes };
