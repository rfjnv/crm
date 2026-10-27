import { Link, useNavigate } from 'react-router-dom';
import { statusConfig } from '../DealStatusTag';
import { dealStatusTone } from '../dealStatusTone';
import type { DealStatus } from '../../types';
import './DealStagesBlock.css';

/** Этапы текущего процесса — по порядку, всегда (пустые серые) */
const PIPELINE: DealStatus[] = [
  'NEW',
  'WAITING_STOCK_CONFIRMATION',
  'STOCK_CONFIRMED',
  'IN_PROGRESS',
  'WAITING_FINANCE',
  'WAITING_WAREHOUSE_MANAGER',
  'PENDING_ADMIN',
  'READY_FOR_LOADING',
  'LOADING_ASSIGNED',
  'READY_FOR_DELIVERY',
  'IN_DELIVERY',
];
const FINAL = new Set<string>(['CLOSED', 'CANCELED', 'REJECTED']);

interface Props {
  counts: { status: string; count: number }[];
  closedInPeriod: number;
  closedLabel: string;
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/**
 * «Сделки в работе»: все этапы процесса по порядку, жёлтые — ждут чьего-то решения.
 * Устаревшие статусы — в конце, только если в них остались сделки. Закрытые — строкой внизу.
 */
export default function DealStagesBlock({ counts, closedInPeriod, closedLabel }: Props) {
  const navigate = useNavigate();
  const byStatus = new Map(counts.map((c) => [c.status, c.count]));
  const legacy = counts
    .filter((c) => c.count > 0 && !FINAL.has(c.status) && !PIPELINE.includes(c.status as DealStatus))
    .map((c) => c.status as DealStatus);
  const rows = [...PIPELINE, ...legacy].map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
    waiting: dealStatusTone(status) === 'warning',
  }));
  const total = rows.reduce((s, r) => s + r.count, 0);
  const waiting = rows.filter((r) => r.waiting).reduce((s, r) => s + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="stages-block">
      <header className="stages-block__head">
        <span className="stages-block__title">Сделки в работе</span>
        <span className="stages-block__sub">по этапам</span>
        <Link className="stages-block__link" to="/deals">Все ›</Link>
      </header>
      <div className="stages-block__total">
        {total}
        {waiting > 0 && <span className="stages-block__waiting">{waiting} {plural(waiting, ['ждёт', 'ждут', 'ждут'])} решения</span>}
      </div>
      <div className="stages-block__hint">жёлтые этапы ждут склад, финансы или админа</div>

      <div className="stages-block__list">
        {rows.map((r, i) => (
          <div key={r.status} className="stages-block__item">
          {i === PIPELINE.length && <div className="stages-block__legacy">Старые статусы</div>}
          <button
            type="button"
            className={`stages-block__row${r.count ? '' : ' stages-block__row--empty'}${r.waiting ? ' stages-block__row--wait' : ''}`}
            onClick={() => navigate(`/deals?status=${r.status}`)}
          >
            <span className="stages-block__name">
              <i />
              {statusConfig[r.status]?.label ?? r.status}
            </span>
            <span className="stages-block__bar"><i style={{ width: r.count ? `${Math.max(4, (r.count / max) * 100)}%` : 0 }} /></span>
            <span className="stages-block__count">{r.count}</span>
          </button>
          </div>
        ))}
      </div>

      <div className="stages-block__foot">
        <span>Закрыто {closedLabel}</span>
        <b>{closedInPeriod}</b>
      </div>
    </div>
  );
}
