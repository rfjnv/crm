import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Empty, Segmented, Select, Spin, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import BackButton from '../components/BackButton';
import Section from '../components/ui/Section';
import StatTile, { StatGrid } from '../components/ui/StatTile';
import Money from '../components/ui/Money';
import StatusPill, { type StatusTone } from '../components/ui/StatusPill';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatPercent } from '../utils/currency';
import { fmtQty, money } from '../components/history/historyChartUtils';
import type { CategoryScope } from '../api/categoryAnalysis.api';
import {
  categoryOrdersApi,
  type CatOrdersCategory, type CatOrdersMonth, type CatOrdersProduct, type RestockEvent,
} from '../api/categoryOrders.api';
import { IMPORT_ORDER_STATUS_LABELS, type ImportOrderStatus } from '../types';
import './CategoryAnalysisPage.css';
import './CategoryOrdersPage.css';

const { Title, Text } = Typography;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const monthLabel = (m: string) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;
const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '—');
const tone = (v: number | null): StatusTone => (v == null ? 'neutral' : v > 2 ? 'positive' : v < -2 ? 'negative' : 'neutral');
const qty = (v: number | null, unit?: string | null) => (v == null ? '—' : `${fmtQty(v)}${unit ? ` ${unit}` : ''}`);

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="cat-muted">—</span>;
  return <span className={`cat-chg cat-chg--${tone(value)}`}>{formatPercent(value, 0, { signed: true })}</span>;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 0);
  if (max <= 0) return <span className="cat-muted">—</span>;
  const w = 96, h = 22, step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg className="cat-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Вывод по событию одной фразой. */
function verdict(e: RestockEvent): { text: string; tone: StatusTone; hint: string } {
  if (e.dipped && e.stockedOut) {
    return { text: 'просели — кончился товар', tone: 'negative', hint: 'Продажи за 2 месяца до упали больше чем на 20 %, а остатка оставалось меньше чем на 2 недели продаж' };
  }
  if (e.dipped) return { text: 'просели до заказа', tone: 'warning', hint: 'Продажи за 2 месяца до упали больше чем на 20 % от обычного, но товар на складе был' };
  if (e.stockedOut) return { text: 'товар кончался', tone: 'warning', hint: 'Остатка было меньше чем на 2 недели продаж, но продажи ещё не упали' };
  if (e.dropBefore == null) return { text: 'нет базы', tone: 'neutral', hint: 'Нет полугода продаж до события — не с чем сравнить' };
  return { text: 'без просадки', tone: 'positive', hint: 'Продажи перед событием шли как обычно' };
}

// ── График: столбцы выручки, линия (сделки или остаток), отметки приходов и заказов ──

interface ChartRow {
  month: string;
  bar: number;
  line: number | null;
  arrival: boolean;
  order: boolean;
}

function ComboChart({ rows, lineName, lineFmt, barName }: {
  rows: ChartRow[];
  barName: string;
  lineName: string;
  lineFmt: (v: number) => string;
}) {
  const step = 40;
  const padL = 64, padR = 56, top = 14, plotH = 200, bottom = 46;
  const W = padL + padR + rows.length * step;
  const H = top + plotH + bottom;
  const maxBar = Math.max(1, ...rows.map((r) => r.bar));
  const lineVals = rows.map((r) => r.line).filter((v): v is number => v != null);
  const maxLine = Math.max(1, ...lineVals);
  const y = (v: number) => top + plotH - (v / maxBar) * plotH;
  const yl = (v: number) => top + plotH - (v / maxLine) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const linePts = rows
    .map((r, i) => (r.line == null ? null : `${padL + i * step + step / 2},${yl(r.line).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  const base = top + plotH;

  return (
    <div className="co-chart">
      <div className="co-legend">
        <span><i className="co-key co-key--bar" />{barName}</span>
        {lineVals.length > 0 && <span><i className="co-key co-key--line" />{lineName}</span>}
        <span><i className="co-key co-key--arrival" />приход на склад</span>
        <span><i className="co-key co-key--order" />заказ поставщику</span>
      </div>
      <div className="co-chart__scroll">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={barName}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="co-grid" x1={padL} x2={W - padR} y1={y(maxBar * t)} y2={y(maxBar * t)} />
              <text className="co-axis" x={padL - 8} y={y(maxBar * t) + 4} textAnchor="end">{money(maxBar * t)}</text>
              {lineVals.length > 0 && (
                <text className="co-axis co-axis--line" x={W - padR + 8} y={yl(maxLine * t) + 4}>{lineFmt(maxLine * t)}</text>
              )}
            </g>
          ))}
          {rows.map((r, i) => {
            const x = padL + i * step;
            const bw = step * 0.62;
            const tip = [
              monthLabel(r.month),
              `${barName}: ${money(r.bar)}`,
              r.line != null ? `${lineName}: ${lineFmt(r.line)}` : null,
              r.arrival ? 'был приход на склад' : null,
              r.order ? 'был заказ поставщику' : null,
            ].filter(Boolean).join('\n');
            return (
              <g key={r.month} className="co-col">
                <title>{tip}</title>
                <rect className="co-hit" x={x} y={top} width={step} height={plotH + bottom} />
                <rect className="co-bar" x={x + (step - bw) / 2} y={y(r.bar)} width={bw} height={Math.max(0, base - y(r.bar))} rx={3} />
                {r.arrival && <path className="co-mark co-mark--arrival" d={`M${x + step / 2 - 6},${base + 30} l6,-9 l6,9 z`} />}
                {r.order && <rect className="co-mark co-mark--order" x={x + step / 2 - 4.5} y={base + 33} width={9} height={9} transform={`rotate(45 ${x + step / 2} ${base + 37.5})`} />}
                <text className="co-axis" x={x + step / 2} y={base + 16} textAnchor="middle">{monthLabel(r.month)}</text>
              </g>
            );
          })}
          {linePts && <polyline className="co-line" points={linePts} fill="none" />}
          {rows.map((r, i) => (r.line == null ? null : (
            <circle key={r.month} className="co-dot" cx={padL + i * step + step / 2} cy={yl(r.line)} r={2.5} />
          )))}
        </svg>
      </div>
    </div>
  );
}

// ── Страница ──

export default function CategoryOrdersPage() {
  const isMobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const months = [12, 24, 36].includes(Number(sp.get('months'))) ? Number(sp.get('months')) : 24;
  const category = sp.get('category');
  const own = sp.get('own');
  const scope: CategoryScope = own === 'all' ? 'all' : own === 'only' ? 'own' : 'ext';

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) if (v == null) next.delete(k); else next.set(k, v);
    setSp(next, { replace: true });
  };
  const pickCategory = (c: string | null) => {
    set({ category: c });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['category-orders', months, scope, category],
    queryFn: () => categoryOrdersApi.get({ months, scope, category }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const detail = category && data?.detail?.name === category ? data.detail : null;

  const totalsChart = useMemo<ChartRow[]>(() => {
    if (!data) return [];
    return data.totals.map((t) => ({ month: t.month, bar: t.rev, line: t.deals, arrival: t.arrivalCategories > 0, order: t.orderCategories > 0 }));
  }, [data]);

  const detailChart = useMemo<ChartRow[]>(() => (detail?.months ?? []).map((m) => ({
    month: m.month, bar: m.rev, line: m.stock, arrival: m.inQty > 0, order: m.orderedQty > 0,
  })), [detail]);

  const overview = useMemo(() => {
    if (!data) return null;
    const full = data.totals.filter((t) => t.month < data.current);
    const last3 = full.slice(-3).reduce((s, t) => s + t.rev, 0);
    const prev3 = full.slice(-6, -3).reduce((s, t) => s + t.rev, 0);
    const deals3 = full.slice(-3).reduce((s, t) => s + t.deals, 0);
    const dealsPrev3 = full.slice(-6, -3).reduce((s, t) => s + t.deals, 0);
    return {
      rev: data.totals.reduce((s, t) => s + t.rev, 0),
      deals: data.totals.reduce((s, t) => s + t.deals, 0),
      last3, prev3, deals3, dealsPrev3,
      falling: data.categories.filter((c) => (c.trend ?? 0) <= -20 && c.prev3 > 0).length,
      dipped: data.categories.filter((c) => c.lastRestock?.dipped).length,
    };
  }, [data]);

  const catColumns: ColumnsType<CatOrdersCategory> = [
    {
      title: 'Категория', dataIndex: 'name', key: 'name', fixed: isMobile ? undefined : 'left', width: 220,
      render: (v: string) => <button type="button" className="co-link" onClick={() => pickCategory(v)}>{v}</button>,
    },
    { title: 'Выручка', dataIndex: 'rev', key: 'rev', align: 'right', sorter: (a, b) => a.rev - b.rev, defaultSortOrder: 'descend', render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'По месяцам', key: 'spark', render: (_, r) => <Sparkline values={r.monthly} /> },
    {
      title: <Tooltip title="Последние 3 полных месяца против 3 месяцев до них"><span className="cat-dotted">3 мес</span></Tooltip>,
      key: 'trend', align: 'right', sorter: (a, b) => (a.trend ?? 1e9) - (b.trend ?? 1e9),
      render: (_, r) => <><Money value={r.last3} variant="compact" /> <Change value={r.trend} /></>,
    },
    { title: 'Сделки', dataIndex: 'deals', key: 'deals', align: 'right', sorter: (a, b) => a.deals - b.deals },
    {
      title: <Tooltip title="Сколько раз товар приходил после перерыва, и сколько раз перед этим продажи падали больше чем на 20 %"><span className="cat-dotted">Приходы / просадки</span></Tooltip>,
      key: 'restocks', align: 'right', sorter: (a, b) => a.dipsBeforeRestock - b.dipsBeforeRestock,
      render: (_, r) => (r.restocks ? <>{r.restocks} <span className={r.dipsBeforeRestock ? 'cat-chg cat-chg--negative' : 'cat-muted'}>/ {r.dipsBeforeRestock}</span></> : <span className="cat-muted">—</span>),
    },
    {
      title: 'Последний приход', key: 'last', width: 260,
      render: (_, r) => {
        const e = r.lastRestock;
        if (!e) return <span className="cat-muted">—</span>;
        const v = verdict(e);
        return (
          <span className="co-last">
            <span className="cat-muted">{monthLabel(e.month)}</span>
            <Tooltip title={v.hint}><span><StatusPill tone={v.tone}>{v.text}</StatusPill></span></Tooltip>
            <Change value={e.dropBefore} />
          </span>
        );
      },
    },
    { title: 'Остаток', dataIndex: 'stock', key: 'stock', align: 'right', render: (v: number | null, r) => qty(v, r.unit) },
  ];

  const eventColumns: ColumnsType<RestockEvent> = [
    { title: 'Дата', dataIndex: 'date', key: 'date', width: 100, render: (v: string) => day(v) },
    {
      title: 'Что', key: 'kind', width: 220,
      render: (_, e) => (e.kind === 'arrival'
        ? <span>Приход на склад</span>
        : <span>Заказ {e.number} <span className="cat-muted">· {IMPORT_ORDER_STATUS_LABELS[e.status as ImportOrderStatus] ?? e.status}{e.eta ? ` · ETA ${day(e.eta)}` : ''}</span></span>),
    },
    { title: 'Кол-во', dataIndex: 'qty', key: 'qty', align: 'right', render: (v: number) => qty(v, detail?.unit) },
    { title: <Tooltip title="Средняя выручка в месяц за 6–3 месяца до события"><span className="cat-dotted">Обычно</span></Tooltip>, key: 'base', align: 'right', render: (_, e) => (e.dropBefore == null ? '—' : <Money value={e.baseline} variant="compact" />) },
    { title: <Tooltip title="Средняя выручка в месяц за 2 месяца до события"><span className="cat-dotted">2 мес до</span></Tooltip>, key: 'before', align: 'right', render: (_, e) => <><Money value={e.before} variant="compact" /> <Change value={e.dropBefore} /></> },
    { title: 'Остаток перед', dataIndex: 'stockBefore', key: 'stockBefore', align: 'right', render: (v: number | null) => qty(v, detail?.unit) },
    { title: <Tooltip title="Средняя выручка в месяц за 2 месяца после события, против «2 мес до»"><span className="cat-dotted">2 мес после</span></Tooltip>, key: 'after', align: 'right', render: (_, e) => (e.after == null ? <span className="cat-muted">ещё рано</span> : <><Money value={e.after} variant="compact" /> <Change value={e.recovery} /></>) },
    {
      title: 'Вывод', key: 'verdict', width: 210,
      render: (_, e) => { const v = verdict(e); return <Tooltip title={v.hint}><span><StatusPill tone={v.tone}>{v.text}</StatusPill></span></Tooltip>; },
    },
  ];

  const monthColumns: ColumnsType<CatOrdersMonth> = [
    { title: 'Месяц', dataIndex: 'month', key: 'month', render: (v: string) => monthLabel(v) },
    { title: 'Выручка', dataIndex: 'rev', key: 'rev', align: 'right', render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'Сделки', dataIndex: 'deals', key: 'deals', align: 'right' },
    { title: 'Клиенты', dataIndex: 'clients', key: 'clients', align: 'right' },
    { title: 'Продано', dataIndex: 'qty', key: 'qty', align: 'right', render: (v: number) => qty(v, detail?.unit) },
    { title: 'Приход', dataIndex: 'inQty', key: 'inQty', align: 'right', render: (v: number) => (v ? <b>{qty(v, detail?.unit)}</b> : <span className="cat-muted">—</span>) },
    { title: 'Заказано', dataIndex: 'orderedQty', key: 'orderedQty', align: 'right', render: (v: number) => (v ? qty(v, detail?.unit) : <span className="cat-muted">—</span>) },
    { title: 'Остаток на конец', dataIndex: 'stock', key: 'stock', align: 'right', render: (v: number | null) => qty(v, detail?.unit) },
  ];

  const productColumns: ColumnsType<CatOrdersProduct> = [
    { title: 'Товар', dataIndex: 'name', key: 'name', width: 280, render: (v: string, r) => <Link to={`/inventory/products/${r.id}`}>{v}</Link> },
    { title: 'Выручка', dataIndex: 'rev', key: 'rev', align: 'right', sorter: (a, b) => a.rev - b.rev, defaultSortOrder: 'descend', render: (v: number) => <Money value={v} variant="compact" /> },
    { title: 'По месяцам', key: 'spark', render: (_, r) => <Sparkline values={r.months.map((m) => m.rev)} /> },
    { title: '3 мес', key: 'trend', align: 'right', sorter: (a, b) => (a.trend ?? 1e9) - (b.trend ?? 1e9), render: (_, r) => <><Money value={r.last3} variant="compact" /> <Change value={r.trend} /></> },
    {
      title: 'Приходы', key: 'ins', align: 'right',
      render: (_, r) => { const n = r.months.filter((m) => m.inQty > 0).length; return n || <span className="cat-muted">—</span>; },
    },
    { title: 'Остаток', dataIndex: 'stock', key: 'stock', align: 'right', sorter: (a, b) => a.stock - b.stock, render: (v: number, r) => <span className={v <= 0 ? 'cat-chg cat-chg--negative' : undefined}>{qty(v, r.unit)}</span> },
  ];

  const dEvents = detail?.events ?? [];
  const dMonths = detail?.months ?? [];
  const dFull = dMonths.filter((m) => data && m.month < data.current);
  const dLast3 = dFull.slice(-3).reduce((s, m) => s + m.rev, 0);
  const dPrev3 = dFull.slice(-6, -3).reduce((s, m) => s + m.rev, 0);

  return (
    <div className="cat-page" style={{ padding: isMobile ? 12 : 24 }}>
      <div className="cat-head">
        <div className="cat-title">
          <BackButton fallback="/analytics" />
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {category
                ? <><button type="button" className="cat-crumb" onClick={() => pickCategory(null)}>Заказы и продажи</button> <span className="cat-muted">›</span> {category}</>
                : 'Заказы и продажи'}
            </Title>
            <Text type="secondary">
              {data ? `${monthLabel(data.from)} – ${monthLabel(data.to)} · текущий месяц неполный` : 'Динамика продаж по категориям рядом с приходами и заказами'}
            </Text>
          </div>
        </div>
        <div className="cat-controls">
          <Segmented
            value={months}
            onChange={(v) => set({ months: v === 24 ? null : String(v) })}
            options={[{ label: '12 мес', value: 12 }, { label: '24 мес', value: 24 }, { label: '36 мес', value: 36 }]}
          />
          <Select
            className="cat-select"
            allowClear
            showSearch
            placeholder="Все категории"
            value={category ?? undefined}
            onChange={(v) => pickCategory(v ?? null)}
            options={(data?.categories ?? []).map((c) => ({ value: c.name, label: c.name }))}
          />
          <Tooltip title="Свои компании — Базис Принт и ППС (клиенты с отметкой «аффилированный»).">
            <Segmented
              value={scope}
              onChange={(v) => set({ own: v === 'ext' ? null : v === 'own' ? 'only' : 'all' })}
              options={[
                { label: 'Без своих компаний', value: 'ext' },
                { label: 'Только свои', value: 'own' },
                { label: 'Все клиенты', value: 'all' },
              ]}
            />
          </Tooltip>
        </div>
      </div>

      {error && <Alert type="error" showIcon message="Не удалось загрузить данные" description={(error as Error).message} />}

      {isLoading ? (
        <div className="cat-loading"><Spin size="large" /></div>
      ) : data && !category && overview ? (
        <div className={`cat-body${isFetching ? ' cat-body--fetching' : ''}`}>
          <Section>
            <StatGrid columns={isMobile ? 2 : 4}>
              <StatTile label={`Выручка за ${months} мес`} value={<Money value={overview.rev} variant="compact" />} base={`${overview.deals.toLocaleString('ru-RU')} сделок`} />
              <StatTile label="Последние 3 месяца" value={<Money value={overview.last3} variant="compact" />} delta={overview.prev3 ? (overview.last3 / overview.prev3 - 1) * 100 : null} base={`3 мес до них ${money(overview.prev3)}`} />
              <StatTile label="Сделки за 3 месяца" value={overview.deals3.toLocaleString('ru-RU')} delta={overview.dealsPrev3 ? (overview.deals3 / overview.dealsPrev3 - 1) * 100 : null} base={`3 мес до них ${overview.dealsPrev3}`} />
              <StatTile label="Категории падают" value={overview.falling} base={`${overview.dipped} просели перед последним приходом`} />
            </StatGrid>
          </Section>

          <Section title="Выручка и сделки по месяцам">
            <ComboChart rows={totalsChart} barName="Выручка" lineName="Сделки" lineFmt={(v) => Math.round(v).toLocaleString('ru-RU')} />
          </Section>

          <Section title="Категории" count={data.categories.length}>
            <Text type="secondary" className="cat-note" style={{ marginBottom: 8 }}>
              Нажмите на категорию — откроются месяцы, каждый приход и заказ: падали ли продажи до него и вернулись ли после.
            </Text>
            <Table
              size="small"
              rowKey="name"
              columns={catColumns}
              dataSource={data.categories}
              pagination={false}
              scroll={{ x: 1200 }}
              locale={{ emptyText: <Empty description="Нет продаж" /> }}
            />
          </Section>
        </div>
      ) : data && category && !detail ? (
        <Empty description="В этой категории нет продаж и приходов за период" />
      ) : data && detail ? (
        <div className={`cat-body${isFetching ? ' cat-body--fetching' : ''}`}>
          <Section>
            <StatGrid columns={isMobile ? 2 : 4}>
              <StatTile label={`Выручка за ${months} мес`} value={<Money value={dMonths.reduce((s, m) => s + m.rev, 0)} variant="compact" />} base={`${dMonths.reduce((s, m) => s + m.deals, 0)} сделок`} />
              <StatTile label="Последние 3 месяца" value={<Money value={dLast3} variant="compact" />} delta={dPrev3 ? (dLast3 / dPrev3 - 1) * 100 : null} base={`3 мес до них ${money(dPrev3)}`} />
              <StatTile label="Приходы и заказы" value={dEvents.length} base={`${dEvents.filter((e) => e.kind === 'arrival').length} приходов · ${dEvents.filter((e) => e.kind === 'import').length} заказов`} />
              <StatTile label="Просели перед приходом" value={`${dEvents.filter((e) => e.dipped).length} из ${dEvents.filter((e) => e.dropBefore != null).length}`} base={`${dEvents.filter((e) => e.stockedOut).length} раз товар кончался`} />
            </StatGrid>
          </Section>

          <Section title={`Выручка и остаток${detail.unit ? `, ${detail.unit}` : ''}`}>
            {!detail.unit && <Text type="secondary" className="cat-note">В категории товары с разными единицами — остаток сложен как есть, смотрите его по товарам.</Text>}
            <ComboChart rows={detailChart} barName="Выручка" lineName="Остаток на конец месяца" lineFmt={(v) => fmtQty(Math.round(v))} />
          </Section>

          <Section title="Приходы и заказы: что было до и после" count={dEvents.length}>
            <Text type="secondary" className="cat-note" style={{ marginBottom: 8 }}>
              «Обычно» — средняя выручка в месяц за 6–3 месяца до события. Просадка — когда за 2 месяца до продажи ниже обычного больше чем на 20 %.
              Приход считаем, когда товар пришёл после месяца без прихода.
            </Text>
            <Table
              size="small"
              rowKey={(e) => `${e.kind}-${e.date}-${e.number ?? ''}`}
              columns={eventColumns}
              dataSource={dEvents}
              pagination={false}
              scroll={{ x: 1100 }}
              locale={{ emptyText: <Empty description="За период не было приходов после перерыва и заказов поставщикам" /> }}
            />
          </Section>

          <Section title="По месяцам">
            <Table
              size="small"
              rowKey="month"
              columns={monthColumns}
              dataSource={[...dMonths].reverse()}
              pagination={false}
              scroll={{ x: 900 }}
              rowClassName={(m) => (m.inQty > 0 ? 'co-row--arrival' : '')}
            />
          </Section>

          <Section title="Товары" count={detail.products.length}>
            <Table
              size="small"
              rowKey="id"
              columns={productColumns}
              dataSource={detail.products}
              pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
              scroll={{ x: 900 }}
            />
          </Section>
        </div>
      ) : null}
    </div>
  );
}
