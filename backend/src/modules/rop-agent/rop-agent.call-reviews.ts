import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';

/**
 * Картина по звонкам менеджеров из аудитов (call_audits) — инструмент call_reviews.
 * Отдельно от Telegram-части (rop-agent.calls), чтобы инструменты агента не тянули бота.
 */

export const STAGES: Record<string, string> = {
  greeting: 'приветствие',
  needsDiscovery: 'выявление потребности',
  presentation: 'презентация',
  objectionHandling: 'возражения',
  closing: 'закрытие / следующий шаг',
};

type AuditRow = {
  id: string;
  created_at: Date;
  manager_id: string | null;
  manager: string | null;
  client: string | null;
  score: number | null;
  sale_probability: number | null;
  stage_checklist: Record<string, boolean> | null;
  mentor_tips: string[] | null;
  analysis: string;
};

/** Итог разбора (ШАГ 9) — короче всего анализа и достаточно, чтобы понять звонок. */
function auditSummary(analysis: string): string {
  const i = analysis.search(/ШАГ\s*9/i);
  const tail = i >= 0 ? analysis.slice(i) : analysis.slice(-700);
  // Убираем только заголовок «ШАГ 9 — Итог:» — текст может идти в той же строке.
  return tail.replace(/^ШАГ\s*9\s*[—–:.-]*\s*(Итог)?\s*[—–:.-]*\s*/i, '').trim().slice(0, 700);
}

export async function callReviews(input: { manager_id?: string; days?: number; limit?: number }) {
  const days = Math.min(Math.max(Math.round(input.days ?? 90), 1), 730);
  const limit = Math.min(Math.max(Math.round(input.limit ?? 20), 1), 50);
  // Старые аудиты без manager_id — по совпадению имени с сотрудником.
  const managerExpr = Prisma.sql`COALESCE(ca.manager_id, (
    SELECT u2.id FROM users u2 WHERE lower(trim(u2.full_name)) = lower(trim(ca.manager_name)) LIMIT 1
  ))`;
  const rows = await prisma.$queryRaw<AuditRow[]>(Prisma.sql`
    SELECT ca.id, ca.created_at, ${managerExpr} AS manager_id,
      COALESCE(u.full_name, ca.manager_name) AS manager, c.company_name AS client,
      ca.score, ca.sale_probability, ca.stage_checklist, ca.mentor_tips, ca.analysis
    FROM call_audits ca
    LEFT JOIN users u ON u.id = ${managerExpr}
    LEFT JOIN clients c ON c.id = ca.client_id
    WHERE ca.created_at >= NOW() - make_interval(days => ${days}::int)
      ${input.manager_id ? Prisma.sql`AND ${managerExpr} = ${input.manager_id}` : Prisma.empty}
    ORDER BY ca.created_at DESC`);

  const byManager = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const key = r.manager ?? 'Не указан';
    byManager.set(key, [...(byManager.get(key) ?? []), r]);
  }
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
  };

  return {
    period_days: days,
    note: 'Аудиты звонков, которые загрузили вручную (менеджеры звонят с мобильных — записи в CRM сами не попадают). '
      + 'stage_rates — доля звонков, где этап выполнен (только аудиты с чек-листом). Мало аудитов — вывод ненадёжен, так и скажи.',
    managers: [...byManager.entries()].map(([manager, list]) => {
      const withStages = list.filter((r) => r.stage_checklist);
      return {
        manager,
        manager_id: list[0].manager_id,
        audits: list.length,
        avg_score: avg(list.map((r) => r.score)),
        avg_sale_probability: avg(list.map((r) => r.sale_probability)),
        stage_rates: withStages.length
          ? Object.fromEntries(Object.entries(STAGES).map(([k, label]) => [
            label, Math.round((withStages.filter((r) => r.stage_checklist?.[k]).length / withStages.length) * 100) / 100,
          ]))
          : null,
        last_audit: list[0].created_at.toISOString().slice(0, 10),
      };
    }),
    recent: rows.slice(0, limit).map((r) => ({
      audit_id: r.id,
      date: r.created_at.toISOString().slice(0, 10),
      manager: r.manager,
      client: r.client,
      score: r.score,
      sale_probability: r.sale_probability,
      missed_stages: r.stage_checklist
        ? Object.entries(STAGES).filter(([k]) => !r.stage_checklist?.[k]).map(([, label]) => label)
        : null,
      tips: r.mentor_tips ?? [],
      summary: auditSummary(r.analysis),
    })),
  };
}
