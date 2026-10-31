import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, DatePicker, Empty, Input, Segmented, Select, Spin, Switch, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Column } from '@ant-design/charts';
import dayjs from 'dayjs';
import BackButton from '../components/BackButton';
import Section from '../components/ui/Section';
import StatTile, { StatGrid } from '../components/ui/StatTile';
import Money from '../components/ui/Money';
import StatusPill, { type StatusTone } from '../components/ui/StatusPill';
import CategoryClientProducts from '../components/CategoryClientProducts';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatPercent } from '../utils/currency';
import { axisFor, fmtQty, money, useChartLook } from '../components/history/historyChartUtils';
import {
  categoryAnalysisApi,
  type CategoryAnalysisResponse, type CategoryClientRow, type CategoryClientStatus, type CategoryManagerRow,
  type CategoryPeriod, type CategoryProductRow, type CategoryRow, type StockStatus,
} from '../api/categoryAnalysis.api';
import './CategoryAnalysisPage.css';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const OTHER_KEY = '__other__';
const TOP_STACK = 7;

/**
 * Свои цвета товаров на графике состава — как цвет их пачек, чтобы узнавались с первого взгляда.
 * Пара — светлая и тёмная тема; синий, зелёный и серый совпадают с палитрой графиков.
 */
const PRODUCT_COLOR: Record<string, [string, string]> = {
  'c21d2ddd-93ca-4022-a871-4fab5a39564b': ['#64748b', '#94a3b8'], // Термоклей в гранулах (фил) — серый
  'f24aabd1-e8d3-49d6-b5ff-399fdf6b51e0': ['#eab308', '#fbbf24'], // Термоклей в гранулах Q2000 — жёлтый
  'e4a5e061-1519-4bea-81d5-04e345b25c77': ['#2563eb', '#60a5fa'], // Термоклей в гранулах ок G880 — синий
  'b739ddfe-bd27-4ad0-843a-54edaa98c7cf': ['#059669', '#34d399'], // Термоклей в гранулах (бакавой) х3000 — зелёный
};

const monthLabel = (m: string) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;
const day = (d: string | null) => (d ? d.split('-').reverse().join('.') : '—');
const shiftMonth = (m: string, k: number) => {
  const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};
const delta = (v: number | null, digits: 0 | 1 = 0) => formatPercent(v, digits, { signed: true });
const tone = (v: number | null): StatusTone => (v == null ? 'neutral' : v > 2 ? 'positive' : v < -2 ? 'negative' : 'neutral');
const signedMoney = (v: number) => (v > 0 ? `+${money(v)}` : money(v));

/**
 * Внутри категории названия часто начинаются одинаково («Термоклей в гранулах Q2000»):
 * на графиках оставляем отличающуюся часть. Название, которое целиком равно общему началу,
 * остаётся как есть. Полное — в подсказке.
 */
function shortNames(names: string[]): Map<string, string> {
  const out = new Map(names.map((n) => [n, n]));
  const words = [...new Set(names)].map((n) => n.trim().split(/\s+/));
  if (words.length < 2) return out;
  let common = 0;
  while (words.every((w) => w[common] != null && w[common] === words[0][common])) common += 1;
  if (common < 2) return out;
  for (const n of names) {
    const rest = n.trim().split(/\s+/).slice(common).join(' ');
    out.set(n, rest || n);
  }
  return out;
}

function Change({ value, digits = 0 }: { value: number | null; digits?: 0 | 1 }) {
  if (value == null) return <span className="cat-new">новое</span>;
  return <span className={`cat-chg cat-chg--${tone(value)}`}>{delta(value, digits)}</span>;
}

const STOCK_LABEL: Record<StockStatus, { text: string; tone: StatusTone }> = {
  out: { text: 'нет на складе', tone: 'negative' },
  low: { text: 'меньше месяца', tone: 'warning' },
  ok: { text: 'в норме', tone: 'positive' },
  over: { text: 'запас > 6 мес', tone: 'neutral' },
  dead: { text: 'лежит без продаж', tone: 'warning' },
  none: { text: 'нет', tone: 'neutral' },
};

const CLIENT_LABEL: Record<CategoryClientStatus, { text: string; tone: StatusTone }> = {
  new: { text: 'новый', tone: 'positive' },
  lost: { text: 'ушёл', tone: 'negative' },
  up: { text: 'растёт', tone: 'positive' },
  down: { text: 'падает', tone: 'warning' },
  flat: { text: 'ровно', tone: 'neutral' },
};

// ── Мелкие графики ──

/** Мини-график выручки по месяцам периода. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 0);
  if (max <= 0) return <span className="cat-muted">—</span>;
  const w = 72, h = 20, step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg className="cat-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Горизонтальные полосы «сейчас / год назад» — подписи категорий читаются целиком. */
function PairBars({ rows, selected, onPick }: {
  rows: { key: string; name: string; full?: string; cur: number; prev: number; change: number | null }[];
  selected?: string | null;
  onPick?: (key: string) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.cur, r.prev)));
  return (
    <div className="cat-pairs">
      {rows.map((r) => {
        const body = (
          <>
            <span className="cat-pairs__name" title={r.full ?? r.name}>{r.name}</span>
            <span className="cat-pairs__bars">
              <span className="cat-pairs__cur" style={{ width: `${(r.cur / max) * 100}%` }} />
              <span className="cat-pairs__prev" style={{ width: `${(r.prev / max) * 100}%` }} />
            </span>
            <span className="cat-pairs__val">
              {money(r.cur)} <Change value={r.change} />
            </span>
          </>
        );
        const cls = `cat-pairs__row${selected && selected !== r.key ? ' cat-pairs__row--dim' : ''}`;
        return onPick ? (
          <button key={r.key} type="button" className={`${cls} cat-pairs__row--link`} onClick={() => onPick(r.key)}>{body}</button>
        ) : (
          <div key={r.key} className={cls}>{body}</div>
        );
      })}
    </div>
  );
}

/** Разница с прошлым годом: влево — потеря, вправо — прирост. */
function DeltaBars({ rows, onPick }: {
  rows: { key: string; name: string; full?: string; delta: number }[];
  onPick?: (key: string) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));
  return (
    <div className="cat-delta">
      {rows.map((r) => {
        const w = `${(Math.abs(r.delta) / max) * 50}%`;
        const body = (
          <>
            <span className="cat-delta__name" title={r.full ?? r.name}>{r.name}</span>
            <span className="cat-delta__track">
              <span className="cat-delta__axis" />
              <span
                className={`cat-delta__bar cat-delta__bar--${r.delta >= 0 ? 'up' : 'down'}`}
                style={r.delta >= 0 ? { left: '50%', width: w } : { right: '50%', width: w }}
              />
            </span>
            <span className={`cat-delta__val cat-chg--${r.delta >= 0 ? 'positive' : 'negative'}`}>{signedMoney(r.delta)}</span>
          </>
        );
        return onPick ? (
          <button key={r.key} type="button" className="cat-delta__row cat-delta__row--link" onClick={() => onPick(r.key)}>{body}</button>
        ) : (
          <div key={r.key} className="cat-delta__row">{body}</div>
        );
      })}
    </div>
  );
}

/** Мост «год назад → сейчас»: объём, цена, новые и выпавшие товары. */
function Bridge({ prev, cur, parts }: { prev: number; cur: number; parts: { label: string; hint: string; value: number }[] }) {
  const steps: { label: string; hint?: string; from: number; to: number; kind: 'total' | 'up' | 'down' }[] = [];
  steps.push({ label: 'Год назад', from: 0, to: prev, kind: 'total' });
  let run = prev;
  for (const p of parts) {
    if (Math.round(p.value) === 0) continue;
    steps.push({ label: p.label, hint: p.hint, from: run, to: run + p.value, kind: p.value >= 0 ? 'up' : 'down' });
    run += p.value;
  }
  steps.push({ label: 'Сейчас', from: 0, to: cur, kind: 'total' });
  const max = Math.max(1, ...steps.map((s) => Math.max(s.from, s.to)));
  return (
    <div className="cat-bridge">
      {steps.map((s) => {
        const lo = Math.min(s.from, s.to), hi = Math.max(s.from, s.to);
        return (
          <div key={s.label} className="cat-bridge__row">
            <span className="cat-bridge__name">
              {s.hint ? <Tooltip title={s.hint}><span className="cat-dotted">{s.label}</span></Tooltip> : s.label}
            </span>
            <span className="cat-bridge__track">
              <span className={`cat-bridge__bar cat-bridge__bar--${s.kind}`} style={{ left: `${(lo / max) * 100}%`, width: `${Math.max(0.4, ((hi - lo) / max) * 100)}%` }} />
            </span>
            <span className={`cat-bridge__val${s.kind === 'total' ? '' : ` cat-chg--${s.kind === 'up' ? 'positive' : 'negative'}`}`}>
              {s.kind === 'total' ? money(s.to) : signedMoney(s.to - s.from)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Матрица ABC × XYZ: сколько товаров и какую выручку даёт каждая клетка. */
function AbcXyz({ products }: { products: CategoryProductRow[] }) {
  const cols = ['X', 'Y', 'Z', 'NEW'] as const;
  const rows = ['A', 'B', 'C'] as const;
  const total = products.reduce((s, p) => s + p.rev, 0);
  const cell = (a: string, x: string) => {
    const list = products.filter((p) => p.abc === a && p.xyz === x);
    return { n: list.length, rev: list.reduce((s, p) => s + p.rev, 0), names: list.slice(0, 6).map((p) => p.name) };
  };
  const colHint: Record<string, string> = {
    X: 'X — берут ровно каждый месяц (разброс ≤ 10 %)',
    Y: 'Y — колебания 10–25 %',
    Z: 'Z — берут рывками, спрос трудно предсказать',
    NEW: 'Меньше 3 месяцев с продажами',
  };
  return (
    <div className="cat-abc">
      <span />
      {cols.map((c) => <Tooltip key={c} title={colHint[c]}><span className="cat-abc__head cat-dotted">{c === 'NEW' ? 'мало данных' : c}</span></Tooltip>)}
      {rows.map((a) => (
        <div key={a} className="cat-abc__line">
          <Tooltip title={a === 'A' ? 'A — первые 80 % выручки' : a === 'B' ? 'B — следующие 15 %' : 'C — последние 5 %'}>
            <span className="cat-abc__head cat-dotted">{a}</span>
          </Tooltip>
          {cols.map((x) => {
            const c = cell(a, x);
            return (
              <Tooltip key={x} title={c.n ? c.names.join(', ') + (c.n > c.names.length ? ` и ещё ${c.n - c.names.length}` : '') : undefined}>
                <span className={`cat-abc__cell cat-abc__cell--${a}${x === 'Z' || x === 'NEW' ? '-weak' : ''}${c.n ? '' : ' cat-abc__cell--empty'}`}>
                  <b>{c.n || '—'}</b>
                  {c.n > 0 && <small>{total > 0 ? formatPercent((c.rev / total) * 100, 0) : ''}</small>}
                </span>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Выводы ──

function insights(d: CategoryAnalysisResponse, onPick: (cat: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const t = d.totals;
  const dir = t.revChange == null ? 'появилась' : t.revChange >= 0 ? 'выросла' : 'упала';
  out.push(
    <>Выручка {dir} {t.revChange != null && <b className={`cat-chg--${tone(t.revChange)}`}>{formatPercent(Math.abs(t.revChange), 1)}</b>}: {money(t.revPrev)} → <b>{money(t.rev)}</b>.
      {' '}Заказов {t.orders.toLocaleString('ru-RU')} против {t.ordersPrev.toLocaleString('ru-RU')}, средний заказ {money(t.avgOrder)} против {money(t.avgOrderPrev)}.</>,
  );

  if (!d.category) {
    const cats = d.categories.map((c) => ({ ...c, delta: c.rev - c.revPrev }));
    const down = cats.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);
    const up = cats.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
    const link = (c: { name: string; delta: number }, i: number, arr: unknown[]) => (
      <span key={c.name}>
        <button type="button" className="cat-link" onClick={() => onPick(c.name)}>{c.name}</button> ({signedMoney(c.delta)}){i < arr.length - 1 ? ', ' : ''}
      </span>
    );
    if (down.length) out.push(<>Больше всего потеряли: {down.map(link)}.</>);
    if (up.length) out.push(<>Выросли: {up.map(link)}.</>);
    const so = d.categories.reduce((s, c) => ({ n: s.n + c.outOfStock, lost: s.lost + c.lostToStockout }), { n: 0, lost: 0 });
    if (so.lost > 0) {
      out.push(<>Товары, которых сейчас <b>нет на складе</b>, недобрали <b className="cat-chg--negative">{money(so.lost)}</b> к прошлому году ({so.n} товаров). Чаще всего падение — это нехватка товара, а не спроса.</>);
    }
  } else {
    const pv = d.priceVolume;
    out.push(<>Из чего изменение: объём {signedMoney(pv.volume)}, цена {signedMoney(pv.price)}, новые товары {signedMoney(pv.added)}, выпавшие товары {signedMoney(pv.dropped)}.</>);
    const falling = d.products.filter((p) => p.revPrev > 0 && p.rev < p.revPrev).sort((a, b) => (a.rev - a.revPrev) - (b.rev - b.revPrev)).slice(0, 3);
    if (falling.length) out.push(<>Сильнее всего упали: {falling.map((p) => `${p.name} (${signedMoney(p.rev - p.revPrev)})`).join(', ')}.</>);
    const out0 = d.products.filter((p) => p.stockStatus === 'out' && p.revPrev > 0);
    if (out0.length) {
      const lost = out0.reduce((s, p) => s + Math.max(0, p.revPrev - p.rev), 0);
      out.push(<><b>Нет на складе</b> {out0.length} товаров, которые год назад продавались: недобор <b className="cat-chg--negative">{money(lost)}</b>.</>);
    }
    const low = d.products.filter((p) => p.stockStatus === 'low');
    if (low.length) out.push(<>Заканчиваются (запаса меньше чем на месяц): {low.slice(0, 5).map((p) => p.name).join(', ')}{low.length > 5 ? ` и ещё ${low.length - 5}` : ''}.</>);
    const dead = d.products.filter((p) => p.stockStatus === 'dead');
    if (dead.length) out.push(<>Лежат без продаж 90 дней: {dead.length} товаров — {dead.slice(0, 4).map((p) => `${p.name} (${fmtQty(p.stock)} ${p.unit})`).join(', ')}.</>);
    const top3 = d.clients.slice(0, 3).reduce((s, c) => s + c.rev, 0);
    if (t.rev > 0 && d.clients.length > 3) out.push(<>Три крупнейших клиента дают {formatPercent((top3 / t.rev) * 100, 0)} выручки категории.</>);
  }

  if (t.lostClients > 0) {
    out.push(<>Ушли {t.lostClients} клиентов, которые год назад принесли <b>{money(t.revLost)}</b>; пришли {t.newClients} новых на {money(t.revNew)}.</>);
  }
  return out;
}

// ── Страница ──

export default function CategoryAnalysisPage() {
  const isMobile = useIsMobile();
  const look = useChartLook();
  const [sp, setSp] = useSearchParams();
  const period = (['ytd', 'r12', 'custom'].includes(sp.get('period') ?? '') ? sp.get('period') : 'ytd') as CategoryPeriod;
  const category = sp.get('category');
  const excludeOwn = sp.get('own') !== 'all';
  const from = sp.get('from') ?? undefined;
  const to = sp.get('to') ?? undefined;
  const [prodFilter, setProdFilter] = useState<'all' | 'down' | 'up' | 'out' | 'low' | 'dead' | 'new'>('all');
  const [clientFilter, setClientFilter] = useState<'all' | CategoryClientStatus>('all');
  const [prodQuery, setProdQuery] = useState('');
  const [clientQuery, setClientQuery] = useState('');

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) if (v == null) next.delete(k); else next.set(k, v);
    setSp(next, { replace: true });
  };
  const pickCategory = (c: string | null) => {
    set({ category: c });
    setProdFilter('all');
    setClientFilter('all');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['category-analysis', period, from, to, category, excludeOwn],
    queryFn: () => categoryAnalysisApi.get({ period, from, to, category, excludeOwn }),
    enabled: period !== 'custom' || (!!from && !!to),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const catRows = useMemo(() => (data?.categories ?? []).filter((c) => c.rev > 0 || c.revPrev > 0), [data]);
  const shortMap = useMemo(() => shortNames(data?.category ? data.products.map((x) => x.name) : []), [data]);
  const short = (name: string) => shortMap.get(name) ?? name;

  const monthCompare = useMemo(() => {
    if (!data) return [];
    const sum = (m: string) => data.monthly.filter((r) => r.month === m).reduce((s, r) => s + r.rev, 0);
    return data.curMonths.flatMap((m) => [
      { month: monthLabel(m), series: 'Год назад', value: sum(shiftMonth(m, -12)) },
      { month: monthLabel(m), series: 'Этот период', value: sum(m) },
    ]);
  }, [data]);

  const stack = useMemo(() => {
    if (!data) return { rows: [] as { month: string; name: string; value: number }[], names: [] as string[], keys: [] as string[] };
    const label = (k: string) => (k === OTHER_KEY ? 'Остальные' : data.category ? short(data.productNames?.[k] ?? k) : k);
    let keys: string[];
    if (data.category) keys = [...new Set(data.monthly.map((r) => r.key))].sort((a, b) => (a === OTHER_KEY ? 1 : b === OTHER_KEY ? -1 : 0));
    else {
      const top = catRows.slice().sort((a, b) => (b.rev + b.revPrev) - (a.rev + a.revPrev)).slice(0, TOP_STACK).map((c) => c.name);
      keys = [...top, OTHER_KEY];
    }
    const keySet = new Set(keys);
    const agg = new Map<string, number>();
    for (const r of data.monthly) {
      const k = keySet.has(r.key) ? r.key : OTHER_KEY;
      agg.set(`${r.month}|${k}`, (agg.get(`${r.month}|${k}`) ?? 0) + r.rev);
    }
    const rows = data.months.flatMap((m) => keys.map((k) => ({ month: monthLabel(m), name: label(k), value: agg.get(`${m}|${k}`) ?? 0 })));
    return { rows, names: keys.map(label), keys };
  }, [data, catRows, shortMap]);

  const products = useMemo(() => {
    const q = prodQuery.trim().toLowerCase();
    return (data?.products ?? []).filter((p) => {
      if (q && !`${p.name} ${p.sku}`.toLowerCase().includes(q)) return false;
      switch (prodFilter) {
        case 'down': return p.revPrev > 0 && p.rev < p.revPrev;
        case 'up': return p.rev > p.revPrev && p.revPrev > 0;
        case 'new': return p.revPrev <= 0 && p.rev > 0;
        case 'out': return p.stockStatus === 'out';
        case 'low': return p.stockStatus === 'low';
        case 'dead': return p.stockStatus === 'dead';
        default: return true;
      }
    });
  }, [data, prodFilter, prodQuery]);

  const clients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    return (data?.clients ?? []).filter((c) => (clientFilter === 'all' || c.status === clientFilter) && (!q || c.name.toLowerCase().includes(q)));
  }, [data, clientFilter, clientQuery]);

  const count = (pred: (p: CategoryProductRow) => boolean) => (data?.products ?? []).filter(pred).length;
  const ccount = (s: CategoryClientStatus) => (data?.clients ?? []).filter((c) => c.status === s).length;

  const catColumns: ColumnsType<CategoryRow> = [
    { title: 'Категория', dataIndex: 'name', key: 'name', fixed: isMobile ? undefined : 'left', width: 200,
      render: (v: string) => <button type="button" className="cat-link" onClick={() => pickCategory(v)}>{v}</button> },
    { title: 'Выручка', dataIndex: 'rev', key: 'rev', align: 'right', sorter: (a, b) => a.rev - b.rev, defaultSortOrder: 'descend', render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'Год назад', dataIndex: 'revPrev', key: 'revPrev', align: 'right', sorter: (a, b) => a.revPrev - b.revPrev, render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'Изм.', key: 'chg', align: 'right', sorter: (a, b) => (a.revChange ?? 1e9) - (b.revChange ?? 1e9), render: (_, r) => <Change value={r.revChange} /> },
    { title: 'Разница', key: 'delta', align: 'right', sorter: (a, b) => (a.rev - a.revPrev) - (b.rev - b.revPrev), render: (_, r) => <span className={`cat-chg--${tone(r.rev - r.revPrev)}`}>{signedMoney(r.rev - r.revPrev)}</span> },
    { title: 'Доля', dataIndex: 'share', key: 'share', align: 'right', sorter: (a, b) => a.share - b.share, render: (v: number) => formatPercent(v * 100, 1) },
    { title: 'Заказы', key: 'orders', align: 'right', sorter: (a, b) => a.orders - b.orders, render: (_, r) => <>{r.orders} <span className="cat-muted">/ {r.ordersPrev}</span></> },
    { title: 'Ср. заказ', dataIndex: 'avgOrder', key: 'avg', align: 'right', sorter: (a, b) => a.avgOrder - b.avgOrder, render: (v: number, r) => <Tooltip title={`год назад ${money(r.avgOrderPrev)}`}>{money(v)}</Tooltip> },
    { title: 'Клиенты', key: 'clients', align: 'right', sorter: (a, b) => a.clients - b.clients, render: (_, r) => <>{r.clients} <span className="cat-muted">/ {r.clientsPrev}</span></> },
    { title: <Tooltip title="Брали год назад, в этом периоде — ни разу"><span className="cat-dotted">Ушли</span></Tooltip>, key: 'lost', align: 'right', sorter: (a, b) => a.revLost - b.revLost,
      render: (_, r) => (r.lostClients ? <Tooltip title={`год назад принесли ${money(r.revLost)}`}><span className="cat-chg--negative">{r.lostClients}</span></Tooltip> : <span className="cat-muted">0</span>) },
    { title: 'Новые', dataIndex: 'newClients', key: 'new', align: 'right', render: (v: number) => (v ? <span className="cat-chg--positive">{v}</span> : <span className="cat-muted">0</span>) },
    { title: <Tooltip title="Сколько недобрали товары категории, которых сейчас нет на складе"><span className="cat-dotted">Нет на складе</span></Tooltip>, key: 'so', align: 'right', sorter: (a, b) => a.lostToStockout - b.lostToStockout,
      render: (_, r) => (r.outOfStock ? <span className="cat-chg--negative">{r.outOfStock} · {money(r.lostToStockout)}</span> : <span className="cat-muted">—</span>) },
  ];

  const prodColumns: ColumnsType<CategoryProductRow> = [
    { title: 'Товар', dataIndex: 'name', key: 'name', fixed: isMobile ? undefined : 'left', width: 260,
      render: (v: string, r) => (
        <div className="cat-prod">
          <Link to={`/inventory/products/${r.id}`}>{v}</Link>
          <span className="cat-muted">
            {!data?.category && <>{r.category} · </>}
            {r.abc && <Tooltip title="ABC — вклад в выручку, XYZ — ровность спроса по месяцам"><span className={`cat-tag cat-tag--${r.abc}`}>{r.abc}{r.xyz && r.xyz !== 'NEW' ? r.xyz : ''}</span></Tooltip>}
          </span>
        </div>
      ) },
    { title: 'Выручка', dataIndex: 'rev', key: 'rev', align: 'right', sorter: (a, b) => a.rev - b.rev, defaultSortOrder: 'descend', render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'Год назад', dataIndex: 'revPrev', key: 'revPrev', align: 'right', sorter: (a, b) => a.revPrev - b.revPrev, render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'Изм.', key: 'chg', align: 'right', sorter: (a, b) => (a.rev - a.revPrev) - (b.rev - b.revPrev), render: (_, r) => (r.rev || r.revPrev ? <Change value={r.revChange} /> : <span className="cat-muted">—</span>) },
    { title: 'По месяцам', key: 'spark', width: 90, render: (_, r) => <Sparkline values={r.monthly} /> },
    { title: 'Кол-во', key: 'qty', align: 'right', sorter: (a, b) => a.qty - b.qty,
      render: (_, r) => <Tooltip title={`год назад ${fmtQty(r.qtyPrev)} ${r.unit}`}>{fmtQty(r.qty)} <span className="cat-muted">{r.unit}</span></Tooltip> },
    { title: 'Ср. цена', key: 'price', align: 'right', sorter: (a, b) => (a.priceChange ?? 0) - (b.priceChange ?? 0),
      render: (_, r) => (r.price != null
        ? <Tooltip title={r.pricePrev != null ? `год назад ${money(r.pricePrev)}` : 'год назад не продавался'}>{money(r.price)} {r.priceChange != null && Math.abs(r.priceChange) >= 1 && <Change value={r.priceChange} />}</Tooltip>
        : <span className="cat-muted">—</span>) },
    { title: 'Клиенты', key: 'clients', align: 'right', sorter: (a, b) => a.clients - b.clients, render: (_, r) => <>{r.clients} <span className="cat-muted">/ {r.clientsPrev}</span></> },
    { title: <Tooltip title="Остаток сейчас и на сколько месяцев его хватит при продажах последних 90 дней"><span className="cat-dotted">Склад</span></Tooltip>, key: 'stock', align: 'right',
      sorter: (a, b) => a.stock - b.stock,
      render: (_, r) => (
        <div className="cat-stock">
          <span>{fmtQty(r.stock)} <span className="cat-muted">{r.unit}</span>{r.coverMonths != null && r.coverMonths > 0 && <span className="cat-muted"> · {r.coverMonths} мес</span>}</span>
          {r.stockStatus !== 'ok' && r.stockStatus !== 'none' && <StatusPill tone={STOCK_LABEL[r.stockStatus].tone}>{STOCK_LABEL[r.stockStatus].text}</StatusPill>}
        </div>
      ) },
    { title: 'Последняя продажа', dataIndex: 'lastSale', key: 'last', align: 'right', sorter: (a, b) => (a.lastSale ?? '').localeCompare(b.lastSale ?? ''), render: (v: string | null) => day(v) },
  ];
  if (!data?.category) prodColumns.splice(9, 1); // последняя продажа считается только внутри категории

  const clientColumns: ColumnsType<CategoryClientRow> = [
    { title: 'Клиент', dataIndex: 'name', key: 'name', fixed: isMobile ? undefined : 'left', width: 220,
      render: (v: string, r) => <div className="cat-prod"><Link to={`/clients/${r.id}`}>{v}</Link>{r.own && <span className="cat-muted">своя компания</span>}</div> },
    { title: 'Статус', dataIndex: 'status', key: 'status', render: (v: CategoryClientStatus) => <StatusPill tone={CLIENT_LABEL[v].tone}>{CLIENT_LABEL[v].text}</StatusPill> },
    { title: 'Выручка', dataIndex: 'rev', key: 'rev', align: 'right', sorter: (a, b) => a.rev - b.rev, defaultSortOrder: 'descend', render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'Год назад', dataIndex: 'revPrev', key: 'revPrev', align: 'right', sorter: (a, b) => a.revPrev - b.revPrev, render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'Разница', key: 'delta', align: 'right', sorter: (a, b) => (a.rev - a.revPrev) - (b.rev - b.revPrev), render: (_, r) => <span className={`cat-chg--${tone(r.rev - r.revPrev)}`}>{signedMoney(r.rev - r.revPrev)}</span> },
    { title: 'Заказы', key: 'orders', align: 'right', sorter: (a, b) => a.orders - b.orders, render: (_, r) => <>{r.orders} <span className="cat-muted">/ {r.ordersPrev}</span></> },
    { title: 'Последняя покупка', dataIndex: 'lastBuy', key: 'last', align: 'right', sorter: (a, b) => (a.lastBuy ?? '').localeCompare(b.lastBuy ?? ''), render: (v: string | null) => day(v) },
    { title: 'Менеджер', dataIndex: 'managerName', key: 'manager' },
  ];

  const managerColumns: ColumnsType<CategoryManagerRow> = [
    { title: 'Менеджер', dataIndex: 'name', key: 'name' },
    { title: 'Выручка', dataIndex: 'rev', key: 'rev', align: 'right', sorter: (a, b) => a.rev - b.rev, defaultSortOrder: 'descend', render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'Год назад', dataIndex: 'revPrev', key: 'revPrev', align: 'right', render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'Изм.', key: 'chg', align: 'right', sorter: (a, b) => (a.revChange ?? 1e9) - (b.revChange ?? 1e9), render: (_, r) => (r.rev || r.revPrev ? <Change value={r.revChange} /> : '—') },
    { title: 'Клиенты', key: 'clients', align: 'right', render: (_, r) => <>{r.clients} <span className="cat-muted">/ {r.clientsPrev}</span></> },
    { title: 'Заказы', dataIndex: 'orders', key: 'orders', align: 'right' },
  ];

  const p = data?.periods;
  const rangeText = p ? `${day(p.cur.from)} – ${day(p.cur.to)} против ${day(p.prev.from)} – ${day(p.prev.to)}` : '';
  const t = data?.totals;
  const lostToStock = data
    ? (data.category
      ? data.products.filter((x) => x.stockStatus === 'out' && x.revPrev > 0).reduce((s, x) => s + Math.max(0, x.revPrev - x.rev), 0)
      : data.categories.reduce((s, c) => s + c.lostToStockout, 0))
    : 0;
  // «Остальные» — серым; товары со своим цветом — своим; прочие берут свободные цвета палитры по порядку
  const dark = look.theme === 'classicDark';
  const fixed = (k: string) => PRODUCT_COLOR[k]?.[dark ? 1 : 0];
  const taken = new Set(stack.keys.map(fixed).filter(Boolean));
  const free = look.series.filter((c) => !taken.has(c));
  let nextFree = 0;
  const chartColors = stack.keys.map((k) => (k === OTHER_KEY ? look.years(1) : fixed(k) ?? free[nextFree++ % free.length]));

  return (
    <div className="cat-page" style={{ padding: isMobile ? 12 : 24 }}>
      <div className="cat-head">
        <div className="cat-title">
          <BackButton fallback="/analytics" />
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {category
                ? <><button type="button" className="cat-crumb" onClick={() => pickCategory(null)}>Анализ категорий</button> <span className="cat-muted">›</span> {category}</>
                : 'Анализ категорий'}
            </Title>
            <Text type="secondary">{rangeText}</Text>
          </div>
        </div>
        <div className="cat-controls">
          <Segmented
            value={period}
            onChange={(v) => set({ period: String(v), ...(v !== 'custom' ? { from: null, to: null } : {}) })}
            options={[
              { label: 'С начала года', value: 'ytd' },
              { label: '12 месяцев', value: 'r12' },
              { label: 'Свой период', value: 'custom' },
            ]}
          />
          {period === 'custom' && (
            <RangePicker
              format="DD.MM.YYYY"
              value={from && to ? [dayjs(from), dayjs(to)] : null}
              onChange={(v) => v?.[0] && v[1] && set({ from: v[0].format('YYYY-MM-DD'), to: v[1].format('YYYY-MM-DD') })}
            />
          )}
          <Select
            className="cat-select"
            allowClear
            showSearch
            placeholder="Все категории"
            value={category ?? undefined}
            onChange={(v) => pickCategory(v ?? null)}
            options={catRows.map((c) => ({ value: c.name, label: c.name }))}
          />
          <Tooltip title="Базис Принт и ППС — свои компании (клиенты с отметкой «аффилированный»). Их закупки не показывают спрос рынка.">
            <label className="cat-switch">
              <Switch size="small" checked={excludeOwn} onChange={(v) => set({ own: v ? null : 'all' })} />
              <span>Без своих компаний</span>
            </label>
          </Tooltip>
        </div>
      </div>

      {error && <Alert type="error" showIcon message="Не удалось загрузить анализ" description={(error as Error).message} />}
      {period === 'custom' && (!from || !to) && <Alert type="info" showIcon message="Выберите даты: прошлый период подставится сам — те же даты годом раньше." />}

      {isLoading ? (
        <div className="cat-loading"><Spin size="large" /></div>
      ) : data && t ? (
        <div className={`cat-body${isFetching ? ' cat-body--fetching' : ''}`}>
          <Section>
            <StatGrid columns={isMobile ? 2 : 3}>
              <StatTile label="Выручка" value={<Money value={t.rev} variant="compact" />} delta={t.revChange} base={`год назад ${money(t.revPrev)}`} />
              <StatTile label="Заказы" value={t.orders.toLocaleString('ru-RU')} delta={t.ordersPrev ? (t.orders / t.ordersPrev - 1) * 100 : null} base={`год назад ${t.ordersPrev}`} />
              <StatTile label="Средний заказ" value={<Money value={t.avgOrder} variant="compact" />} delta={t.avgOrderPrev ? (t.avgOrder / t.avgOrderPrev - 1) * 100 : null} base={`год назад ${money(t.avgOrderPrev)}`} />
              <StatTile label="Клиенты" value={t.clients} delta={t.clientsPrev ? (t.clients / t.clientsPrev - 1) * 100 : null} base={`+${t.newClients} новых · −${t.lostClients} ушли`} />
              <StatTile label="Товары в продаже" value={t.products} delta={t.productsPrev ? (t.products / t.productsPrev - 1) * 100 : null} base={`год назад ${t.productsPrev}`} />
              <StatTile
                label={<Tooltip title="Сколько недобрали к прошлому году товары, которых сейчас нет на складе"><span className="cat-dotted">Недобор: нет на складе</span></Tooltip>}
                value={<span className={lostToStock > 0 ? 'cat-chg--negative' : undefined}>{money(lostToStock)}</span>}
                base={`ушедшие клиенты: ${money(t.revLost)}`}
              />
            </StatGrid>
          </Section>

          <Section title="Выводы">
            <ul className="cat-insights">
              {insights(data, pickCategory).map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </Section>

          {!category ? (
            <div className="cat-grid">
              <Section title="Выручка по категориям" extra={<span className="cat-legend"><i className="cat-legend__cur" />сейчас <i className="cat-legend__prev" />год назад</span>}>
                <PairBars
                  rows={catRows.map((c) => ({ key: c.name, name: c.name, cur: c.rev, prev: c.revPrev, change: c.revChange }))}
                  onPick={pickCategory}
                />
              </Section>
              <Section title="Кто прибавил, кто потерял">
                <DeltaBars
                  rows={catRows.map((c) => ({ key: c.name, name: c.name, delta: c.rev - c.revPrev })).filter((r) => Math.abs(r.delta) >= 1_000_000).sort((a, b) => b.delta - a.delta)}
                  onPick={pickCategory}
                />
              </Section>
            </div>
          ) : (
            <div className="cat-grid">
              <Section title="Почему изменилась выручка">
                <Bridge
                  prev={t.revPrev}
                  cur={t.rev}
                  parts={[
                    { label: 'Объём', hint: 'Больше или меньше продали тех же товаров (по прошлогодней цене)', value: data.priceVolume.volume },
                    { label: 'Цена', hint: 'Изменение средней цены тех же товаров', value: data.priceVolume.price },
                    { label: 'Новые товары', hint: 'Товары, которые год назад не продавались', value: data.priceVolume.added },
                    { label: 'Выпавшие товары', hint: 'Год назад продавались, в этом периоде — нет', value: data.priceVolume.dropped },
                  ]}
                />
              </Section>
              <Section title="ABC × XYZ товаров">
                <AbcXyz products={data.products.filter((x) => x.rev > 0)} />
                <Text type="secondary" className="cat-note">Число — товары в клетке, ниже — их доля выручки. AX — опора ассортимента, держите всегда в наличии; CZ — кандидаты на вывод.</Text>
              </Section>
              <Section title="Товары: сейчас и год назад" extra={<span className="cat-legend"><i className="cat-legend__cur" />сейчас <i className="cat-legend__prev" />год назад</span>}>
                <PairBars
                  rows={data.products.filter((x) => x.rev > 0 || x.revPrev > 0).slice(0, 15).map((x) => ({ key: x.id, name: short(x.name), full: x.name, cur: x.rev, prev: x.revPrev, change: x.revChange }))}
                />
              </Section>
              <Section title="Кто прибавил, кто потерял">
                <DeltaBars
                  rows={data.products.map((x) => ({ key: x.id, name: short(x.name), full: x.name, delta: x.rev - x.revPrev }))
                    .filter((r) => Math.abs(r.delta) > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 15)
                    .sort((a, b) => b.delta - a.delta)}
                />
              </Section>
            </div>
          )}

          <div className="cat-grid">
            <Section title={`По месяцам: ${category ?? 'все категории'}`}>
              <Column                key={look.theme}                data={monthCompare}
                xField="month"
                yField="value"
                colorField="series"
                group
                height={280}
                theme={look.theme}
                scale={{ color: { domain: ['Год назад', 'Этот период'], range: [look.years(1), look.current] }, x: { paddingInner: 0.3 } }}
                style={{ maxWidth: 28, radiusTopLeft: 3, radiusTopRight: 3 }}
                axis={axisFor(look, (v) => money(v))}
                legend={{ color: { position: 'top', itemLabelFill: look.text2, itemMarker: 'circle' } }}
                tooltip={{ title: 'month', items: [(d: { series: string; value: number }) => ({ name: d.series, value: money(d.value) })] }}
              />
            </Section>
            <Section title={category ? 'Состав по товарам' : 'Состав по категориям'}>
              <Column                key={look.theme}                data={stack.rows}
                xField="month"
                yField="value"
                colorField="name"
                stack
                height={280}
                theme={look.theme}
                scale={{ color: { domain: stack.names, range: chartColors }, x: { paddingInner: 0.25 } }}
                style={{ maxWidth: 26 }}
                axis={axisFor(look, (v) => money(v))}
                legend={{ color: { position: 'top', itemLabelFill: look.text2, itemMarker: 'circle', maxRows: 3 } }}
                tooltip={{ title: 'month', items: [(d: { name: string; value: number }) => ({ name: d.name, value: money(d.value) })] }}
                interaction={{ elementHighlightByColor: true }}
              />
            </Section>
          </div>

          {!category && (
            <Section title="Все категории" count={catRows.length}>
              <Table
                size="small"
                rowKey="name"
                columns={catColumns}
                dataSource={catRows}
                pagination={false}
                scroll={{ x: 1300 }}
                onRow={(r) => ({ onDoubleClick: () => pickCategory(r.name) })}
              />
            </Section>
          )}

          <Section title={category ? 'Товары категории' : 'Все товары'} count={products.length}>
            <div className="cat-tools">
              <Segmented
                size="small"
                value={prodFilter}
                onChange={(v) => setProdFilter(v as typeof prodFilter)}
                options={[
                  { label: 'Все', value: 'all' },
                  { label: `Падают · ${count((x) => x.revPrev > 0 && x.rev < x.revPrev)}`, value: 'down' },
                  { label: `Растут · ${count((x) => x.revPrev > 0 && x.rev > x.revPrev)}`, value: 'up' },
                  { label: `Новые · ${count((x) => x.revPrev <= 0 && x.rev > 0)}`, value: 'new' },
                  { label: `Нет на складе · ${count((x) => x.stockStatus === 'out')}`, value: 'out' },
                  { label: `Заканчиваются · ${count((x) => x.stockStatus === 'low')}`, value: 'low' },
                  ...(category ? [{ label: `Без продаж · ${count((x) => x.stockStatus === 'dead')}`, value: 'dead' }] : []),
                ]}
              />
              <Input.Search allowClear placeholder="Товар или артикул" value={prodQuery} onChange={(e) => setProdQuery(e.target.value)} className="cat-search" />
            </div>
            <Table
              size="small"
              rowKey="id"
              columns={prodColumns}
              dataSource={products}
              pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
              scroll={{ x: 1200 }}
              locale={{ emptyText: <Empty description="Нет товаров" /> }}
            />
          </Section>

          <div className="cat-grid cat-grid--wide-left">
            <Section title={category ? 'Клиенты категории' : 'Клиенты'} count={clients.length}>
              <div className="cat-tools">
                <Segmented
                  size="small"
                  value={clientFilter}
                  onChange={(v) => setClientFilter(v as typeof clientFilter)}
                  options={[
                    { label: 'Все', value: 'all' },
                    { label: `Ушли · ${ccount('lost')}`, value: 'lost' },
                    { label: `Падают · ${ccount('down')}`, value: 'down' },
                    { label: `Растут · ${ccount('up')}`, value: 'up' },
                    { label: `Новые · ${ccount('new')}`, value: 'new' },
                  ]}
                />
                <Input.Search allowClear placeholder="Клиент" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} className="cat-search" />
              </div>
              <Table
                size="small"
                rowKey="id"
                columns={clientColumns}
                dataSource={clients}
                pagination={{ pageSize: 30, hideOnSinglePage: true, showSizeChanger: false }}
                scroll={{ x: 900 }}
              />
            </Section>
            <Section title="Менеджеры" count={data.managers.length}>
              <Table size="small" rowKey="id" columns={managerColumns} dataSource={data.managers} pagination={false} scroll={{ x: 560 }} />
            </Section>
          </div>

          {/* Длинный список — в самом низу страницы, на всю ширину */}
          {category && <CategoryClientProducts data={data} short={short} />}

          <Text type="secondary" className="cat-note">
            Выручка — как во всей аналитике CRM: закрытые сделки и сессионные, по дате позиции, по Ташкенту.
            «Заказ» — сделка. Остатки и запас склада — на сегодня, запас считается от продаж за последние 90 дней.
          </Text>
        </div>
      ) : null}
    </div>
  );
}
