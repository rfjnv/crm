import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Tooltip } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { formatMoneyCompact, formatUZS } from '../../utils/currency';
import './GoalsBlock.css';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Насколько выполнена цель клетки: ≥ 1 — выполнена, от 0.7 — почти, ниже — мало. */
function tone(k: number | null): 'done' | 'mid' | 'low' | 'none' {
  if (k == null || k <= 0) return 'none';
  if (k >= 1) return 'done';
  return k >= 0.7 ? 'mid' : 'low';
}

const pct = (part: number, total: number) => (total > 0 ? Math.floor((part / total) * 100) : 0);

interface Cell {
  key: string;
  /** Доля цели клетки; null — ещё не наступила */
  ratio: number | null;
  title: string;
  /** Подсказка вместо `title`, если нужна в несколько строк */
  tip?: ReactNode;
  current?: boolean;
  off?: boolean;
}

function Cells({ cells, columns }: { cells: Cell[]; columns: number }) {
  return (
    <div className="goals-cells" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {cells.map((c) => {
        const cell = (
          <span
            key={c.key}
            className={`goals-cell${c.current ? ' goals-cell--current' : ''}${c.off ? ' goals-cell--off' : ''}`}
            data-tone={tone(c.ratio)}
            title={c.tip ? undefined : c.title}
          >
            {c.ratio != null && c.ratio > 0 && (
              <i style={{ height: `${Math.min(100, Math.max(10, c.ratio * 100))}%` }} />
            )}
          </span>
        );
        return c.tip ? <Tooltip key={c.key} title={c.tip} mouseEnterDelay={0.05} rootClassName="goals-yoy-tooltip">{cell}</Tooltip> : cell;
      })}
    </div>
  );
}

/** «+12%» / «−8%» к прошлому году; null — сравнивать не с чем */
function growth(cur: number, prev: number): number | null {
  return prev > 0 ? Math.round((cur / prev - 1) * 100) : null;
}

function Growth({ value }: { value: number | null }) {
  if (value == null) return <span className="goals-yoy__na">—</span>;
  return <span className={value >= 0 ? 'goals-yoy__up' : 'goals-yoy__down'}>{value >= 0 ? '+' : '−'}{Math.abs(value)}<span className="goals-yoy__pc">%</span></span>;
}

const compact = (v: number) => {
  const c = formatMoneyCompact(v);
  return c.unit ? `${c.text} ${c.unit}` : c.text;
};

function PaceTag({ fact, goal, pace }: { fact: number; goal: number; pace: number }) {
  const diff = fact - goal * pace;
  return (
    <span className={`goals-pace${diff >= 0 ? ' goals-pace--ahead' : ''}`} title="Где надо быть к сегодняшнему дню, чтобы выполнить цель">
      {diff >= 0 ? 'впереди темпа на ' : 'позади темпа на '}
      {formatUZS(Math.abs(diff))}
    </span>
  );
}

function RowHead({ title, tag, fact, goal }: { title: string; tag?: ReactNode; fact: number; goal: number }) {
  return (
    <div className="goals-row__head">
      <span className="goals-row__title">{title}{tag}</span>
      <span className="goals-row__nums">
        <b>{pct(fact, goal)}%</b>
        <span>{formatUZS(fact)} / {formatUZS(goal)}</span>
      </span>
    </div>
  );
}

interface Props {
  revenueToday: number;
  revenueMonth: number;
  monthlyGoal: number;
  dailyGoal: number;
  yearlyGoal: number;
  goals?: {
    year: number;
    month: number;
    revenueYear: number;
    days: { day: string; total: number }[];
    months: { month: number; total: number }[];
    prevYear?: { year: number; months: { month: number; total: number }[]; monthToDate: number; yearToDate: number };
  };
  showYear: boolean;
  canEdit: boolean;
}

/**
 * «Цели по выручке»: сегодня — полоса; месяц — клетки по дням (воскресенье — выходной);
 * год — клетки по месяцам. Высота заливки — доля цели клетки, цвет — выполнена или нет.
 * «Темп» — где надо быть к сегодняшнему дню: для месяца — по рабочим дням, для года — по календарю.
 */
export default function GoalsBlock({
  revenueToday, revenueMonth, monthlyGoal, dailyGoal, yearlyGoal, goals, showYear, canEdit,
}: Props) {
  const today = dayjs();
  const year = goals?.year ?? today.year();
  const month = goals?.month ?? today.month() + 1;
  const monthStart = dayjs(`${year}-${String(month).padStart(2, '0')}-01`);
  const daysInMonth = monthStart.daysInMonth();
  const todayDate = today.date();

  // Месяц: клетка на каждый день; воскресенье — выходной, в темп не входит
  const byDay = new Map((goals?.days ?? []).map((d) => [d.day, d.total]));
  const dayCells: Cell[] = Array.from({ length: daysInMonth }, (_, i) => {
    const d = monthStart.add(i, 'day');
    const key = d.format('YYYY-MM-DD');
    const off = d.day() === 0;
    const future = i + 1 > todayDate;
    const total = byDay.get(key) ?? 0;
    const ratio = future ? null : dailyGoal > 0 ? total / dailyGoal : 0;
    const label = d.locale('ru').format('D MMM');
    return {
      key,
      ratio: off && !total ? null : ratio,
      off,
      current: i + 1 === todayDate,
      title: future ? `${label} — впереди` : `${label}${off ? ' (вс)' : ''} — ${formatUZS(total)} · ${pct(total, dailyGoal)}% дневной цели`,
    };
  });
  const workDays = dayCells.filter((c) => !c.off).length;
  const workDaysPassed = dayCells.filter((c, i) => !c.off && i + 1 <= todayDate).length;
  const monthPace = workDays > 0 ? workDaysPassed / workDays : 0;

  // Год: клетка на месяц, цель месяца — месячная. Сравнение с прошлым годом: текущий
  // месяц — с теми же числами год назад, иначе неполный месяц всегда «хуже».
  const currentMonthIdx = month - 1;
  const prev = goals?.prevYear;
  const hasPrev = !!prev && prev.yearToDate > 0;
  const prevYearNum = prev?.year ?? year - 1;
  const monthCells: Cell[] = MONTHS_SHORT.map((name, i) => {
    const total = goals?.months[i]?.total ?? 0;
    const future = i > currentMonthIdx;
    const current = i === currentMonthIdx;
    const prevTotal = prev?.months[i]?.total ?? 0;
    const prevSame = current ? prev?.monthToDate ?? 0 : prevTotal;
    const goalLine = `${pct(total, monthlyGoal)}% месячной цели`;
    return {
      key: name,
      ratio: future ? null : monthlyGoal > 0 ? total / monthlyGoal : 0,
      current,
      title: future ? `${MONTHS[i]} — впереди` : `${MONTHS[i]} — ${formatUZS(total)} · ${goalLine}`,
      tip: hasPrev ? (
        <div className="goals-yoy-tip">
          {future ? (
            <>
              <b>{MONTHS[i]} {prevYearNum}:</b> {formatUZS(prevTotal)}
              <div>столько продали год назад</div>
            </>
          ) : (
            <>
              <b>{MONTHS[i]} {year}{current ? ` (1–${todayDate})` : ''}:</b> {formatUZS(total)}
              <div>{MONTHS[i]} {prevYearNum}{current ? ` (1–${todayDate})` : ''}: {formatUZS(prevSame)} · <Growth value={growth(total, prevSame)} /></div>
              {current && <div>весь {MONTHS[i]} {prevYearNum}: {formatUZS(prevTotal)}</div>}
              <div className="goals-yoy-tip__goal">{goalLine}</div>
            </>
          )}
        </div>
      ) : undefined,
    };
  });
  const daysInYear = today.endOf('year').diff(today.startOf('year'), 'day') + 1;
  const yearPace = (today.diff(today.startOf('year'), 'day') + 1) / daysInYear;
  const revenueYear = goals?.revenueYear ?? 0;
  const monthGrowth = MONTHS_SHORT.map((_, i) => {
    if (i > currentMonthIdx) return null;
    const total = goals?.months[i]?.total ?? 0;
    return growth(total, i === currentMonthIdx ? prev?.monthToDate ?? 0 : prev?.months[i]?.total ?? 0);
  });
  const comparable = monthGrowth.filter((g): g is number => g != null);
  const betterMonths = comparable.filter((g) => g > 0).length;

  return (
    <section className="goals-block">
      <header className="goals-block__head">
        <span className="goals-block__title">Цели по выручке</span>
        <span className="goals-block__legend">
          <i data-tone="done" /> выполнена <i data-tone="mid" /> от 70 % <i data-tone="low" /> меньше
        </span>
        {canEdit && <Link className="goals-block__edit" to="/settings/company">Настроить</Link>}
      </header>

      <div className="goals-row">
        <RowHead title="Сегодня" fact={revenueToday} goal={dailyGoal} />
        <div className="goals-bar">
          <i style={{ width: `${Math.min(100, pct(revenueToday, dailyGoal))}%` }} />
        </div>
      </div>

      <div className="goals-row">
        <RowHead
          title={MONTHS[currentMonthIdx][0].toUpperCase() + MONTHS[currentMonthIdx].slice(1)}
          tag={<PaceTag fact={revenueMonth} goal={monthlyGoal} pace={monthPace} />}
          fact={revenueMonth}
          goal={monthlyGoal}
        />
        <Cells cells={dayCells} columns={daysInMonth} />
        <div className="goals-caps"><span>1</span><span>15</span><span>{daysInMonth}</span></div>
      </div>

      {showYear && (
        <div className="goals-row">
          <RowHead
            title={String(year)}
            tag={<PaceTag fact={revenueYear} goal={yearlyGoal} pace={yearPace} />}
            fact={revenueYear}
            goal={yearlyGoal}
          />
          <Cells cells={monthCells} columns={12} />
          {hasPrev ? (
            <>
              <div className="goals-yoy">
                {MONTHS_SHORT.map((name, i) => (
                  <span key={name}>
                    {i > currentMonthIdx ? (
                      <span className="goals-yoy__na goals-yoy__ahead">{compact(prev.months[i]?.total ?? 0)} в {String(prevYearNum).slice(2)}-м</span>
                    ) : <Growth value={monthGrowth[i]} />}
                  </span>
                ))}
              </div>
              <div className="goals-yoy-sum">
                <span>к {prevYearNum}: <b><Growth value={growth(revenueYear, prev.yearToDate)} /></b></span>
                <span>
                  {MONTHS_SHORT[0]}–{MONTHS_SHORT[currentMonthIdx]} <b>{compact(revenueYear)}</b> против {compact(prev.yearToDate)}
                </span>
                {comparable.length > 0 && (
                  <span>лучше прошлого года в <b>{betterMonths} из {comparable.length}</b> {comparable.length === 1 ? 'месяце' : 'месяцах'}</span>
                )}
              </div>
            </>
          ) : (
            <div className="goals-caps"><span>янв</span><span>июн</span><span>дек</span></div>
          )}
        </div>
      )}
    </section>
  );
}
