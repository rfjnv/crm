/**
 * Сезонный прогноз продаж по прошлым годам.
 *
 * Берём, сколько обычно продаётся в каждом месяце (среднее по прошлым годам, где товар
 * или категория вообще продавались), и поправляем на темп текущего года: насколько
 * закрытые месяцы этого года выше или ниже тех же месяцев прошлых лет.
 */

/** Значения по месяцам: индекс 0 — январь. */
export type MonthValues = number[];
/** Год → 12 значений по месяцам. */
export type YearSeries = Map<number, MonthValues>;

export interface ForecastContext {
  /** Год, который смотрим. */
  year: number;
  /** Сегодняшний год и месяц (1–12): текущий месяц ещё не закончился. */
  nowYear: number;
  nowMonth: number;
}

export interface YearForecast {
  /** Факт выбранного года по месяцам. */
  actual: MonthValues;
  /** Прогноз полного месяца; null — месяц уже закрыт или прогноз не из чего строить. */
  forecast: (number | null)[];
  /** Во сколько раз этот год идёт выше (>1) или ниже (<1) прошлых лет; null — сравнивать не с чем. */
  trend: number | null;
  /** Сколько ещё ожидается продать до конца года сверх уже проданного. */
  restOfYear: number;
  /** Прошлые годы, по которым построен прогноз. */
  basedOnYears: number[];
}

const TREND_MIN = 0.25;
/**
 * Во сколько раз месяц может быть выше обычного, чтобы целиком войти в темп года.
 * Заодно это и потолок темпа: год не может идти «выше обычного» больше чем втрое.
 */
const MONTH_SPIKE_LIMIT = 3;

export function emptyMonths(): MonthValues {
  return Array.from({ length: 12 }, () => 0);
}

/** Собирает ряды «год → месяцы» по ключу (категория, товар) из плоских строк. */
export function buildSeries<T extends { year: number; month: number }>(
  rows: T[],
  key: (r: T) => string,
  value: (r: T) => number,
): Map<string, YearSeries> {
  const out = new Map<string, YearSeries>();
  for (const r of rows) {
    if (r.month < 1 || r.month > 12) continue;
    const k = key(r);
    let series = out.get(k);
    if (!series) {
      series = new Map();
      out.set(k, series);
    }
    let months = series.get(r.year);
    if (!months) {
      months = emptyMonths();
      series.set(r.year, months);
    }
    months[r.month - 1] += value(r);
  }
  return out;
}

/** Сколько месяцев года уже закрыто: у прошлых — все 12, у текущего — до текущего месяца. */
export function completedMonths(year: number, ctx: Pick<ForecastContext, 'nowYear' | 'nowMonth'>): number {
  if (year < ctx.nowYear) return 12;
  if (year > ctx.nowYear) return 0;
  return ctx.nowMonth - 1;
}

function sum(values: number[], from = 0, to = values.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += values[i] ?? 0;
  return s;
}

export function forecastYear(series: YearSeries | undefined, ctx: ForecastContext): YearForecast {
  const actual = series?.get(ctx.year)?.slice() ?? emptyMonths();
  const none: YearForecast = {
    actual, forecast: actual.map(() => null), trend: null, restOfYear: 0, basedOnYears: [],
  };
  // Прогнозируем только незакрытый год
  if (!series || ctx.year !== ctx.nowYear) return none;

  // Годы, когда это вообще продавалось: нули до появления товара занижали бы прогноз
  const basedOnYears = [...series.keys()]
    .filter((y) => y < ctx.year && sum(series.get(y)!) > 0)
    .sort((a, b) => a - b);
  if (basedOnYears.length === 0) return none;

  const base = emptyMonths().map((_, m) => (
    basedOnYears.reduce((s, y) => s + series.get(y)![m], 0) / basedOnYears.length
  ));

  const done = completedMonths(ctx.year, ctx);
  // Разовый огромный месяц (крупная сделка, ошибка ввода) не должен раздувать прогноз
  // на весь остаток года: месяц выше обычного больше чем втрое считаем «втрое выше»
  let baseDone = 0;
  let actualDone = 0;
  for (let m = 0; m < done; m++) {
    if (base[m] <= 0) continue;
    baseDone += base[m];
    actualDone += Math.min(actual[m], base[m] * MONTH_SPIKE_LIMIT);
  }
  let trend: number | null = null;
  if (done > 0 && baseDone > 0) {
    trend = Math.max(TREND_MIN, actualDone / baseDone);
  }
  const k = trend ?? 1;

  const forecast = base.map((b, m) => (m < done ? null : Math.round(b * k)));
  // Текущий месяц уже частично продан — ждём только остаток
  const restOfYear = forecast.reduce<number>((s, f, m) => (
    f == null ? s : s + Math.max(0, f - (m === done ? actual[m] : 0))
  ), 0);

  return { actual, forecast, trend, restOfYear, basedOnYears };
}

/**
 * Месяц (1–12), в котором обычно продаётся больше всего: среднее по всем годам,
 * незакрытые месяцы текущего года не учитываются. null — продаж нет.
 */
export function seasonalPeakMonth(series: YearSeries | undefined, ctx: Pick<ForecastContext, 'nowYear' | 'nowMonth'>): number | null {
  if (!series) return null;
  const totals = emptyMonths();
  const counts = emptyMonths();
  for (const [year, months] of series) {
    if (sum(months) <= 0) continue;
    const done = completedMonths(year, ctx);
    for (let m = 0; m < done; m++) {
      totals[m] += months[m];
      counts[m] += 1;
    }
  }
  let best: number | null = null;
  let bestAvg = 0;
  for (let m = 0; m < 12; m++) {
    const avg = counts[m] ? totals[m] / counts[m] : 0;
    if (avg > bestAvg) {
      bestAvg = avg;
      best = m + 1;
    }
  }
  return best;
}

/** Лучший месяц (1–12) по факту; null — продаж не было. */
export function bestMonth(values: MonthValues): number | null {
  let best: number | null = null;
  let bestValue = 0;
  values.forEach((v, i) => {
    if (v > bestValue) {
      bestValue = v;
      best = i + 1;
    }
  });
  return best;
}

/**
 * Рост к прошлому году за сопоставимые месяцы (у незакрытого года — только закрытые
 * месяцы, иначе неполный год сравнивался бы с полным). null — сравнивать не с чем.
 */
export function yearOverYear(series: YearSeries | undefined, ctx: ForecastContext): number | null {
  const cur = series?.get(ctx.year);
  const prev = series?.get(ctx.year - 1);
  if (!cur || !prev) return null;
  const months = ctx.year === ctx.nowYear ? Math.max(1, ctx.nowMonth - 1) : 12;
  const prevSum = sum(prev, 0, months);
  if (prevSum <= 0) return null;
  return sum(cur, 0, months) / prevSum - 1;
}
