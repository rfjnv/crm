import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Empty, Input, Segmented, Select, Spin, Table, Tooltip } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { Column, Line } from '@ant-design/charts';
import dayjs from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatPercent, formatUZS } from '../utils/currency';
import { matchesSearch, smartFilterOption } from '../utils/translit';
import { buildSeries, type ForecastContext } from '../utils/salesForecast';
import {
  STATUS_DAYS, cohortRevenue, computeClientStats, median, topShare,
  type ClientLtvStats, type ClientStatus,
} from '../utils/clientLtv';
import Section from './ui/Section';
import StatTile, { StatGrid } from './ui/StatTile';
import Money from './ui/Money';
import StatusPill, { type StatusTone } from './ui/StatusPill';
import { ChartTypeSwitch, DeltaPill, ItemsChart, PieWithLegend, RankList, YearsChart } from './history/historyCharts';
import {
  axisFor, fmtQty, loadChartType, money, saveChartType, useChartLook,
  type ChartItem, type ChartType,
} from './history/historyChartUtils';

const CHART_TYPE_KEY = 'historyClients.chartType';
const TOP_RANK = 15;

type StatusFilter = 'all' | ClientStatus | 'overdue';

/** Товар клиента за период. */
interface ProductStat {
  id: string;
  name: string;
  unit: string;
  category: string;
  revenue: number;
  qty: number;
  deals: number;
  lastAt: string;
}
type Period = 'year' | 'all';

const STATUS_META: Record<ClientStatus, { label: string; tone: StatusTone }> = {
  active: { label: 'активный', tone: 'positive' },
  cooling: { label: 'засыпает', tone: 'warning' },
  lost: { label: 'ушёл', tone: 'negative' },
};

function fmtDate(d: Date | string): string {
  return dayjs(d).format('DD.MM.YYYY');
}

function daysAgo(days: number): string {
  if (days === 0) return 'сегодня';
  if (days < 31) return `${days} дн. назад`;
  const months = Math.round(days / 30.4);
  return months < 12 ? `${months} мес. назад` : `${(days / 365).toFixed(1).replace('.', ',')} г. назад`;
}

function frequency(days: number | null): string {
  if (days == null) return 'одна покупка';
  if (days < 1) return 'несколько раз в день';
  if (days < 45) return `раз в ${days} дн.`;
  return `раз в ${Math.round(days / 30.4)} мес.`;
}

/** Выручка по годам в разрезе когорт — год первой покупки клиента. */
function CohortChart({ data, type, height }: {
  data: Map<number, Map<number, number>>;
  type: ChartType;
  height: number;
}) {
  const look = useChartLook();
  const cohorts = [...data.keys()].sort((a, b) => a - b);
  const years = [...new Set(cohorts.flatMap((c) => [...data.get(c)!.keys()]))].sort((a, b) => a - b);
  if (cohorts.length === 0) return <span className="hcat-muted">Нет данных.</span>;
  const label = (c: number) => `Клиенты с ${c}`;
  const color = { color: { domain: cohorts.map(label), range: look.series.slice(0, cohorts.length) } };

  if (type === 'pie') {
    return (
      <PieWithLegend
        slices={cohorts.map((c, i) => ({
          key: String(c),
          name: label(c),
          value: [...data.get(c)!.values()].reduce((s, v) => s + v, 0),
          color: look.series[i],
        }))}
        center={'за всё\nвремя'}
        fmt={money}
        height={height}
      />
    );
  }

  const rows = years.flatMap((y) => cohorts
    .filter((c) => c <= y)
    .map((c) => ({ year: String(y), cohort: label(c), value: data.get(c)!.get(y) ?? 0 })));
  const common = {
    data: rows,
    xField: 'year',
    yField: 'value',
    colorField: 'cohort',
    height,
    theme: look.theme,
    scale: color,
    axis: axisFor(look, money),
    legend: {
      color: { position: 'top' as const, itemLabelFill: look.text2, itemMarker: 'circle', itemMarkerSize: 8 },
    },
    tooltip: { title: 'year', items: [{ field: 'value', channel: 'y', valueFormatter: (v: number) => formatUZS(v) }] },
  };
  return type === 'line'
    ? <Line {...common} point={{ shapeField: 'circle', sizeField: 4 }} style={{ lineWidth: 3 }} />
    : <Column {...common} stack style={{ maxWidth: 72, stroke: look.stroke, lineWidth: 1 }} />;
}

/**
 * Аналитика (история) → «Клиенты»: LTV — сколько клиент принёс за всё время, как часто
 * покупает, кому пора напомнить; внутри клиента — его месяцы, категории и товары.
 */
export default function HistoryClientsPanel({ year }: { year: number }) {
  const isMobile = useIsMobile();
  const [clientId, setClientId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [chartType, setChartTypeState] = useState<ChartType>(() => loadChartType(CHART_TYPE_KEY));
  const setChartType = (t: ChartType) => {
    setChartTypeState(t);
    saveChartType(CHART_TYPE_KEY, t);
  };

  const now = useMemo(() => new Date(), []);
  const ctx: ForecastContext = useMemo(
    () => ({ year, nowYear: now.getFullYear(), nowMonth: now.getMonth() + 1 }),
    [year, now],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-history-clients-ltv'],
    queryFn: analyticsApi.getHistoryClientsLtv,
    staleTime: 120_000,
  });
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['analytics-history-client-ltv', clientId],
    queryFn: () => analyticsApi.getHistoryClientLtv(clientId!),
    enabled: !!clientId,
    staleTime: 120_000,
  });

  const stats = useMemo(
    () => (data ? computeClientStats(data.clients, data.rows, now) : []).sort((a, b) => b.ltv - a.ltv),
    [data, now],
  );
  const series = useMemo(() => buildSeries(data?.rows ?? [], (r) => r.clientId, (r) => r.revenue), [data]);
  const cohorts = useMemo(() => cohortRevenue(stats, data?.rows ?? []), [stats, data]);
  const selected = stats.find((s) => s.id === clientId) ?? null;

  const counts = useMemo(() => ({
    active: stats.filter((s) => s.status === 'active').length,
    cooling: stats.filter((s) => s.status === 'cooling').length,
    lost: stats.filter((s) => s.status === 'lost').length,
    overdue: stats.filter((s) => s.overdue).length,
  }), [stats]);

  const visible = useMemo(() => stats.filter((s) => {
    if (statusFilter === 'overdue' ? !s.overdue : statusFilter !== 'all' && s.status !== statusFilter) return false;
    return !search.trim() || matchesSearch(s.name, search) || (s.manager != null && matchesSearch(s.manager, search));
  }), [stats, statusFilter, search]);

  // ── Клиент: товары и категории за выбранный период ──
  const productStats = useMemo(() => {
    const m = new Map<string, ProductStat>();
    for (const r of detail?.products ?? []) {
      if (period === 'year' && r.year !== year) continue;
      const acc = m.get(r.productId) ?? { id: r.productId, name: r.name, unit: r.unit, category: r.category, revenue: 0, qty: 0, deals: 0, lastAt: r.lastAt };
      acc.revenue += r.revenue;
      acc.qty += r.qty;
      acc.deals += r.deals;
      if (r.lastAt > acc.lastAt) acc.lastAt = r.lastAt;
      m.set(r.productId, acc);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [detail, period, year]);
  const categoryTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of productStats) m.set(p.category, (m.get(p.category) ?? 0) + p.revenue);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [productStats]);
  const clientSeries = useMemo(
    () => buildSeries(detail?.monthly ?? [], () => 'c', (r) => r.revenue).get('c'),
    [detail],
  );

  const look = useChartLook();

  if (isLoading) return <Spin style={{ display: 'block', margin: '60px auto' }} />;
  if (!data || stats.length === 0) return <Empty description="Покупок пока нет" />;

  const ltvs = stats.map((s) => s.ltv);
  const avgLtv = ltvs.reduce((s, v) => s + v, 0) / ltvs.length;
  const chartHeight = isMobile ? 300 : 380;

  const openClient = (id: string | null) => {
    setClientId(id);
    setPeriod('all');
  };

  const chartItems: ChartItem[] = stats.map((s) => ({ key: s.id, name: s.name, label: s.name, series: series.get(s.id) }));

  const crumbs = (
    <div className="hcat-crumbs">
      {selected ? (
        <>
          <button type="button" className="hcat-crumb" onClick={() => openClient(null)}>Все клиенты</button>
          <span className="hcat-crumb-sep">/</span>
          <span className="hcat-crumb hcat-crumb--current" title={selected.name}>{selected.name}</span>
        </>
      ) : (
        <span className="hcat-crumb hcat-crumb--current">Все клиенты</span>
      )}
    </div>
  );

  const controls = (
    <div className="hcat-controls">
      <Select
        className="hcat-select hcat-select--product"
        showSearch
        allowClear
        placeholder="Найти клиента"
        value={clientId ?? undefined}
        onChange={(v?: string) => openClient(v ?? null)}
        filterOption={smartFilterOption}
        options={[...stats].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((s) => ({ value: s.id, label: s.name }))}
        popupMatchSelectWidth={false}
      />
      <ChartTypeSwitch value={chartType} onChange={setChartType} compact={isMobile} />
    </div>
  );

  // ── Один клиент ──
  if (selected) {
    const statusMeta = STATUS_META[selected.status];
    return (
      <div className="hcat">
        <div className="hcat-head">
          <div className="hcat-path">
            {crumbs}
            <span className="hcat-section-hint" style={{ margin: 0 }}>
              {selected.manager ? `Менеджер: ${selected.manager} · ` : ''}
              <Link to={`/clients/${selected.id}`}>Карточка клиента</Link>
            </span>
          </div>
          {controls}
        </div>

        <Section>
          <StatGrid columns={isMobile ? 2 : 4}>
            <StatTile
              label="LTV — за всё время"
              value={<Money value={selected.ltv} variant="compact" />}
              delta={selected.trend12 != null ? selected.trend12 * 100 : null}
              base={`за 12 мес.: ${money(selected.last12)}${selected.trend12 != null ? ' к предыдущим 12' : ''}`}
            />
            <StatTile
              label="Средний чек"
              value={<Money value={selected.avgCheck} variant="compact" />}
              base={`${selected.deals} сделок с ${fmtDate(selected.firstAt)}`}
            />
            <StatTile
              label="Покупает"
              value={frequency(selected.avgIntervalDays)}
              base={`клиент ${selected.lifetimeMonths} мес.`}
            />
            <StatTile
              label="Последняя покупка"
              value={daysAgo(selected.daysSinceLast)}
              base={(
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill>
                  {selected.overdue && <StatusPill tone="warning">пора напомнить</StatusPill>}
                  {fmtDate(selected.lastAt)}
                </span>
              )}
            />
          </StatGrid>
        </Section>

        <Section title="Покупки по месяцам и годам">
          <div className="hcat-section-hint">
            {chartType === 'pie'
              ? `Как покупки ${year} года делятся по месяцам.`
              : 'Каждый год своим цветом; прогноз на оставшиеся месяцы — по прошлым годам этого клиента.'}
          </div>
          {detailLoading ? <Spin style={{ display: 'block', margin: '60px auto' }} /> : (
            <YearsChart series={clientSeries} ctx={ctx} type={chartType} fmt={money} height={chartHeight} />
          )}
        </Section>

        <div className="hcat-split">
          <Section
            title="Категории"
            extra={(
              <Segmented
                size="small"
                value={period}
                onChange={(v) => setPeriod(v as Period)}
                options={[{ label: 'Всё время', value: 'all' }, { label: String(year), value: 'year' }]}
              />
            )}
          >
            {categoryTotals.length === 0 ? <span className="hcat-muted">Покупок за период нет.</span> : (
              <PieWithLegend
                slices={categoryTotals.map(([name, value], i) => ({ key: name, name, value, color: look.series[i % look.series.length] }))}
                center={`${money(categoryTotals.reduce((s, [, v]) => s + v, 0))}\n${period === 'all' ? 'за всё время' : `за ${year}`}`}
                fmt={money}
                height={260}
              />
            )}
          </Section>
          <Section
            title="Что покупает"
            count={productStats.length > TOP_RANK ? `топ ${TOP_RANK} из ${productStats.length}` : undefined}
          >
            {productStats.length === 0 ? <span className="hcat-muted">Покупок за период нет.</span> : (
              <RankList
                rows={productStats.slice(0, TOP_RANK).map((p) => ({ id: p.id, name: p.name, label: p.name, value: p.revenue }))}
                fmt={money}
                selectedId={null}
                onPick={() => undefined}
              />
            )}
          </Section>
        </div>

        <Section title={`Товары клиента · ${period === 'all' ? 'всё время' : year}`} count={productStats.length}>
          <Table<ProductStat>
            className="hcat-table"
            rowKey="id"
            size="middle"
            loading={detailLoading}
            dataSource={productStats}
            pagination={productStats.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
            scroll={{ x: 900 }}
            columns={[
              { title: 'Товар', dataIndex: 'name', key: 'name', ellipsis: true },
              { title: 'Категория', dataIndex: 'category', key: 'category', width: 180, ellipsis: true },
              {
                title: 'Выручка', dataIndex: 'revenue', key: 'revenue', width: 170, align: 'right' as const,
                defaultSortOrder: 'descend' as const,
                sorter: (a, b) => a.revenue - b.revenue,
                render: (v: number) => <Money value={v} />,
              },
              {
                title: 'Кол-во', dataIndex: 'qty', key: 'qty', width: 120, align: 'right' as const,
                render: (v: number, r) => <span>{fmtQty(v)} <span className="hcat-muted">{r.unit}</span></span>,
              },
              { title: 'Сделок', dataIndex: 'deals', key: 'deals', width: 90, align: 'right' as const },
              {
                title: 'Последняя покупка', dataIndex: 'lastAt', key: 'lastAt', width: 170,
                sorter: (a, b) => a.lastAt.localeCompare(b.lastAt),
                render: (v: string) => <span>{fmtDate(v)} <span className="hcat-muted">· {daysAgo(Math.floor((now.getTime() - new Date(v).getTime()) / 86_400_000))}</span></span>,
              },
            ]}
          />
        </Section>
      </div>
    );
  }

  // ── Все клиенты ──
  const statusOptions = [
    { value: 'all', label: `Все · ${stats.length}` },
    { value: 'active', label: `Активные · ${counts.active}` },
    { value: 'cooling', label: `Засыпают · ${counts.cooling}` },
    { value: 'lost', label: `Ушли · ${counts.lost}` },
    { value: 'overdue', label: `Пора напомнить · ${counts.overdue}` },
  ];

  return (
    <div className="hcat">
      <div className="hcat-head">
        <div className="hcat-path">{crumbs}</div>
        {controls}
      </div>

      <Section>
        <StatGrid columns={isMobile ? 2 : 4}>
          <StatTile
            label={<Tooltip title="LTV — сколько клиент принёс за всё время, с 2024 года">Средний LTV</Tooltip>}
            value={<Money value={avgLtv} variant="compact" />}
            base={`медиана ${money(median(ltvs))} · ${stats.length} клиентов`}
          />
          <StatTile
            label={<Tooltip title={`Покупали за последние ${STATUS_DAYS.active} дней`}>Активные клиенты</Tooltip>}
            value={counts.active}
            base={`засыпают ${counts.cooling} · ушли ${counts.lost}`}
          />
          <StatTile
            label="Топ-20 % клиентов"
            value={formatPercent(topShare(ltvs) * 100, 0)}
            base="выручки за всё время"
          />
          <StatTile
            label={<Tooltip title="Не покупают заметно дольше, чем обычно у них между покупками">Пора напомнить</Tooltip>}
            value={counts.overdue}
            base={counts.overdue ? 'обычно покупают чаще' : 'все покупают как обычно'}
          />
        </StatGrid>
      </Section>

      <Section title={`Клиенты по месяцам · ${year}`}>
        <div className="hcat-section-hint">
          {chartType === 'pie'
            ? `Доли клиентов в выручке ${year} года. Нажмите на клиента, чтобы открыть.`
            : 'Крупнейшие клиенты года; нажмите на клиента, чтобы открыть его покупки.'}
        </div>
        <ItemsChart
          items={chartItems}
          ctx={ctx}
          type={chartType}
          fmt={formatUZS}
          height={chartHeight}
          onPick={(key) => openClient(key)}
        />
      </Section>

      <div className="hcat-split">
        <Section title="Когорты · выручка по году первой покупки">
          <div className="hcat-section-hint">Сколько приносят давние клиенты и сколько — новые.</div>
          <CohortChart data={cohorts} type={chartType} height={300} />
        </Section>
        <Section title="Топ по LTV · всё время" count={`${Math.min(TOP_RANK, stats.length)} из ${stats.length}`}>
          <RankList
            rows={stats.slice(0, TOP_RANK).map((s) => ({ id: s.id, name: s.name, label: s.name, value: s.ltv }))}
            fmt={money}
            selectedId={null}
            onPick={(id) => openClient(id)}
          />
        </Section>
      </div>

      <Section
        title="Все клиенты"
        count={visible.length}
        extra={(
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined />}
            placeholder="Клиент или менеджер"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: isMobile ? 160 : 240 }}
          />
        )}
      >
        <Segmented
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={statusOptions}
          style={{ marginBottom: 12, maxWidth: '100%', overflowX: 'auto' }}
        />
        <Table<ClientLtvStats>
          className="hcat-table"
          rowKey="id"
          size="middle"
          dataSource={visible}
          pagination={visible.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
          scroll={{ x: 1200 }}
          onRow={(r) => ({ onClick: () => openClient(r.id) })}
          columns={[
            { title: 'Клиент', dataIndex: 'name', key: 'name', ellipsis: true, fixed: isMobile ? undefined : ('left' as const), width: 240 },
            { title: 'Менеджер', dataIndex: 'manager', key: 'manager', width: 140, ellipsis: true, render: (v: string | null) => v ?? '—' },
            {
              title: <Tooltip title="Сколько клиент принёс за всё время">LTV</Tooltip>,
              dataIndex: 'ltv', key: 'ltv', width: 160, align: 'right' as const,
              defaultSortOrder: 'descend' as const,
              sorter: (a, b) => a.ltv - b.ltv,
              render: (v: number) => <Money value={v} />,
            },
            {
              title: 'За 12 мес.', dataIndex: 'last12', key: 'last12', width: 120, align: 'right' as const,
              sorter: (a, b) => a.last12 - b.last12,
              render: (v: number) => (v > 0 ? money(v) : <span className="hcat-muted">0</span>),
            },
            {
              title: <Tooltip title="Последние 12 месяцев к предыдущим 12">Динамика</Tooltip>,
              dataIndex: 'trend12', key: 'trend12', width: 110, align: 'right' as const,
              sorter: (a, b) => (a.trend12 ?? -Infinity) - (b.trend12 ?? -Infinity),
              render: (v: number | null) => <DeltaPill value={v} />,
            },
            {
              title: 'Средний чек', dataIndex: 'avgCheck', key: 'avgCheck', width: 120, align: 'right' as const,
              sorter: (a, b) => a.avgCheck - b.avgCheck,
              render: (v: number) => money(v),
            },
            {
              title: 'Покупает', dataIndex: 'avgIntervalDays', key: 'freq', width: 130,
              sorter: (a, b) => (a.avgIntervalDays ?? Infinity) - (b.avgIntervalDays ?? Infinity),
              render: (v: number | null) => frequency(v),
            },
            {
              title: 'Последняя покупка', dataIndex: 'daysSinceLast', key: 'last', width: 250,
              sorter: (a, b) => a.daysSinceLast - b.daysSinceLast,
              render: (_: number, r: ClientLtvStats) => (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                  <StatusPill tone={r.overdue ? 'warning' : STATUS_META[r.status].tone}>
                    {r.overdue ? 'пора напомнить' : STATUS_META[r.status].label}
                  </StatusPill>
                  <span className="hcat-muted">{daysAgo(r.daysSinceLast)}</span>
                </span>
              ),
            },
            {
              title: 'Клиент с', dataIndex: 'firstAt', key: 'firstAt', width: 110,
              sorter: (a, b) => a.firstAt.getTime() - b.firstAt.getTime(),
              render: (v: Date) => fmtDate(v),
            },
          ]}
        />
      </Section>
    </div>
  );
}
