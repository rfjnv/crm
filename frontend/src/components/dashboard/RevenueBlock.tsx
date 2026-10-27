import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { formatUZS, formatMoneyCompact } from '../../utils/currency';
import './RevenueBlock.css';

interface Props {
  title: string;
  /** Дни графика без воскресений (выходной), с нулями там, где продаж не было */
  points: { day: string; value: number }[];
  /** Выручка за весь отрезок, включая воскресенья */
  total: number;
  /** Выручка за такой же отрезок перед графиком */
  prevTotal: number;
  dailyGoal: number;
  showGoal: boolean;
}

const short = (v: number) => {
  const m = formatMoneyCompact(v);
  return m.unit ? `${m.text} ${m.unit}` : m.text;
};

/**
 * «Выручка за 30 дней»: итог и сравнение с прошлым отрезком, столбики по рабочим дням
 * (линия сглаживания уходила ниже нуля), пунктир цели дня и три плитки снизу.
 */
export default function RevenueBlock({ title, points, total, prevTotal, dailyGoal, showGoal }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(230);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // График растягивается по высоте карточки (соседний блок этапов бывает выше)
    const measure = () => {
      setWidth(Math.max(240, el.clientWidth));
      setHeight(Math.max(200, Math.min(640, el.clientHeight)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const today = dayjs().format('YYYY-MM-DD');
  const delta = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  const avg = points.length ? total / points.length : 0;
  const best = points.reduce<{ day: string; value: number } | null>((a, b) => (!a || b.value > a.value ? b : a), null);
  const met = points.filter((p) => dailyGoal > 0 && p.value >= dailyGoal).length;
  const todayPoint = points.find((p) => p.day === today);

  const H = height;
  const pl = 52;
  const pb = 22;
  const pt = 12;
  const max = Math.max(...points.map((p) => p.value), showGoal ? dailyGoal : 0, 1) * 1.12;
  const bw = points.length ? (width - pl) / points.length : 0;
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / max);
  const gap = Math.min(4, bw * 0.25);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(3, Math.floor((width - pl) / 64))));
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="rev-block">
      <header className="rev-block__head">
        <span className="rev-block__title">{title}</span>
        <span className="rev-block__sub">без воскресений</span>
        <Link className="rev-block__link" to="/analytics">Аналитика ›</Link>
      </header>
      <div className="rev-block__total">
        {formatUZS(total)}
        {delta != null && (
          <span className={`rev-block__delta${delta < 0 ? ' rev-block__delta--down' : ''}`}>
            {delta > 0 ? '+' : ''}{delta}% к прошлому периоду
          </span>
        )}
      </div>
      <div className="rev-block__avg">в среднем {short(avg)} в рабочий день</div>

      <div className="rev-block__chart" ref={ref} onMouseLeave={() => setHover(null)}>
        <svg width={width} height={H} role="img" aria-label="Выручка по дням">
          {[0, 0.25, 0.5, 0.75, 1].map((k) => {
            const v = (max / 1.12) * k;
            return (
              <g key={k}>
                <line x1={pl} x2={width} y1={y(v)} y2={y(v)} className="rev-block__grid" />
                <text x={pl - 8} y={y(v) + 4} className="rev-block__axis" textAnchor="end">{v ? short(v) : '0'}</text>
              </g>
            );
          })}
          {points.map((p, i) => {
            const h = Math.max(((H - pt - pb) * p.value) / max, p.value > 0 ? 2 : 1);
            const hit = showGoal && dailyGoal > 0 && p.value >= dailyGoal;
            return (
              <g key={p.day} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
                <rect x={pl + i * bw} y={pt} width={bw} height={H - pt - pb} fill="transparent" />
                <rect
                  x={pl + i * bw + gap / 2}
                  y={H - pb - h}
                  width={Math.max(1, bw - gap)}
                  height={h}
                  rx={Math.min(3, bw / 4)}
                  className={`rev-block__bar${hit ? ' rev-block__bar--hit' : ''}${p.day === today ? ' rev-block__bar--today' : ''}${hover === i ? ' rev-block__bar--hover' : ''}`}
                />
                {((i % labelEvery === 0 && points.length - 1 - i >= labelEvery / 2) || i === points.length - 1) && (
                  <text x={pl + i * bw + bw / 2} y={H - 5} className="rev-block__axis" textAnchor="middle">
                    {dayjs(p.day).format('DD.MM')}
                  </text>
                )}
              </g>
            );
          })}
          {showGoal && dailyGoal > 0 && (
            <g>
              <line x1={pl} x2={width} y1={y(dailyGoal)} y2={y(dailyGoal)} className="rev-block__goal" />
              <text x={width - 2} y={y(dailyGoal) - 6} className="rev-block__goal-text" textAnchor="end">цель дня {short(dailyGoal)}</text>
            </g>
          )}
        </svg>
        {hp && (
          <div
            className="rev-block__tip"
            style={{ left: Math.min(Math.max(pl + (hover! + 0.5) * bw, 70), width - 70), top: Math.max(0, y(hp.value) - 8) }}
          >
            <span>{dayjs(hp.day).locale('ru').format('D MMM, dd')}</span>
            <b>{formatUZS(hp.value)}</b>
            {showGoal && dailyGoal > 0 && <span>{Math.round((hp.value / dailyGoal) * 100)}% цели дня</span>}
          </div>
        )}
      </div>

      <div className="rev-block__stats">
        <div><b>{best ? short(best.value) : '—'}</b><small>лучший день{best ? ` · ${dayjs(best.day).locale('ru').format('D MMM')}` : ''}</small></div>
        <div>
          <b>{showGoal ? `${met} из ${points.length}` : points.filter((p) => p.value > 0).length}</b>
          <small>{showGoal ? 'дней с выполненной целью' : 'дней с продажами'}</small>
        </div>
        <div><b>{todayPoint ? short(todayPoint.value) : '—'}</b><small>сегодня, пока</small></div>
      </div>
    </div>
  );
}
