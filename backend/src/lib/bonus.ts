/**
 * Расчёт бонуса менеджера за месяц.
 *
 * Схема двухступенчатая — так её описал заказчик:
 *
 *  1) База. Смотрим, сколько процентов плана по выручке сделал менеджер, по
 *     этому проценту берём ставку из таблицы ступеней и умножаем ставку на
 *     ФАКТИЧЕСКУЮ выручку (не на план). Пример: план 1 000 000 000, факт
 *     592 395 100 — это 59,2%, ступень «от 50%» даёт 0,5%, база = 2 961 975.
 *
 *  2) Критерии. База — это 100% возможного бонуса. Дальше её умножаем на
 *     средневзвешенное выполнение критериев: у каждого критерия свой вес
 *     (в сумме 100%) и своё выполнение «факт / цель», не выше 100%.
 *
 *     Плана продаж среди критериев НЕТ: он уже отработал на первом шаге, выбрав
 *     ставку. Если бы он стоял и здесь, слабое выполнение плана резало бы премию
 *     дважды.
 *
 * Всё, что можно настроить (веса, ступени, цели по умолчанию), лежит в таблице
 * bonus_scheme и правится админом — в коде только значения по умолчанию.
 */
import { AppError } from './errors';

export const BONUS_CRITERIA = [
  'assortment',
  'contacts',
  'clients',
  'leads',
  'attendance',
] as const;

export type BonusCriterionKey = (typeof BONUS_CRITERIA)[number];

export const BONUS_CRITERION_LABELS: Record<BonusCriterionKey, string> = {
  assortment: 'Ассортимент',
  contacts: 'Звонки и контакты',
  clients: 'Привлечение клиентов',
  leads: 'Лиды',
  attendance: 'Посещаемость',
};

/** Как показывать факт и цель критерия на фронте. */
export const BONUS_CRITERION_UNITS: Record<BonusCriterionKey, 'money' | 'count'> = {
  assortment: 'count',
  contacts: 'count',
  clients: 'count',
  leads: 'count',
  attendance: 'count',
};

/** «От fromPercent процентов плана — ставка rate процентов от факта». */
export interface BonusTier {
  fromPercent: number;
  rate: number;
}

/** Цели, которые не задаются персонально в плане сотрудника. */
export interface BonusTargets {
  assortment: number;
  contacts: number;
  clients: number;
  leads: number;
}

export interface BonusScheme {
  weights: Record<BonusCriterionKey, number>;
  tiers: BonusTier[];
  targets: BonusTargets;
}

export const DEFAULT_BONUS_SCHEME: BonusScheme = {
  weights: { assortment: 25, contacts: 25, clients: 20, leads: 15, attendance: 15 },
  tiers: [
    { fromPercent: 0, rate: 0 },
    { fromPercent: 50, rate: 0.5 },
    { fromPercent: 80, rate: 0.6 },
  ],
  targets: { assortment: 20, contacts: 60, clients: 5, leads: 5 },
};

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Чтение схемы из JSON-колонок. Ничего не роняем: если строка старая или битая,
 * недостающие куски берём из значений по умолчанию — иначе весь KPI отдаст 500.
 */
export function parseBonusScheme(raw: unknown): BonusScheme {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const weightsSrc = (src.weights && typeof src.weights === 'object' ? src.weights : {}) as Record<string, unknown>;
  const weights = { ...DEFAULT_BONUS_SCHEME.weights };
  for (const key of BONUS_CRITERIA) {
    const v = num(weightsSrc[key]);
    if (v !== null && v >= 0) weights[key] = v;
  }

  const tiersSrc = Array.isArray(src.tiers) ? src.tiers : [];
  const tiers: BonusTier[] = [];
  for (const row of tiersSrc) {
    if (!row || typeof row !== 'object') continue;
    const from = num((row as Record<string, unknown>).fromPercent);
    const rate = num((row as Record<string, unknown>).rate);
    if (from === null || rate === null || from < 0 || rate < 0) continue;
    tiers.push({ fromPercent: from, rate });
  }
  tiers.sort((a, b) => a.fromPercent - b.fromPercent);

  const targetsSrc = (src.targets && typeof src.targets === 'object' ? src.targets : {}) as Record<string, unknown>;
  const targets = { ...DEFAULT_BONUS_SCHEME.targets };
  for (const key of Object.keys(DEFAULT_BONUS_SCHEME.targets) as (keyof BonusTargets)[]) {
    const v = num(targetsSrc[key]);
    if (v !== null && v >= 0) targets[key] = v;
  }

  return { weights, tiers: tiers.length > 0 ? tiers : DEFAULT_BONUS_SCHEME.tiers, targets };
}

/** Проверка того, что прислал админ. Здесь молчать нельзя — говорим, что не так. */
export function validateBonusScheme(raw: unknown): BonusScheme {
  const src = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!src) throw new AppError(400, 'Некорректная схема бонуса');

  const weightsSrc = (src.weights && typeof src.weights === 'object' ? src.weights : null) as Record<string, unknown> | null;
  if (!weightsSrc) throw new AppError(400, 'Не заданы веса критериев');
  const weights = {} as Record<BonusCriterionKey, number>;
  for (const key of BONUS_CRITERIA) {
    const v = num(weightsSrc[key]);
    if (v === null || v < 0 || v > 100) {
      throw new AppError(400, `Вес критерия «${BONUS_CRITERION_LABELS[key]}» должен быть от 0 до 100`);
    }
    weights[key] = Math.round(v * 10) / 10;
  }
  const sum = BONUS_CRITERIA.reduce((s, k) => s + weights[k], 0);
  if (Math.abs(sum - 100) > 0.05) {
    throw new AppError(400, `Сумма весов должна быть 100%, сейчас ${Math.round(sum * 10) / 10}%`);
  }

  const tiersSrc = Array.isArray(src.tiers) ? src.tiers : null;
  if (!tiersSrc || tiersSrc.length === 0) throw new AppError(400, 'Нужна хотя бы одна ступень ставки');
  const tiers: BonusTier[] = tiersSrc.map((row) => {
    const from = num((row as Record<string, unknown>)?.fromPercent);
    const rate = num((row as Record<string, unknown>)?.rate);
    if (from === null || from < 0 || from > 1000) throw new AppError(400, 'Порог ступени — от 0 до 1000%');
    if (rate === null || rate < 0 || rate > 100) throw new AppError(400, 'Ставка ступени — от 0 до 100%');
    return { fromPercent: Math.round(from * 10) / 10, rate: Math.round(rate * 1000) / 1000 };
  });
  tiers.sort((a, b) => a.fromPercent - b.fromPercent);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].fromPercent === tiers[i - 1].fromPercent) {
      throw new AppError(400, `Две ступени с одним порогом ${tiers[i].fromPercent}%`);
    }
  }

  const targetsSrc = (src.targets && typeof src.targets === 'object' ? src.targets : null) as Record<string, unknown> | null;
  if (!targetsSrc) throw new AppError(400, 'Не заданы цели по критериям');
  const targets = {} as BonusTargets;
  for (const key of Object.keys(DEFAULT_BONUS_SCHEME.targets) as (keyof BonusTargets)[]) {
    const v = num(targetsSrc[key]);
    if (v === null || v < 0) throw new AppError(400, 'Цель критерия не может быть отрицательной');
    targets[key] = Math.round(v);
  }

  return { weights, tiers, targets };
}

/** Ставка для достигнутого процента плана: последняя ступень, порог которой пройден. */
export function resolveRate(tiers: BonusTier[], planPercent: number | null): number {
  if (planPercent === null) return 0;
  const percent = planPercent * 100;
  let rate = 0;
  for (const tier of tiers) {
    if (percent + 1e-9 >= tier.fromPercent) rate = tier.rate;
    else break;
  }
  return rate;
}

export interface BonusFacts {
  revenueFact: number;
  revenueTarget: number | null;
  /** Личный план по контактам из карточки сотрудника; null — берём цель из схемы. */
  contactsTarget: number | null;
  assortmentPositions: number;
  contactsTotal: number;
  /** Новые + вернувшиеся: это и есть привлечение, постоянные сюда не идут. */
  clientsAcquired: number;
  leadsConverted: number;
  attendanceOnTime: number;
  workdays: number;
}

export interface BonusCriterionResult {
  key: BonusCriterionKey;
  label: string;
  unit: 'money' | 'count';
  weight: number;
  fact: number;
  /** null — цель не задана, критерий из расчёта выпадает. */
  target: number | null;
  /** Выполнение до ограничения сверху — чтобы было видно перевыполнение. */
  rawPercent: number | null;
  /** Выполнение, участвующее в расчёте: не больше 100%. */
  percent: number | null;
  /** Вклад в итоговый процент, уже с учётом перераспределения весов. */
  contribution: number;
}

export interface BonusResult {
  /** Выручка, от которой считается ставка — нужна фронту для строки расчёта. */
  revenueFact: number;
  planPercent: number | null;
  rate: number;
  /** Ставка × фактическая выручка — 100% возможного бонуса. */
  base: number;
  criteria: BonusCriterionResult[];
  /** Сумма весов критериев, у которых задана цель. */
  weightUsed: number;
  /** Средневзвешенное выполнение критериев, 0..1. */
  score: number;
  amount: number;
}

export function calculateBonus(scheme: BonusScheme, facts: BonusFacts): BonusResult {
  const planPercent =
    facts.revenueTarget && facts.revenueTarget > 0 ? facts.revenueFact / facts.revenueTarget : null;
  const rate = resolveRate(scheme.tiers, planPercent);
  const base = Math.floor((facts.revenueFact * rate) / 100);

  const rawCriteria: { key: BonusCriterionKey; fact: number; target: number | null }[] = [
    { key: 'assortment', fact: facts.assortmentPositions, target: scheme.targets.assortment || null },
    {
      key: 'contacts',
      fact: facts.contactsTotal,
      target: facts.contactsTarget && facts.contactsTarget > 0 ? facts.contactsTarget : scheme.targets.contacts || null,
    },
    { key: 'clients', fact: facts.clientsAcquired, target: scheme.targets.clients || null },
    { key: 'leads', fact: facts.leadsConverted, target: scheme.targets.leads || null },
    { key: 'attendance', fact: facts.attendanceOnTime, target: facts.workdays || null },
  ];

  // Критерий без цели измерить нечем. Обнулять его нечестно — вместо этого он
  // выходит из расчёта, а его вес распределяется между остальными.
  const weightUsed = rawCriteria
    .filter((c) => c.target !== null && c.target > 0)
    .reduce((s, c) => s + scheme.weights[c.key], 0);

  const criteria: BonusCriterionResult[] = rawCriteria.map((c) => {
    const weight = scheme.weights[c.key];
    const measurable = c.target !== null && c.target > 0;
    const rawPercent = measurable ? c.fact / (c.target as number) : null;
    const percent = rawPercent === null ? null : Math.min(rawPercent, 1);
    const contribution = percent !== null && weightUsed > 0 ? (weight / weightUsed) * percent : 0;
    return {
      key: c.key,
      label: BONUS_CRITERION_LABELS[c.key],
      unit: BONUS_CRITERION_UNITS[c.key],
      weight,
      fact: c.fact,
      target: c.target,
      rawPercent,
      percent,
      contribution,
    };
  });

  const score = criteria.reduce((s, c) => s + c.contribution, 0);

  return {
    revenueFact: facts.revenueFact,
    planPercent,
    rate,
    base,
    criteria,
    weightUsed,
    score,
    amount: Math.floor(base * score),
  };
}
