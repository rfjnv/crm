import { useId, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { statusConfig } from '../DealStatusTag';
import type { DealStatus } from '../../types';
import { formatCount, formatMoneyCompact, formatUZS } from '../../utils/currency';
import './KpiExtras.css';

/** «48,3 млн» вместо «48 250 000 so'm»; полная сумма — в подсказке при наведении. */
export function CompactMoney({ value }: { value: number }) {
  const m = formatMoneyCompact(value);
  return (
    <span title={formatUZS(value)}>
      {m.text}
      {m.unit && <span className="kpi-unit"> {m.unit}</span>}
    </span>
  );
}

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
 * «У зав. склада 16 · Ожидает финансы 4 · Новая 3» — три самых больших этапа среди активных.
 * Каждый этап — переход в список сделок с этим фильтром (карточка сама остаётся ссылкой на все сделки).
 */
export function ActiveStages({ counts }: { counts: { status: string; count: number }[] }) {
  const navigate = useNavigate();
  const top = counts
    .filter((d) => d.count > 0 && !FINAL.has(d.status))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  if (top.length === 0) return null;
  return (
    <span className="kpi-stages">
      {top.map((d) => (
        <button
          key={d.status}
          type="button"
          className="kpi-stages__item"
          onClick={(e) => {
            // Карточка обёрнута ссылкой на все сделки — здесь ведём в отфильтрованный список
            e.preventDefault();
            e.stopPropagation();
            navigate(`/deals?status=${d.status}`);
          }}
        >
          {statusConfig[d.status as DealStatus]?.label ?? d.status} <b>{formatCount(d.count)}</b>
        </button>
      ))}
    </span>
  );
}
