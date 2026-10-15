import { useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { useNavigate } from 'react-router-dom';
import { statusConfig } from '../DealStatusTag';
import { dealStatusTone } from '../dealStatusTone';
import type { DealStatus } from '../../types';
import { formatCount } from '../../utils/currency';
import './KpiExtras.css';

/** Нижняя строка карточки: дельта (если есть) и база сравнения мелким шрифтом. */
export function KpiFoot({ delta, children }: { delta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="kpi-foot">
      {delta}
      {children != null && children !== false && <span className="kpi-foot__text">{children}</span>}
    </div>
  );
}

export interface SparkPoint {
  day: string;
  value: number;
}

/**
 * Мини-график без осей — тренд прямо в карточке. Наведение (на телефоне — касание или
 * ведение пальцем) показывает день и значение; касание не открывает карточку-ссылку.
 */
export function KpiSparkline({ points, label, format }: { points: SparkPoint[]; label: string; format: (v: number) => string }) {
  const id = `kpi-spark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [active, setActive] = useState<number | null>(null);
  const touchRef = useRef(false);
  if (points.length < 2 || points.every((p) => p.value === 0)) return null;
  const W = 200;
  const H = 36;
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 2 - (v / max) * (H - 4);
  const pts = points.map((p, i) => `${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setActive(Math.round(ratio * (points.length - 1)));
  };
  const cur = active !== null ? points[active] : null;
  const leftPct = active !== null ? (active / (points.length - 1)) * 100 : 0;

  return (
    <div
      className="kpi-spark"
      onPointerDown={(e) => {
        touchRef.current = e.pointerType !== 'mouse';
        pick(e);
      }}
      onPointerMove={pick}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setActive(null);
      }}
      onClick={(e) => {
        // Палец смотрит значения, а не открывает карточку
        if (touchRef.current) e.preventDefault();
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="kpi-spark__stop-top" />
            <stop offset="1" className="kpi-spark__stop-bottom" />
          </linearGradient>
        </defs>
        <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${id})`} />
        <path d={line} className="kpi-spark__line" vectorEffect="non-scaling-stroke" />
        {active !== null && (
          <line x1={x(active)} x2={x(active)} y1={0} y2={H} className="kpi-spark__guide" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {cur && (
        <>
          <span
            className="kpi-spark__dot"
            style={{ left: `${leftPct}%`, top: `${(y(cur.value) / H) * 100}%` }}
          />
          <span
            className={`kpi-spark__tip${leftPct < 25 ? ' kpi-spark__tip--start' : leftPct > 75 ? ' kpi-spark__tip--end' : ''}`}
            style={{ left: `${leftPct}%` }}
            role="status"
          >
            <span className="kpi-spark__tip-day">{dayjs(cur.day).locale('ru').format('DD.MM, dd')}</span>
            {format(cur.value)}
          </span>
        </>
      )}
    </div>
  );
}

const FINAL: ReadonlySet<string> = new Set(['CLOSED', 'CANCELED', 'REJECTED']);

/**
 * Где стоят активные сделки: полоса из всех этапов (ширина — доля, цвет — смысл этапа:
 * жёлтые ждут чьего-то решения) и подписи трёх самых больших; остальные — «+ ещё N этапов».
 * Этап и «ещё» ведут в список сделок (карточка сама остаётся ссылкой на все сделки).
 */
export function ActiveStages({ counts }: { counts: { status: string; count: number }[] }) {
  const navigate = useNavigate();
  const stages = counts
    .filter((d) => d.count > 0 && !FINAL.has(d.status))
    .sort((a, b) => b.count - a.count);
  if (stages.length === 0) return null;
  const total = stages.reduce((s, d) => s + d.count, 0);
  const top = stages.slice(0, 3);
  const rest = stages.slice(3);
  const go = (to: string) => (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(to);
  };
  const label = (status: string) => statusConfig[status as DealStatus]?.label ?? status;
  return (
    <div className="kpi-stages-block">
      <div className="kpi-stagebar" role="img" aria-label="Активные сделки по этапам">
        {stages.map((d) => (
          <span
            key={d.status}
            className="kpi-stagebar__seg"
            data-tone={dealStatusTone(d.status as DealStatus)}
            // Ширина сегмента — доля этапа, зависит от данных
            style={{ flexGrow: d.count }}
            title={`${label(d.status)}: ${formatCount(d.count)}`}
          />
        ))}
      </div>
      <span className="kpi-stages">
        {top.map((d) => (
          <button key={d.status} type="button" className="kpi-stages__item" onClick={go(`/deals?status=${d.status}`)}>
            {label(d.status)} <b>{formatCount(d.count)}</b>
          </button>
        ))}
        {rest.length > 0 && (
          <button
            type="button"
            className="kpi-stages__item"
            title={rest.map((d) => `${label(d.status)}: ${d.count}`).join(', ')}
            onClick={go('/deals')}
          >
            + ещё {rest.length} {rest.length === 1 ? 'этап' : rest.length < 5 ? 'этапа' : 'этапов'} · <b>{formatCount(total - top.reduce((s, d) => s + d.count, 0))}</b>
          </button>
        )}
      </span>
    </div>
  );
}

/** Доля: тонкая полоса «просрочено из всего долга». */
export function KpiShareBar({ part, total, title }: { part: number; total: number; title: string }) {
  if (total <= 0 || part <= 0) return null;
  const pct = Math.min(100, (part / total) * 100);
  return (
    <div className="kpi-share" title={title}>
      {/* Ширина — доля просрочки, зависит от данных */}
      <span className="kpi-share__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
