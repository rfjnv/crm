import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { formatMoneyCompact } from '../../utils/currency';
import type { ReanimationClientRow } from '../../types';
import './TopsRow.css';

export interface TopRow {
  key: string;
  label: ReactNode;
  value: number;
  /** Подпись под суммой справа (доля, сделки) */
  note?: string;
  href: string;
}

const short = (v: number) => {
  const m = formatMoneyCompact(v);
  return m.unit ? `${m.text} ${m.unit}` : m.text;
};

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

interface CardProps {
  title: string;
  sub: string;
  link: { to: string; label: string };
  summary?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}

export function TopCard({ title, sub, link, summary, extra, children }: CardProps) {
  return (
    <div className="tops-card">
      <header className="tops-card__head">
        <span className="tops-card__title">{title}</span>
        <span className="tops-card__sub">{sub}</span>
        <Link className="tops-card__link" to={link.to}>{link.label} ›</Link>
      </header>
      {summary && <div className="tops-card__summary">{summary}</div>}
      {extra}
      {children}
    </div>
  );
}

export function TopList({ rows, loading }: { rows: TopRow[]; loading?: boolean }) {
  const navigate = useNavigate();
  if (loading) return <div className="tops-card__empty">Загружаем…</div>;
  if (rows.length === 0) return <div className="tops-card__empty">Нет данных за период</div>;
  const max = Math.max(1, rows[0].value);
  return (
    <div className="tops-list">
      {rows.map((r, i) => (
        <button key={r.key} type="button" className="tops-row" onClick={() => navigate(r.href)}>
          <span className={`tops-row__rank${i === 0 ? ' tops-row__rank--first' : ''}`}>{i + 1}</span>
          <span className="tops-row__main">
            <span className="tops-row__label">{r.label}</span>
            <span className="tops-row__bar"><i style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} /></span>
          </span>
          <span className="tops-row__value">
            {short(r.value)}
            {r.note && <small>{r.note}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Место менеджера среди всех — без чужих сумм: только место и сколько до следующего */
export function MyRank({ place, of, gap }: { place: number; of: number; gap: number | null }) {
  return (
    <div className="tops-rank">
      <b>{place}</b>
      <span>
        место из {of} {plural(of, ['менеджера', 'менеджеров', 'менеджеров'])}
        <br />
        {place === 1 ? <>вы лидер месяца</> : gap != null ? <>до {place - 1}-го места — <strong>{short(gap)}</strong></> : null}
      </span>
    </div>
  );
}

/**
 * «Пора позвонить»: клиенты менеджера, которые давно не покупали (реанимация): сначала
 * постоянные с обычным интервалом покупок, потом купившие один раз.
 */
export function QuietClients({ rows, loading }: { rows: ReanimationClientRow[]; loading?: boolean }) {
  const navigate = useNavigate();
  if (loading) return <div className="tops-card__empty">Загружаем…</div>;
  if (rows.length === 0) return <div className="tops-card__empty">Все клиенты покупают вовремя — звонить некому</div>;
  return (
    <div className="tops-list">
      {rows.map((c) => {
        const deals = c.closedDealsCount;
        const span = dayjs(c.lastPurchaseAt).diff(dayjs(c.firstPurchaseAt), 'day');
        const interval = deals > 1 ? Math.max(1, Math.round(span / (deals - 1))) : null;
        return (
          <button key={c.clientId} type="button" className="tops-row tops-row--quiet" onClick={() => navigate(`/clients/${c.clientId}`)}>
            <span className={`tops-row__rank tops-row__rank--${c.status === 'CHURNED' ? 'risk' : 'warn'}`}>!</span>
            <span className="tops-row__main">
              <span className="tops-row__label">{c.companyName}</span>
              <span className="tops-row__meta">
                {interval
                  ? `обычно раз в ${interval} дн. · не было ${c.daysSinceLastPurchase ?? '—'} дн.`
                  : `купил один раз · ${c.daysSinceLastPurchase ?? '—'} дн. назад`}
              </span>
            </span>
            <span className="tops-row__value">
              {short(c.totalRevenue)}
              <small>{deals} {plural(deals, ['сделка', 'сделки', 'сделок'])}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
