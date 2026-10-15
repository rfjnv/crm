import { useId, type ReactNode } from 'react';
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

/** Мини-график за 30 дней без осей — тренд выручки прямо в карточке. */
export function KpiSparkline({ values }: { values: number[] }) {
  const id = `kpi-spark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const W = 200;
  const H = 36;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)} ${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Выручка за 30 дней">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="kpi-spark__stop-top" />
          <stop offset="1" className="kpi-spark__stop-bottom" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${id})`} />
      <path d={line} className="kpi-spark__line" vectorEffect="non-scaling-stroke" />
    </svg>
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
