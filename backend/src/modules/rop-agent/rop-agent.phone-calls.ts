import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';

/**
 * Звонки менеджеров с рабочих телефонов (раздел «Звонки», CallSync): сколько звонили,
 * сколько состоялось разговоров, минуты, пропущенные и кому не перезвонили. Считается
 * так же, как в журнале звонков: удалённые (личные) звонки и служебные номера не в счёт,
 * «пропущенный» — входящий missed/rejected с известным номером, «перезвонили» — после
 * него был разговор с этим номером (follow_up_at) или менеджер отметил «Перезвонил».
 */

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const tkToday = () => ymd(new Date(Date.now() + 5 * 3600_000));
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Разговор состоялся — как в журнале звонков. */
const TALKED = Prisma.sql`(COALESCE(cs.bill_sec, 0) > 0 OR cs.answered_at IS NOT NULL
  OR (cs.mobile_type IN ('out', 'in') AND COALESCE(cs.duration_sec, 0) > 0))`;
const TALK_SEC = Prisma.sql`COALESCE(NULLIF(cs.bill_sec, 0), cs.duration_sec, 0)`;
const MISSED = Prisma.sql`(cs.direction = 'INBOUND' AND cs.status = 'MISSED' AND cs.phone_key IS NOT NULL
  AND (cs.mobile_type IS NULL OR cs.mobile_type IN ('missed', 'rejected')))`;
const NOT_CALLED_BACK = Prisma.sql`(cs.follow_up_at IS NULL AND cs.called_back_at IS NULL)`;
const NOT_SERVICE = Prisma.sql`(cs.phone_key IS NULL OR cs.phone_key NOT IN (SELECT phone_key FROM service_phones))`;

export type PhoneCallsInput = { date_from?: string; date_to?: string; days?: number; manager_id?: string };

export type ManagerCallsRow = {
  manager_id: string;
  manager: string;
  calls: number;
  outgoing: number;
  incoming: number;
  talked: number;
  talk_min: number;
  clients_talked: number;
  missed: number;
  missed_not_called_back: number;
};

/** Период: date_from…date_to (включительно, по Ташкенту) или последние N дней по сегодня. */
function period(input: PhoneCallsInput): { from: string; to: string } {
  const to = isYmd(input.date_to) ? input.date_to : tkToday();
  const days = Math.min(Math.max(Math.round(input.days ?? 7), 1), 92);
  const from = isYmd(input.date_from) ? input.date_from : ymd(new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY));
  return { from, to };
}

export async function managerCallStats(input: PhoneCallsInput): Promise<{ from: string; to: string; managers: ManagerCallsRow[] }> {
  const { from, to } = period(input);
  const start = new Date(`${from}T00:00:00+05:00`);
  const end = new Date(Date.parse(`${to}T00:00:00+05:00`) + DAY);
  const managerFilter = input.manager_id ? Prisma.sql`AND cs.manager_user_id = ${input.manager_id}` : Prisma.empty;
  const managers = await prisma.$queryRaw<ManagerCallsRow[]>(Prisma.sql`
    SELECT cs.manager_user_id AS manager_id, u.full_name AS manager,
      COUNT(*)::int AS calls,
      COUNT(*) FILTER (WHERE cs.direction = 'OUTBOUND')::int AS outgoing,
      COUNT(*) FILTER (WHERE cs.direction = 'INBOUND')::int AS incoming,
      COUNT(*) FILTER (WHERE ${TALKED})::int AS talked,
      ROUND(COALESCE(SUM(${TALK_SEC}) FILTER (WHERE ${TALKED}), 0) / 60.0)::int AS talk_min,
      COUNT(DISTINCT cs.client_id) FILTER (WHERE ${TALKED})::int AS clients_talked,
      COUNT(*) FILTER (WHERE ${MISSED})::int AS missed,
      COUNT(*) FILTER (WHERE ${MISSED} AND ${NOT_CALLED_BACK})::int AS missed_not_called_back
    FROM call_sessions cs
    JOIN users u ON u.id = cs.manager_user_id
    WHERE cs.deleted_at IS NULL AND cs.started_at >= ${start} AND cs.started_at < ${end}
      AND ${NOT_SERVICE} ${managerFilter}
    GROUP BY cs.manager_user_id, u.full_name
    ORDER BY calls DESC`);
  return { from, to, managers };
}

/** Инструмент phone_calls: сводка по менеджерам и список, кому не перезвонили. */
export async function phoneCallsTool(input: PhoneCallsInput) {
  const stats = await managerCallStats(input);
  const start = new Date(`${stats.from}T00:00:00+05:00`);
  const end = new Date(Date.parse(`${stats.to}T00:00:00+05:00`) + DAY);
  const managerFilter = input.manager_id ? Prisma.sql`AND cs.manager_user_id = ${input.manager_id}` : Prisma.empty;
  const notCalledBack = await prisma.$queryRaw<{ manager: string | null; client: string | null; phone: string | null; at: string }[]>(Prisma.sql`
    SELECT u.full_name AS manager, c.company_name AS client, cs.phone,
      to_char((cs.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD HH24:MI') AS at
    FROM call_sessions cs
    LEFT JOIN users u ON u.id = cs.manager_user_id
    LEFT JOIN clients c ON c.id = cs.client_id
    WHERE cs.deleted_at IS NULL AND cs.started_at >= ${start} AND cs.started_at < ${end}
      AND ${MISSED} AND ${NOT_CALLED_BACK} AND ${NOT_SERVICE} ${managerFilter}
    ORDER BY cs.started_at DESC
    LIMIT 15`);
  return {
    period: `${stats.from} — ${stats.to}`,
    note: 'Звонки с рабочих телефонов менеджеров (раздел «Звонки»). talked — состоявшиеся разговоры, talk_min — минуты разговора, '
      + 'clients_talked — с каким числом разных клиентов говорили, missed — пропущенные входящие, '
      + 'missed_not_called_back — пропущенные, после которых никто не перезвонил и клиент сам не дозвонился. '
      + 'Личные (удалённые) звонки и служебные номера не считаются. Звонков нет — у менеджера не подключён телефон или он не звонил.',
    managers: stats.managers,
    not_called_back: notCalledBack,
  };
}

/** Одной строкой для звонка менеджеру и подобных мест: «за неделю 120 звонков, 80 разговоров …». */
export async function managerCallsLine(managerId: string, days = 7): Promise<string | null> {
  const { managers } = await managerCallStats({ manager_id: managerId, days });
  const m = managers[0];
  if (!m) return null;
  return `Звонки за ${days} дней с рабочего телефона: ${m.calls} (исходящих ${m.outgoing}), разговоров ${m.talked} на ${m.talk_min} мин, `
    + `с ${m.clients_talked} клиентами; пропущенных ${m.missed}, из них не перезвонили ${m.missed_not_called_back}.`;
}
