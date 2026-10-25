import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { formatUZS } from '../../utils/currency';
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
  current?: boolean;
  off?: boolean;
}

function Cells({ cells, columns }: { cells: Cell[]; columns: number }) {
  return (
    <div className="goals-cells" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {cells.map((c) => (
        <span
          key={c.key}
          className={`goals-cell${c.current ? ' goals-cell--current' : ''}${c.off ? ' goals-cell--off' : ''}`}
          data-tone={tone(c.ratio)}
          title={c.title}
        >
          {c.ratio != null && c.ratio > 0 && (
            <i style={{ height: `${Math.min(100, Math.max(10, c.ratio * 100))}%` }} />
          )}
        </span>
      ))}
    </div>
  );
}

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

  // Год: клетка на месяц, цель месяца — месячная
  const currentMonthIdx = month - 1;
  const monthCells: Cell[] = MONTHS_SHORT.map((name, i) => {
    const total = goals?.months[i]?.total ?? 0;
    const future = i > currentMonthIdx;
    return {
      key: name,
      ratio: future ? null : monthlyGoal > 0 ? total / monthlyGoal : 0,
      current: i === currentMonthIdx,
      title: future ? `${MONTHS[i]} — впереди` : `${MONTHS[i]} — ${formatUZS(total)} · ${pct(total, monthlyGoal)}% месячной цели`,
    };
  });
  const daysInYear = today.endOf('year').diff(today.startOf('year'), 'day') + 1;
  const yearPace = (today.diff(today.startOf('year'), 'day') + 1) / daysInYear;
  const revenueYear = goals?.revenueYear ?? 0;

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
          <div className="goals-caps"><span>янв</span><span>июн</span><span>дек</span></div>
        </div>
      )}
    </section>
  );
}
