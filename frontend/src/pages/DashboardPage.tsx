import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Typography, Spin, Tag, theme, Progress, Table, Badge, Segmented } from 'antd';
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
import { profileApi } from '../api/profile.api';
import { formatUZS, formatFullNumber, formatShortNumber } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import { useDashboardChartRange } from '../hooks/useDashboardChartRange';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { Area } from '@ant-design/charts';
import DealStatusTag, { statusConfig } from '../components/DealStatusTag';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import type { Permission, UserRole, DealStatus } from '../types';
import './DashboardPage.css';

const DEFAULT_GOAL = 250_000_000;

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

  const { data: myGoal } = useQuery({
    queryKey: ['profile-monthly-goal'],
    queryFn: () => profileApi.monthlyGoal(),
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

  const chartRange = useDashboardChartRange();
  const [productDayPeriod, setProductDayPeriod] = useState<'today' | 'yesterday'>('today');

  const revenueChartSlice = useMemo(() => {
    const raw = data?.revenueLast30Days;
    if (!raw?.length) {
      return {
        rows: [] as { day: string; total: number }[],
        xLabelFormatter: (v: string) => (v ? v.slice(5) : ''),
      };
    }
    const sorted = [...raw].sort((a, b) => a.day.localeCompare(b.day));
    const sliced = sorted.slice(-chartRange.maxDays);
    const step = chartRange.tickStep;
    const xLabelFormatter = (v: string) => {
      const idx = sliced.findIndex((d) => d.day === v);
      if (idx < 0) return v.slice(5);
      if (idx === sliced.length - 1 || idx % step === 0) return v.slice(5);
      return '';
    };
    return { rows: sliced, xLabelFormatter };
  }, [data?.revenueLast30Days, chartRange.maxDays, chartRange.tickStep]);

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
  const hasMyGoal = !!myGoal && (
    myGoal.targets.deals != null ||
    myGoal.targets.revenue != null ||
    myGoal.targets.callNotes != null
  );

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
  const selectedProductOfDay = data.productOfDay?.[productDayPeriod] ?? null;

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

      <div className={isMobile ? 'section' : undefined}>
        <Card
          bordered={false}
          style={{ ...card, marginTop: isMobile ? 0 : 16 }}
          styles={{ body: { padding: '16px 20px' } }}
          title={(
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Typography.Text strong style={{ fontSize: 14 }}>Товар дня</Typography.Text>
              <Segmented
                size="small"
                value={productDayPeriod}
                onChange={(v) => setProductDayPeriod(v as 'today' | 'yesterday')}
                options={[
                  { label: 'Сегодня', value: 'today' },
                  { label: 'Вчера', value: 'yesterday' },
                ]}
              />
            </div>
          )}
        >
          {!selectedProductOfDay ? (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              Нет продаж за выбранный день
            </Typography.Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <Typography.Text strong style={{ fontSize: 16 }}>
                    {selectedProductOfDay.product.name}
                  </Typography.Text>
                  {selectedProductOfDay.product.sku && (
                    <div><Tag style={{ marginTop: 4 }}>{selectedProductOfDay.product.sku}</Tag></div>
                  )}
                </div>
                <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                  <Typography.Text style={{ fontSize: 13 }}>
                    Продано: <Typography.Text strong>{formatFullNumber(selectedProductOfDay.qty)}</Typography.Text>
                  </Typography.Text>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Выручка: {formatUZS(selectedProductOfDay.revenue)}
                    </Typography.Text>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Кому продали
                </Typography.Text>
                {selectedProductOfDay.clients.length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    Нет данных по клиентам
                  </Typography.Text>
                ) : (
                  selectedProductOfDay.clients.slice(0, 8).map((client, idx) => (
                    <div
                      key={client.clientId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '6px 0',
                        borderBottom:
                          idx < Math.min(8, selectedProductOfDay.clients.length) - 1
                            ? `1px solid ${tk.colorBorderSecondary}`
                            : undefined,
                      }}
                    >
                      <Typography.Text style={{ fontSize: 13 }} ellipsis>
                        {client.companyName}
                      </Typography.Text>
                      <Typography.Text strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                        {formatFullNumber(client.qty)}
                      </Typography.Text>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Monthly goal (compact, clickable → settings) ── */}
      {hasMyGoal && myGoal && (
        <div className={isMobile ? 'section' : undefined}>
          <Card
            bordered={false}
            style={{ ...card, marginTop: isMobile ? 0 : 16 }}
            styles={{ body: { padding: isMobile ? 14 : '12px 20px' } }}
            title={<Typography.Text strong style={{ fontSize: 14 }}>Мои цели на месяц</Typography.Text>}
          >
            <Row gutter={[12, 12]}>
              {myGoal.targets.deals != null && (
                <Col xs={24} md={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Сделки (закрыто)</Typography.Text>
                  <div style={{ marginTop: 2, marginBottom: 6 }}>
                    <Typography.Text strong>{myGoal.actual.dealsClosed}</Typography.Text>
                    <Typography.Text type="secondary"> / {myGoal.targets.deals}</Typography.Text>
                  </div>
                  <Progress percent={Math.min(100, myGoal.progress.deals ?? 0)} size="small" />
                </Col>
              )}
              {myGoal.targets.revenue != null && (
                <Col xs={24} md={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Выручка</Typography.Text>
                  <div style={{ marginTop: 2, marginBottom: 6 }}>
                    <Typography.Text strong>{formatUZS(myGoal.actual.revenue)}</Typography.Text>
                    <Typography.Text type="secondary"> / {formatUZS(myGoal.targets.revenue)}</Typography.Text>
                  </div>
                  <Progress percent={Math.min(100, myGoal.progress.revenue ?? 0)} size="small" />
                </Col>
              )}
              {myGoal.targets.callNotes != null && (
                <Col xs={24} md={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Обзвоны (заметки)</Typography.Text>
                  <div style={{ marginTop: 2, marginBottom: 6 }}>
                    <Typography.Text strong>{myGoal.actual.callNotes}</Typography.Text>
                    <Typography.Text type="secondary"> / {myGoal.targets.callNotes}</Typography.Text>
                  </div>
                  <Progress percent={Math.min(100, myGoal.progress.callNotes ?? 0)} size="small" />
                </Col>
              )}
            </Row>
          </Card>
        </div>
      )}

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
              style={{ ...card, height: '100%' }}
              styles={{ body: { padding: '16px 12px 8px' } }}
              title={(
                <Typography.Text strong style={{ fontSize: 14 }}>
                  Выручка за {chartRange.titleLabel} дн.
                </Typography.Text>
              )}
            >
              <div className="chart-container">
                <Area
                  data={revenueChartSlice.rows}
                  xField="day"
                  yField="total"
                  shapeField="smooth"
                  height={isMobile ? 220 : 240}
                  padding={[16, 8, 12, 8]}
                  theme={chartTheme}
                  style={{ fill: isDark ? 'rgba(82,196,26,0.15)' : 'rgba(82,196,26,0.12)' }}
                  line={{ style: { stroke: '#52c41a', strokeWidth: 2 } }}
                  axis={{
                    y: {
                      labelFormatter: (v: number) =>
                        chartRange.useShortYAxis ? formatShortNumber(v) : formatFullNumber(v),
                      labelFill: tk.colorTextSecondary,
                      grid: true,
                      gridLineWidth: 1,
                      gridLineDash: [4, 4],
                      gridStroke: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)',
                      title: false,
                    },
                    x: {
                      labelFormatter: revenueChartSlice.xLabelFormatter,
                      labelFill: tk.colorTextSecondary,
                      labelAutoRotate: false,
                      labelAutoHide: true,
                      tickCount: Math.min(8, chartRange.maxDays),
                      title: false,
                    },
                  }}
                  tooltip={{
                    items: [{
                      channel: 'y',
                      name: 'Выручка',
                      valueFormatter: (v: number) => formatFullNumber(v),
                    }],
                  }}
                />
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card
              bordered={false}
              style={{ ...card, height: '100%' }}
              styles={{ body: { padding: '16px 20px' } }}
              title={<Typography.Text strong style={{ fontSize: 14 }}>Сделки по статусам</Typography.Text>}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 270, overflowY: 'auto' }}>
                {(data.dealsByStatusCounts || [])
                  .filter((d) => d.count > 0)
                  .sort((a, b) => b.count - a.count)
                  .map((d) => {
                    const cfg = statusConfig[d.status as DealStatus];
                    const hex: Record<string, string> = {
                      blue: '#1677ff', processing: '#1677ff', gold: '#faad14', cyan: '#13c2c2',
                      orange: '#fa8c16', lime: '#a0d911', geekblue: '#2f54eb', purple: '#722ed1',
                      warning: '#faad14', success: '#52c41a', volcano: '#ff7a45', red: '#ff4d4f',
                    };
                    const maxC = Math.max(1, ...(data.dealsByStatusCounts || []).map((x) => x.count));
                    return (
                      <div
                        key={d.status}
                        style={{ cursor: 'pointer', padding: '6px 0' }}
                        onClick={() => navigate(`/deals?status=${d.status}`)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <DealStatusTag status={d.status as DealStatus} />
                          <Typography.Text strong style={{ fontSize: 13 }}>{d.count}</Typography.Text>
                        </div>
                        <Progress
                          percent={Math.round((d.count / maxC) * 100)}
                          showInfo={false}
                          size="small"
                          strokeColor={hex[cfg?.color || ''] || tk.colorPrimary}
                          trailColor={tk.colorFillSecondary}
                        />
                      </div>
                    );
                  })}
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
