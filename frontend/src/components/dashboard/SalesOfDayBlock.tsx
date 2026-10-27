import { useMemo, useState } from 'react';
import { Segmented } from 'antd';
import { formatUZS, formatCount, formatMoneyCompact } from '../../utils/currency';
import './SalesOfDayBlock.css';

export interface SalesItem {
  product: { id: string; name: string; sku?: string | null; unit?: string | null; category?: string | null };
  qty: number;
  revenue: number;
  stock?: number | null;
  avgDailyQty?: number;
  clients?: string[];
}

interface Props {
  title: string;
  /** День: переключатель «Сегодня / Вчера»; иначе — один выбранный период */
  isDay: boolean;
  current: SalesItem[];
  previous: SalesItem[];
  /** Подпись прошлого периода: «вчера», «пр. неделя» */
  prevWord: string;
}

const CAT_COLORS = ['#4f8cff', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];
const OTHER_COLOR = '#94a3b8';
const LIMIT = 8;

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

/** Один товар мог прийти несколькими строками (одинаковое имя/артикул) — складываем */
function merge(list: SalesItem[]): SalesItem[] {
  const map = new Map<string, SalesItem>();
  for (const it of list) {
    const key = `${it.product.name}__${it.product.sku || ''}__${it.product.unit || ''}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...it, qty: Number(it.qty) || 0, revenue: Number(it.revenue) || 0, clients: [...(it.clients ?? [])] });
    } else {
      prev.qty += Number(it.qty) || 0;
      prev.revenue += Number(it.revenue) || 0;
      prev.clients = [...new Set([...(prev.clients ?? []), ...(it.clients ?? [])])];
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

/** На сколько рабочих дней хватит остатка при средней продаже за 30 дней */
function stockForecast(it: SalesItem): { days: number | null; tone: 'risk' | 'warn' | 'ok' | 'none' } {
  if (it.stock == null) return { days: null, tone: 'none' };
  if (!it.avgDailyQty || it.avgDailyQty <= 0) return { days: null, tone: 'none' };
  const days = it.stock / it.avgDailyQty;
  return { days, tone: days < 2 ? 'risk' : days < 5 ? 'warn' : 'ok' };
}

/**
 * «Продажи дня»: кольцо по категориям и список товаров, у каждого — хватит ли остатка
 * (средняя продажа в рабочий день за 30 дней), клиенты и сумма за прошлый период.
 */
export default function SalesOfDayBlock({ title, isDay, current, previous, prevWord }: Props) {
  const [tab, setTab] = useState<'today' | 'yesterday'>('today');
  const [showAll, setShowAll] = useState(false);
  const items = useMemo(() => merge(tab === 'today' ? current : previous), [tab, current, previous]);
  const prevById = useMemo(() => {
    const m = new Map<string, number>();
    merge(previous).forEach((p) => m.set(p.product.id, p.revenue));
    return m;
  }, [previous]);
  const total = items.reduce((s, i) => s + i.revenue, 0);
  const compareWithPrev = tab === 'today';

  const cats = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((i) => {
      const c = i.product.category?.trim() || 'Без категории';
      map.set(c, (map.get(c) ?? 0) + i.revenue);
    });
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, CAT_COLORS.length - 1);
    const rest = sorted.slice(CAT_COLORS.length - 1).reduce((s, [, v]) => s + v, 0);
    const list = top.map(([name, value], i) => ({ name, value, color: CAT_COLORS[i] }));
    if (rest > 0) list.push({ name: 'Другое', value: rest, color: OTHER_COLOR });
    // Где начинается сегмент кольца — доля всех предыдущих категорий
    const sum = list.reduce((acc, c) => acc + c.value, 0) || 1;
    return list.map((c, i) => ({
      ...c,
      share: c.value / sum,
      start: list.slice(0, i).reduce((acc, x) => acc + x.value, 0) / sum,
    }));
  }, [items]);
  const catColor = (name?: string | null) => cats.find((c) => c.name === (name?.trim() || 'Без категории'))?.color ?? OTHER_COLOR;

  const R = 64;
  const C = 2 * Math.PI * R;
  const shown = showAll ? items : items.slice(0, LIMIT);

  return (
    <div className="sales-day">
      <header className="sales-day__head">
        <span className="sales-day__title">{title}</span>
        <span className="sales-day__sub">по категориям и товарам</span>
        {isDay && (
          <Segmented
            className="sales-day__seg"
            size="small"
            value={tab}
            onChange={(v) => { setTab(v as 'today' | 'yesterday'); setShowAll(false); }}
            options={[{ label: 'Сегодня', value: 'today' }, { label: 'Вчера', value: 'yesterday' }]}
          />
        )}
      </header>

      {items.length === 0 ? (
        <div className="sales-day__summary">{tab === 'today' ? 'Сегодня продаж пока нет' : 'Продаж не было'}</div>
      ) : (
        <>
          <div className="sales-day__summary">
            Продано <b>{items.length} {plural(items.length, ['товар', 'товара', 'товаров'])} на {formatUZS(total)}</b>
            {cats[0] && cats.length > 1 && <> · больше всего — <b>{cats[0].name.toLowerCase()}, {Math.round((cats[0].value / total) * 100)}%</b></>}
            {cats.length === 1 && <> · вся выручка — <b>{cats[0].name.toLowerCase()}</b></>}
          </div>

          <div className={`sales-day__grid${cats.length > 1 ? '' : ' sales-day__grid--single'}`}>
            {cats.length > 1 && (
              <div className="sales-day__cats">
                <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="Выручка по категориям">
                  {cats.map((c) => {
                    const len = c.share * C;
                    return (
                      <circle
                        key={c.name}
                        cx="80"
                        cy="80"
                        r={R}
                        fill="none"
                        stroke={c.color}
                        strokeWidth="20"
                        strokeDasharray={`${Math.max(0, len - 2)} ${C}`}
                        strokeDashoffset={-c.start * C}
                        transform="rotate(-90 80 80)"
                      >
                        <title>{`${c.name}: ${formatUZS(c.value)}`}</title>
                      </circle>
                    );
                  })}
                  <text x="80" y="78" textAnchor="middle" className="sales-day__donut-big">{short(total)}</text>
                  <text x="80" y="97" textAnchor="middle" className="sales-day__donut-sub">{tab === 'today' ? 'за день' : 'за вчера'}</text>
                </svg>
                <div className="sales-day__legend">
                  {cats.map((c) => (
                    <div key={c.name} className="sales-day__cat">
                      <i style={{ background: c.color }} />
                      <span>{c.name}</span>
                      <span>{short(c.value)} · {Math.round((c.value / total) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="sales-day__list">
              {shown.map((it, idx) => {
                const unit = it.product.unit?.trim() || 'шт';
                const f = stockForecast(it);
                const prev = prevById.get(it.product.id);
                const clients = it.clients ?? [];
                return (
                  <div key={it.product.id} className="sales-day__row">
                    <span className="sales-day__rank">{idx + 1}</span>
                    <div className="sales-day__main">
                      <div className="sales-day__name">
                        <i style={{ background: catColor(it.product.category) }} />
                        {it.product.name}
                      </div>
                      <div className="sales-day__meta">
                        {formatCount(it.qty)} {unit}
                        {clients.length > 0 && (
                          <span title={clients.join(', ')}>
                            {' · '}{clients.length === 1 ? clients[0] : `${clients.length} ${plural(clients.length, ['клиент', 'клиента', 'клиентов'])}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="sales-day__money">
                      <b>{formatUZS(it.revenue)}</b>
                      {compareWithPrev && (
                        <small className={prev ? undefined : 'sales-day__new'}>{prev ? `${prevWord} ${short(prev)}` : `${prevWord} не было`}</small>
                      )}
                    </div>
                    <div className="sales-day__stock" data-tone={f.tone}>
                      {it.stock != null ? (
                        <>
                          <span>
                            склад {formatCount(it.stock)} {unit}
                            {f.days != null && (
                              <b> · {f.days >= 14 ? 'хватит надолго' : `на ${Math.max(1, Math.floor(f.days))} ${plural(Math.max(1, Math.floor(f.days)), ['день', 'дня', 'дней'])}`}</b>
                            )}
                          </span>
                          {f.days != null && <span className="sales-day__sbar"><i style={{ width: `${Math.min(100, (f.days / 14) * 100)}%` }} /></span>}
                        </>
                      ) : <span>—</span>}
                    </div>
                  </div>
                );
              })}
              {items.length > LIMIT && (
                <button type="button" className="sales-day__more" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Свернуть' : `Показать все ${items.length}`}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
