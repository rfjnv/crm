import { useMemo, useState, useEffect, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Typography, Spin, Tag, theme, Progress, Table, Badge } from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { dashboardApi } from '../api/warehouse.api';
import { financeApi } from '../api/finance.api';
import { analyticsApi } from '../api/analytics.api';
import { settingsApi } from '../api/settings.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { Area } from '@ant-design/charts';
import DealStatusTag, { statusConfig } from '../components/DealStatusTag';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import type { Permission, UserRole, DealStatus } from '../types';
import './DashboardPage.css';

const DEFAULT_GOAL = 250_000_000;

/** Ant Tag color → hex for status stacked bar */
const STATUS_STACK_COLORS: Record<string, string> = {
  blue: '#1677ff',
  processing: '#1677ff',
  gold: '#faad14',
  cyan: '#13c2c2',
  orange: '#fa8c16',
  lime: '#a0d911',
  geekblue: '#2f54eb',
  purple: '#722ed1',
  warning: '#faad14',
  success: '#52c41a',
  volcano: '#ff7a45',
  red: '#ff4d4f',
  magenta: '#eb2f96',
  default: '#1677ff',
};

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function DeltaBadge({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="dashboard-delta-empty">—</span>;
  const up = value >= 0;
  return (
    <span className={`dashboard-delta-badge ${up ? 'dashboard-delta-badge--up' : 'dashboard-delta-badge--down'}`}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{' '}
      {up ? '+' : ''}{value.toFixed(1)}%
      {suffix && <span className="dashboard-delta-suffix">{suffix}</span>}
    </span>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.summary,
    refetchInterval: 10_000,
  });

  const { data: debtsData } = useQuery({
    queryKey: ['finance-debts-total'],
    queryFn: () => financeApi.getDebts(),
    refetchInterval: 30_000,
  });

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.getCompanySettings,
    staleTime: 300_000,
  });

  const user = useAuthStore((s) => s.user);
  const { token: tk } = theme.useToken();
  const navigate = useNavigate();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const chartTheme = isDark ? 'classicDark' : 'classic';
  const isMobile = useIsMobile();

  const role = user?.role as UserRole | undefined;
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const canViewClosedDealsHistory =
    role === 'SUPER_ADMIN'
    || role === 'ADMIN'
    || (user?.permissions ?? []).includes('view_closed_deals_history' as Permission);
  const showExtras = isAdmin || role === 'MANAGER';

  const { data: monthAnalytics, isLoading: extLoading } = useQuery({
    queryKey: ['dashboard-month-analytics'],
    queryFn: () => analyticsApi.getData('month'),
    enabled: !!data && showExtras,
    refetchInterval: 60_000,
  });

  const { data: abcMonth } = useQuery({
    queryKey: ['dashboard-abc-month'],
    queryFn: () => analyticsApi.getAbcXyz('month'),
    enabled: !!data && showExtras,
    refetchInterval: 120_000,
  });

  const topProducts = useMemo(() => {
    if (!abcMonth?.products?.length) return [];
    return [...abcMonth.products].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [abcMonth]);

  const topManagers = useMemo(() => {
    const rows = monthAnalytics?.managers?.rows ?? [];
    return [...rows].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 5);
  }, [monthAnalytics]);

  const topClients = useMemo(() => {
    return (monthAnalytics?.sales?.topClients ?? []).slice(0, 5);
  }, [monthAnalytics]);

  const chartThirtyDayStats = useMemo(() => {
    const series = data?.revenueLast30Days;
    if (!series?.length) {
      return { total: 0, trend: null as number | null, lastDay: 0, lastDayLabel: '' };
    }
    const sorted = [...series].sort((a, b) => a.day.localeCompare(b.day));
    const total = sorted.reduce((s, d) => s + (d.total || 0), 0);
    const last = sorted[sorted.length - 1];
    const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    const trend = prev ? pctChange(last.total ?? 0, prev.total ?? 0) : null;
    return {
      total,
      trend,
      lastDay: last?.total ?? 0,
      lastDayLabel: last?.day ? last.day.slice(5) : '',
    };
  }, [data?.revenueLast30Days]);

  const areaChartData = useMemo(() => {
    const s = data?.revenueLast30Days ?? [];
    return s.map((row, i, arr) => ({
      ...row,
      __lastPt: i === arr.length - 1 ? 1 : 0,
    }));
  }, [data?.revenueLast30Days]);

  const statusStack = useMemo(() => {
    const raw = data?.dealsByStatusCounts ?? [];
    const rows = raw.filter((d) => d.count > 0).sort((a, b) => b.count - a.count);
    const totalCount = rows.reduce((s, d) => s + d.count, 0) || 1;
    return {
      segments: rows.map((d) => {
        const cfg = statusConfig[d.status as DealStatus];
        const color = STATUS_STACK_COLORS[cfg?.color || ''] || STATUS_STACK_COLORS.default;
        return {
          status: d.status as DealStatus,
          count: d.count,
          widthPct: (d.count / totalCount) * 100,
          color,
          label: cfg?.label ?? d.status,
        };
      }),
      totalDeals: rows.reduce((s, d) => s + d.count, 0),
    };
  }, [data?.dealsByStatusCounts]);

  const [statusBarReady, setStatusBarReady] = useState(false);
  useEffect(() => {
    setStatusBarReady(false);
    const id = window.requestAnimationFrame(() => setStatusBarReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [data?.dealsByStatusCounts]);

  if (isLoading || !data) {
    return <Spin size="large" style={{ display: 'block', margin: '120px auto' }} />;
  }

  const totalDebt = debtsData?.totals?.totalDebtOwed ?? data.totalDebt;
  const revPct = isAdmin ? pctChange(data.revenueToday || 0, data.revenueYesterday || 0) : null;
  const dealPct = isAdmin ? pctChange(data.closedDealsToday || 0, data.closedDealsYesterday || 0) : null;
  const revenueGoal = companySettings?.monthlyRevenueGoal || DEFAULT_GOAL;
  const revenueMonth = data.revenueMonth || 0;
  const goalPct = Math.min(100, Math.round((revenueMonth / revenueGoal) * 100));
  const goalRemaining = Math.max(0, revenueGoal - revenueMonth);

  const allStockIssues = [
    ...(data.zeroStockProducts || []).map((p) => ({ ...p, issue: 'zero' as const })),
    ...(data.lowStockProducts || []).map((p) => ({ ...p, issue: 'low' as const })),
  ].filter((p) => !p.sku?.startsWith('TARGET'));

  /* ── shared styles ── */
  const card: CSSProperties = {
    borderRadius: 10,
    border: `1px solid ${tk.colorBorderSecondary}`,
    boxShadow: 'none',
  };
  const cardBody = { padding: '16px 20px' };
  const kpiGutter: [number, number] = isMobile ? [0, 12] : [16, 16];
  const blockGutter: [number, number] = isMobile ? [0, 12] : [16, 16];

  return (
    <div className="dashboard-page" style={{ paddingBottom: isMobile ? undefined : 32 }}>
      <style>{`
        .stock-row-zero td { background: rgba(255, 77, 79, 0.06) !important; }
        .stock-row-low td { background: rgba(250, 140, 22, 0.06) !important; }
      `}</style>

      {/* ── Header ── */}
      {isMobile ? (
        <div className="dashboard-header">
          <div>
            <div className="dashboard-title">Дашборд</div>
            {user?.fullName && (
              <Typography.Text
                type="secondary"
                className="dashboard-subtitle"
                style={{ fontSize: 13, display: 'block', marginTop: 4 }}
              >
                Добро пожаловать, {user.fullName.split(' ')[0]}
              </Typography.Text>
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          <Typography.Title level={4} style={{ margin: 0, fontWeight: 600 }}>Дашборд</Typography.Title>
          {user?.fullName && (
            <Typography.Text type="secondary" className="dashboard-subtitle" style={{ fontSize: 13 }}>
              Добро пожаловать, {user.fullName.split(' ')[0]}
            </Typography.Text>
          )}
        </div>
      )}

      {/* ── KPI cards ── */}
      <div className={isMobile ? 'section' : undefined}>
      {isMobile ? (
        <div className="cards-grid">
          <Link to="/revenue/today" className="cards-grid__link cards-grid__link--hero">
            <Card
              className="dashboard-metric-card card card-hero"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%', borderLeft: '3px solid #52c41a' }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label">
                Выручка сегодня
              </Typography.Text>
              <div className="dashboard-card-value">{formatUZS(data.revenueToday || 0)}</div>
              <div className="dashboard-card-delta">
                {isAdmin ? <DeltaBadge value={revPct} suffix="к вчера" /> : <span className="dashboard-card-delta-placeholder" aria-hidden />}
              </div>
            </Card>
          </Link>

          <Link to={canViewClosedDealsHistory ? '/deals/closed' : '#'} className="cards-grid__link">
            <Card
              className="dashboard-metric-card card"
              bordered={false}
              hoverable={canViewClosedDealsHistory}
              style={{ ...card, cursor: canViewClosedDealsHistory ? 'pointer' : 'default', height: '100%' }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label">Закрыто сделок</Typography.Text>
              <div className="dashboard-card-value">{data.closedDealsToday}</div>
              <div className="dashboard-card-delta">
                {isAdmin ? <DeltaBadge value={dealPct} suffix="к вчера" /> : <span className="dashboard-card-delta-placeholder" aria-hidden />}
              </div>
            </Card>
          </Link>

          <Link to="/deals" className="cards-grid__link">
            <Card
              className="dashboard-metric-card card"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%' }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label">Активные сделки</Typography.Text>
              <div className="dashboard-card-value">{data.activeDealsCount}</div>
              <div className="dashboard-card-delta">
                <span className="dashboard-card-delta-placeholder" aria-hidden />
              </div>
            </Card>
          </Link>

          <Link to="/finance/debts" className="cards-grid__link cards-grid__link--full">
            <Card
              className="dashboard-metric-card card card-full"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%' }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label">Общий долг</Typography.Text>
              <div className="dashboard-card-value">{formatUZS(totalDebt)}</div>
              <div className="dashboard-card-delta">
                <span className="dashboard-card-delta-placeholder" aria-hidden />
              </div>
            </Card>
          </Link>
        </div>
      ) : (
      <Row className="dashboard-kpi-row" gutter={kpiGutter}>
        {/* Revenue — accent */}
        <Col xs={24} sm={12} lg={6}>
          <Link to="/revenue/today" style={{ display: 'block', height: '100%' }}>
            <Card
              className="dashboard-metric-card"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%', borderLeft: '3px solid #52c41a' }}
              styles={{ body: cardBody }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label" style={{ fontSize: 13 }}>
                Выручка сегодня
              </Typography.Text>
              <div
                className="dashboard-card-value"
                style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}
              >
                {formatUZS(data.revenueToday || 0)}
              </div>
              <div className="dashboard-card-delta">
                {isAdmin ? <DeltaBadge value={revPct} suffix="к вчера" /> : <span className="dashboard-card-delta-placeholder" aria-hidden />}
              </div>
            </Card>
          </Link>
        </Col>

        {/* Closed deals */}
        <Col xs={24} sm={12} lg={6}>
          <Link to={canViewClosedDealsHistory ? '/deals/closed' : '#'} style={{ display: 'block', height: '100%' }}>
            <Card
              className="dashboard-metric-card"
              bordered={false}
              hoverable={canViewClosedDealsHistory}
              style={{ ...card, cursor: canViewClosedDealsHistory ? 'pointer' : 'default', height: '100%' }}
              styles={{ body: cardBody }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label" style={{ fontSize: 13 }}>Закрыто сделок</Typography.Text>
              <div
                className="dashboard-card-value"
                style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}
              >
                {data.closedDealsToday}
              </div>
              <div className="dashboard-card-delta">
                {isAdmin ? <DeltaBadge value={dealPct} suffix="к вчера" /> : <span className="dashboard-card-delta-placeholder" aria-hidden />}
              </div>
            </Card>
          </Link>
        </Col>

        {/* Active deals */}
        <Col xs={24} sm={12} lg={6}>
          <Link to="/deals" style={{ display: 'block', height: '100%' }}>
            <Card
              className="dashboard-metric-card"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%' }}
              styles={{ body: cardBody }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label" style={{ fontSize: 13 }}>Активные сделки</Typography.Text>
              <div
                className="dashboard-card-value"
                style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}
              >
                {data.activeDealsCount}
              </div>
              <div className="dashboard-card-delta">
                <span className="dashboard-card-delta-placeholder" aria-hidden />
              </div>
            </Card>
          </Link>
        </Col>

        {/* Debt — value uses default text color; red only on negative deltas elsewhere */}
        <Col xs={24} sm={12} lg={6}>
          <Link to="/finance/debts" style={{ display: 'block', height: '100%' }}>
            <Card
              className="dashboard-metric-card"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%' }}
              styles={{ body: cardBody }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label" style={{ fontSize: 13 }}>Общий долг</Typography.Text>
              <div
                className="dashboard-card-value"
                style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}
              >
                {formatUZS(totalDebt)}
              </div>
              <div className="dashboard-card-delta">
                <span className="dashboard-card-delta-placeholder" aria-hidden />
              </div>
            </Card>
          </Link>
        </Col>
      </Row>
      )}
      </div>

      {/* ── Monthly goal (compact, clickable → settings) ── */}
      {isAdmin && (
        <div className={isMobile ? 'section' : undefined}>
        <Card
          className="dashboard-goal-card"
          bordered={false}
          hoverable
          style={{ ...card, marginTop: isMobile ? 0 : 16, cursor: 'pointer' }}
          styles={{ body: isMobile ? undefined : { padding: '12px 20px' } }}
          onClick={() => navigate('/settings/company')}
        >
          {isMobile ? (
            <div className="goal-card">
              <div className="goal-header">
                <Typography.Text className="goal-title">Цель месяца</Typography.Text>
                <span className="goal-percent">{goalPct}%</span>
              </div>
              <Progress
                className="goal-progress"
                percent={goalPct}
                showInfo={false}
                strokeWidth={8}
                strokeColor={isDark ? '#52c41a' : '#389e0d'}
                trailColor={tk.colorFillSecondary}
              />
              <div className="goal-remaining">
                Осталось: {formatUZS(goalRemaining)}
              </div>
              <div className="goal-meta">
                {formatUZS(revenueMonth)} / {formatUZS(revenueGoal)}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <Typography.Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                Цель месяца
              </Typography.Text>
              <Progress
                percent={goalPct}
                strokeColor={isDark ? '#52c41a' : '#389e0d'}
                trailColor={tk.colorFillSecondary}
                style={{ flex: 1, minWidth: 120, margin: 0 }}
                format={(p) => `${p}%`}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {formatUZS(revenueMonth)} / {formatUZS(revenueGoal)}
              </Typography.Text>
            </div>
          )}
        </Card>
        </div>
      )}

      {/* ── Chart + Statuses ── */}
      {isAdmin && (
        <div className={isMobile ? 'section' : undefined}>
        <Row gutter={blockGutter} style={{ marginTop: isMobile ? 0 : 24 }}>
          <Col xs={24} lg={14}>
            <Card
              bordered={false}
              className="dashboard-chart-card"
              style={{ ...card, height: '100%' }}
              styles={{ body: { padding: 0 } }}
            >
              <div className="chart-card">
                <Typography.Text strong className="chart-card__title">
                  Выручка за 30 дней
                </Typography.Text>
                <div className="chart-summary">
                  <div className="chart-summary__main">
                    <Typography.Text type="secondary" className="chart-summary__label">
                      Итого за период
                    </Typography.Text>
                    <div className="chart-summary__total">{formatUZS(chartThirtyDayStats.total)}</div>
                  </div>
                  <div className="chart-summary__side">
                    {chartThirtyDayStats.trend !== null && (
                      <span
                        className={
                          chartThirtyDayStats.trend >= 0 ? 'trend-positive' : 'trend-negative'
                        }
                      >
                        {chartThirtyDayStats.trend >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{' '}
                        {chartThirtyDayStats.trend >= 0 ? '+' : ''}
                        {chartThirtyDayStats.trend.toFixed(1)}%
                      </span>
                    )}
                    <Typography.Text type="secondary" className="chart-summary__hint">
                      к пред. дню · последний {chartThirtyDayStats.lastDayLabel || '—'}
                    </Typography.Text>
                    <div className="chart-summary__last">{formatUZS(chartThirtyDayStats.lastDay)}</div>
                  </div>
                </div>
                <div className="chart-area">
                  <Area
                    data={areaChartData}
                    xField="day"
                    yField="total"
                    shapeField="smooth"
                    height={240}
                    theme={chartTheme}
                    padding={[12, 8, 8, 8]}
                    style={{ fill: isDark ? 'rgba(82,196,26,0.15)' : 'rgba(82,196,26,0.12)' }}
                    line={{ style: { stroke: '#52c41a', strokeWidth: 2 } }}
                    point={{
                      sizeField: '__lastPt',
                      size: [0, 10],
                      shape: 'circle',
                      style: { fill: '#52c41a', stroke: '#fff', lineWidth: 2 },
                    }}
                    axis={{
                      y: {
                        labelFormatter: (v: number) => Math.round(v).toLocaleString('ru-RU'),
                        labelFill: tk.colorTextSecondary,
                        grid: true,
                        gridLineWidth: 1,
                        gridLineDash: [4, 4],
                        gridStroke: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)',
                      },
                      x: {
                        labelFormatter: (v: string) => v.slice(5),
                        labelFill: tk.colorTextSecondary,
                        grid: false,
                      },
                    }}
                    tooltip={{ items: [{ channel: 'y', name: 'Выручка', valueFormatter: (v: number) => formatUZS(v) }] }}
                  />
                </div>
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card
              bordered={false}
              className="dashboard-status-card"
              style={{ ...card, height: '100%' }}
              styles={{ body: { padding: 0 } }}
            >
              <div className="status-card">
                <Typography.Text strong className="status-card__title">
                  Сделки по статусам
                </Typography.Text>
                <div className="status-card__meta">
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Всего активных
                  </Typography.Text>
                  <Typography.Text strong>{statusStack.totalDeals}</Typography.Text>
                </div>
                {statusStack.segments.length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    Нет активных сделок по статусам
                  </Typography.Text>
                ) : (
                  <>
                    <div
                      className="status-bar"
                      role="img"
                      aria-label={`Распределение по статусам, всего ${statusStack.totalDeals} сделок`}
                    >
                      {statusStack.segments.map((seg) => (
                        <button
                          key={seg.status}
                          type="button"
                          className="status-segment"
                          title={`${seg.label}: ${seg.count}`}
                          style={{
                            width: statusBarReady ? `${seg.widthPct}%` : '0%',
                            background: seg.color,
                          }}
                          onClick={() => navigate(`/deals?status=${seg.status}`)}
                        />
                      ))}
                    </div>
                    <div className="status-list">
                      {statusStack.segments.map((seg) => (
                        <button
                          key={seg.status}
                          type="button"
                          className="status-list__item"
                          onClick={() => navigate(`/deals?status=${seg.status}`)}
                        >
                          <DealStatusTag status={seg.status} />
                          <span className="status-list__count">{seg.count}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Card>
          </Col>
        </Row>
        </div>
      )}

      {/* ── Tops ── */}
      {showExtras && (
        <div className={isMobile ? 'section' : undefined}>
        <Row gutter={blockGutter} style={{ marginTop: isMobile ? 0 : 24 }}>
          {[
            {
              title: 'Топ товаров',
              items: topProducts.map((p) => ({ label: p.name, value: formatUZS(p.revenue), href: `/inventory/products/${p.entityId}` })),
            },
            {
              title: 'Топ менеджеров',
              items: topManagers.map((m) => ({ label: m.fullName, value: formatUZS(m.totalRevenue), href: `/analytics` })),
            },
            {
              title: 'Топ клиентов',
              items: topClients.map((c) => ({
                label: (
                  <ClientCompanyDisplay
                    client={{ id: c.clientId, companyName: c.companyName, isSvip: c.isSvip }}
                  />
                ),
                value: formatUZS(c.totalRevenue),
                href: `/clients/${c.clientId}`,
              })),
            },
          ].map((block) => (
            <Col xs={24} md={8} key={block.title}>
              <Card
                bordered={false}
                style={{ ...card, height: '100%' }}
                styles={{ body: { padding: '16px 20px' } }}
                title={<Typography.Text strong style={{ fontSize: 14 }}>{block.title}</Typography.Text>}
              >
                {extLoading ? <Spin size="small" /> : (
                  <div
                    className={isMobile ? 'dashboard-top-list' : undefined}
                    style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? undefined : 2 }}
                  >
                    {block.items.length === 0 && (
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>Нет данных</Typography.Text>
                    )}
                    {block.items.map((row, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 0',
                          borderBottom: i < block.items.length - 1 ? `1px solid ${tk.colorBorderSecondary}` : undefined,
                          cursor: 'pointer',
                        }}
                        onClick={() => navigate(row.href)}
                      >
                        <span style={{
                          width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 600, flexShrink: 0,
                          background: i === 0 ? (isDark ? '#177ddc22' : '#e6f4ff') : tk.colorFillQuaternary,
                          color: i === 0 ? tk.colorPrimary : tk.colorTextSecondary,
                        }}>
                          {i + 1}
                        </span>
                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', fontSize: 13 }}>
                          {row.label}
                        </div>
                        <Typography.Text strong style={{ fontSize: 13, flexShrink: 0 }}>{row.value}</Typography.Text>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Col>
          ))}
        </Row>
        </div>
      )}

      {/* ── Stock issues ── */}
      <div className={isMobile ? 'section' : undefined}>
      <Card
        bordered={false}
        style={{ ...card, marginTop: isMobile ? 0 : 24 }}
        styles={{ body: { padding: '16px 20px' } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Typography.Text strong style={{ fontSize: 14 }}>Проблемные остатки</Typography.Text>
            {allStockIssues.length > 0 && (
              <Badge count={allStockIssues.length} style={{ backgroundColor: tk.colorError }} />
            )}
          </div>
        }
      >
        {allStockIssues.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            <CheckCircleOutlined style={{ color: tk.colorSuccess, marginRight: 6 }} />
            Все товары в достаточном количестве
          </Typography.Text>
        ) : isMobile ? (
          <div className="dashboard-stock-mobile" style={{ display: 'flex', flexDirection: 'column' }}>
            {allStockIssues.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                  borderLeft: `3px solid ${item.issue === 'zero' ? tk.colorError : tk.colorWarning}`,
                  background: tk.colorFillQuaternary,
                }}
                onClick={() => navigate(`/inventory/products/${item.id}`)}
              >
                <div>
                  <Typography.Text strong style={{ fontSize: 13 }}>{item.name}</Typography.Text>
                  <div><Tag style={{ marginTop: 2 }}>{item.sku}</Tag></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ color: item.issue === 'zero' ? tk.colorError : tk.colorWarning, fontWeight: 700 }}>{item.stock}</span>
                  <div style={{ fontSize: 11, color: tk.colorTextSecondary }}>мин: {item.minStock}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table
            dataSource={allStockIssues}
            rowKey="id"
            pagination={false}
            size="small"
            bordered={false}
            onRow={(r) => ({ onClick: () => navigate(`/inventory/products/${r.id}`), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Товар', dataIndex: 'name', ellipsis: true },
              { title: 'Артикул', dataIndex: 'sku', width: 120, render: (v: string) => <Tag>{v}</Tag> },
              {
                title: 'Остаток', dataIndex: 'stock', width: 90, align: 'right' as const,
                render: (v: number, r) => (
                  <span style={{ color: r.issue === 'zero' ? tk.colorError : tk.colorWarning, fontWeight: 600 }}>{v}</span>
                ),
              },
              { title: 'Мин.', dataIndex: 'minStock', width: 70, align: 'right' as const },
            ]}
          />
        )}
      </Card>
      </div>
    </div>
  );
}
