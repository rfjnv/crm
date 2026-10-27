import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { formatCount } from '../../utils/currency';
import type { DashboardStockIssue } from '../../types';
import './StockIssuesBlock.css';

type Filter = 'urgent' | 'zero' | 'low' | 'dead';

/** Рабочих дней в месяце — на столько считаем «заказать» */
const MONTH_WORK_DAYS = 26;
const LIMIT = 8;

interface Row extends DashboardStockIssue {
  zero: boolean;
  days: number | null;
  order: number;
  /** 0 — кончилось ходовое, 1 — кончится за неделю, 2 — продаётся, но пока хватает, 3 — не продаётся */
  priority: 0 | 1 | 2 | 3;
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

const qty = (n: number) => formatCount(Math.round(n * 10) / 10);

/**
 * «Склад: что заканчивается»: проблемные остатки по срочности — ходовое, которое кончилось
 * или кончится за неделю, сверху; что уже едет в импорте и сколько дозаказать на месяц.
 */
export default function StockIssuesBlock({ zero, low }: { zero: DashboardStockIssue[]; low: DashboardStockIssue[] }) {
  const navigate = useNavigate();
  const rows = useMemo<Row[]>(() => {
    const all = [...zero.map((p) => ({ ...p, zero: true })), ...low.map((p) => ({ ...p, zero: false }))]
      .filter((p) => !p.sku?.startsWith('TARGET'));
    return all.map((p) => {
      const avg = p.avgDailyQty ?? 0;
      const days = avg > 0 ? p.stock / avg : null;
      const order = avg > 0 ? Math.max(0, Math.ceil(avg * MONTH_WORK_DAYS - p.stock - (p.inTransit?.qty ?? 0))) : 0;
      const priority: Row['priority'] = avg <= 0 ? 3 : p.stock <= 0 ? 0 : days != null && days < 7 ? 1 : 2;
      return { ...p, days, order, priority };
    }).sort((a, b) => a.priority - b.priority || (b.avgDailyQty ?? 0) - (a.avgDailyQty ?? 0));
  }, [zero, low]);

  const counts = {
    urgent: rows.filter((r) => r.priority <= 1).length,
    zero: rows.filter((r) => r.zero).length,
    low: rows.filter((r) => !r.zero).length,
    dead: rows.filter((r) => r.priority === 3).length,
  };
  const [filter, setFilter] = useState<Filter | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visible = rows.filter((r) => (
    filter === 'urgent' ? r.priority <= 1
      : filter === 'zero' ? r.zero
        : filter === 'low' ? !r.zero
          : filter === 'dead' ? r.priority === 3
            : true
  ));
  const shown = showAll ? visible : visible.slice(0, LIMIT);

  const tiles: { key: Filter; value: number; label: string; tone?: string }[] = [
    { key: 'urgent', value: counts.urgent, label: 'срочно — продаётся, а кончилось или кончится за неделю', tone: counts.urgent ? 'risk' : undefined },
    { key: 'zero', value: counts.zero, label: 'нет в наличии' },
    { key: 'low', value: counts.low, label: 'ниже минимума' },
    { key: 'dead', value: counts.dead, label: 'не продаётся 30 дней — можно не дозаказывать', tone: 'muted' },
  ];

  return (
    <div className="stock-block">
      <header className="stock-block__head">
        <span className="stock-block__title">Склад: что заканчивается</span>
        <Link className="stock-block__link" to="/inventory/warehouse">Весь склад ›</Link>
      </header>

      {rows.length === 0 ? (
        <div className="stock-block__ok">Все товары в достаточном количестве</div>
      ) : (
        <>
          <div className="stock-block__tiles">
            {tiles.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`stock-block__tile${filter === t.key ? ' is-on' : ''}`}
                data-tone={t.tone}
                onClick={() => { setFilter((f) => (f === t.key ? null : t.key)); setShowAll(false); }}
              >
                <b>{t.value}</b>
                <small>{t.label}</small>
              </button>
            ))}
          </div>

          <div className="stock-block__row stock-block__row--head">
            <span />
            <span>Товар</span>
            <span>Остаток / минимум</span>
            <span>Продаётся</span>
            <span>Что делать</span>
          </div>
          {shown.map((r) => {
            const unit = r.unit?.trim() || 'шт';
            const avg = r.avgDailyQty ?? 0;
            return (
              <button key={r.id} type="button" className="stock-block__row" data-p={r.priority} onClick={() => navigate(`/inventory/products/${r.id}`)}>
                <span className="stock-block__dot" />
                <span className="stock-block__main">
                  <span className="stock-block__name">{r.name}</span>
                  <span className="stock-block__sku">{r.sku}</span>
                </span>
                <span className="stock-block__stock">
                  <span>
                    <b className={r.zero ? 'is-zero' : 'is-low'}>{r.zero ? 'нет' : `${qty(r.stock)} ${unit}`}</b>
                    <small> / мин {qty(r.minStock)}</small>
                  </span>
                  <span className="stock-block__bar"><i style={{ width: `${r.minStock > 0 ? Math.min(100, (r.stock / r.minStock) * 100) : 0}%` }} /></span>
                </span>
                <span className="stock-block__sales">
                  {avg > 0 ? `~${qty(avg * 6)} ${unit} в неделю` : <span className="is-muted">не продаётся</span>}
                  {r.days != null && <small>{r.zero ? 'кончился' : `хватит на ${Math.max(1, Math.floor(r.days))} ${plural(Math.max(1, Math.floor(r.days)), ['день', 'дня', 'дней'])}`}</small>}
                </span>
                <span className="stock-block__act">
                  {r.inTransit ? (
                    <span className="stock-block__pill" data-tone="transit" title={`Импортный заказ ${r.inTransit.number}`}>
                      в пути · {qty(r.inTransit.qty)} {unit}{r.inTransit.eta ? `, ~${dayjs(r.inTransit.eta).locale('ru').format('D MMM').replace('.', '')}` : ''}
                    </span>
                  ) : avg <= 0 ? (
                    <span className="stock-block__pill" data-tone="muted">не продаётся</span>
                  ) : r.order === 0 ? (
                    <span className="stock-block__pill" data-tone="muted">пока хватает</span>
                  ) : (
                    <span className="stock-block__pill" data-tone={r.priority === 0 ? 'risk' : 'warn'}>заказать ~{formatCount(r.order)} {unit}</span>
                  )}
                </span>
              </button>
            );
          })}
          {visible.length > LIMIT && (
            <button type="button" className="stock-block__more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Свернуть' : `Показать все ${visible.length}`}
            </button>
          )}
          {visible.length === 0 && <div className="stock-block__ok">В этой группе товаров нет</div>}
        </>
      )}
    </div>
  );
}
