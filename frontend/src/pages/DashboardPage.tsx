import { useMemo, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Table, Typography, Spin, Tag, Badge, theme, Progress, List } from 'antd';
import {
  DollarOutlined,
  FundOutlined,
  WarningOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CheckCircleOutlined,
  LineChartOutlined,
  ShoppingOutlined,
  TeamOutlined,
  UserOutlined,
  AimOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { dashboardApi } from '../api/warehouse.api';
import { financeApi } from '../api/finance.api';
import { analyticsApi } from '../api/analytics.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { Area, Line } from '@ant-design/charts';
import DealStatusTag, { statusConfig } from '../components/DealStatusTag';
import type { UserRole, DealStatus } from '../types';

/** Временная цель по выручке за месяц (сум); позже вынести в настройки. */
const MONTHLY_REVENUE_GOAL_UZS = 250_000_000;

const SECTION_GAP = 32;

/** Распределение закрытых сделок по дням пропорционально дневной выручке (нет отдельного API по дням). */
function allocateCompletedDealsByRevenue(
  revenueByDay: { day: string; total: number }[],
  completedDeals: number,
): { day: string; count: number }[] {
  if (!revenueByDay.length || completedDeals <= 0) {
    return revenueByDay.map((d) => ({ day: d.day, count: 0 }));
  }
  const sum = revenueByDay.reduce((s, d) => s + d.total, 0);
  if (sum <= 0) {
    const base = Math.floor(completedDeals / revenueByDay.length);
    let rem = completedDeals - base * revenueByDay.length;
    return revenueByDay.map((d, i) => ({
      day: d.day,
      count: base + (i < rem ? 1 : 0),
    }));
  }
  const floats = revenueByDay.map((d) => (completedDeals * d.total) / sum);
  const floors = floats.map((f) => Math.floor(f));
  let rem = completedDeals - floors.reduce((a, b) => a + b, 0);
  const order = floats
    .map((f, i) => ({ i, frac: f - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) {
    floors[order[k].i] += 1;
  }
  return revenueByDay.map((d, i) => ({
    day: d.day,
    count: floors[i],
  }));
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
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

  const user = useAuthStore((s) => s.user);
  const { token: themeToken } = theme.useToken();
  const navigate = useNavigate();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const chartTheme = isDark ? 'classicDark' : 'classic';
  const isMobile = useIsMobile();

  const role = user?.role as UserRole | undefined;
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const showAnalyticsExtras = isAdmin || role === 'MANAGER';

  const { data: monthAnalytics, isLoading: monthAnalyticsLoading } = useQuery({
    queryKey: ['dashboard-month-analytics'],
    queryFn: () => analyticsApi.getData('month'),
    enabled: !!data && showAnalyticsExtras,
    refetchInterval: 60_000,
  });

  const { data: abcMonth, isLoading: abcLoading } = useQuery({
    queryKey: ['dashboard-abc-month'],
    queryFn: () => analyticsApi.getAbcXyz('month'),
    enabled: !!data && showAnalyticsExtras,
    refetchInterval: 120_000,
  });

  const dealsByDayChart = useMemo(() => {
    if (!monthAnalytics?.sales) return [];
    const { revenueByDay, completedDeals } = monthAnalytics.sales;
    return allocateCompletedDealsByRevenue(revenueByDay, completedDeals).map((d) => ({
      day: d.day.slice(5),
      count: d.count,
    }));
  }, [monthAnalytics]);

  const topProductsByRevenue = useMemo(() => {
    if (!abcMonth?.products?.length) return [];
    return [...abcMonth.products]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [abcMonth]);

  const topManagers = useMemo(() => {
    const rows = monthAnalytics?.managers?.rows ?? [];
    return [...rows].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 5);
  }, [monthAnalytics]);

  const topClients = useMemo(() => {
    return (monthAnalytics?.sales?.topClients ?? []).slice(0, 5);
  }, [monthAnalytics]);

  if (isLoading || !data) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const revenueDelta = (data.revenueToday || 0) - (data.revenueYesterday || 0);
  const closedDealsDelta = (data.closedDealsToday || 0) - (data.closedDealsYesterday || 0);
  const revenuePct = isAdmin ? pctChange(data.revenueToday || 0, data.revenueYesterday || 0) : null;
  const dealsPct = isAdmin ? pctChange(data.closedDealsToday || 0, data.closedDealsYesterday || 0) : null;
  const totalDebtDisplay = debtsData?.totals?.totalDebtOwed ?? data.totalDebt;

  const allStockIssues = [
    ...(data.zeroStockProducts || []).map((p) => ({ ...p, issue: 'zero' as const })),
    ...(data.lowStockProducts || []).map((p) => ({ ...p, issue: 'low' as const })),
  ];

  const goalProgress = Math.min(100, Math.round(((data.revenueMonth || 0) / MONTHLY_REVENUE_GOAL_UZS) * 100));

  const heroGradient = isDark
    ? 'linear-gradient(135deg, #1a2e1f 0%, #234823 45%, #135200 100%)'
    : 'linear-gradient(135deg, #f6ffed 0%, #d9f7be 40%, #95de64 100%)';

  const cardLift = {
    transition: 'box-shadow 0.2s ease, transform 0.2s ease',
    borderRadius: 12,
    border: `1px solid ${themeToken.colorBorderSecondary}`,
    boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.35)' : '0 2px 12px rgba(0,0,0,0.06)',
  } as const;

  const cardHover = {
    onMouseEnter: (e: MouseEvent<HTMLDivElement>) => {
      e.currentTarget.style.boxShadow = isDark
        ? '0 6px 16px rgba(0,0,0,0.45)'
        : '0 8px 24px rgba(0,0,0,0.1)';
      e.currentTarget.style.transform = 'translateY(-2px)';
    },
    onMouseLeave: (e: MouseEvent<HTMLDivElement>) => {
      e.currentTarget.style.boxShadow = cardLift.boxShadow as string;
      e.currentTarget.style.transform = 'translateY(0)';
    },
  };

  const standardCardBody = { padding: '16px 20px' };

  return (
    <div style={{ paddingBottom: 24 }}>
      <Typography.Title level={4} style={{ marginBottom: 20 }}>
        Дашборд
      </Typography.Title>

      {/* KPI цель (админ) */}
      {isAdmin && (
        <Card
          size="small"
          style={{
            ...cardLift,
            marginBottom: SECTION_GAP,
            borderRadius: 12,
            border: `1px solid ${themeToken.colorPrimaryBorder}`,
            background: isDark ? themeToken.colorFillQuaternary : themeToken.colorPrimaryBg,
          }}
          styles={{ body: { padding: '16px 20px' } }}
        >
          <Row align="middle" gutter={[16, 12]}>
            <Col flex="none">
              <AimOutlined style={{ fontSize: 28, color: themeToken.colorPrimary }} />
            </Col>
            <Col flex="auto">
              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                Цель выручки за месяц
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                План: {formatUZS(MONTHLY_REVENUE_GOAL_UZS)} · Факт: {formatUZS(data.revenueMonth || 0)}
              </Typography.Text>
              <Progress
                percent={goalProgress}
                strokeColor={{ from: themeToken.colorPrimary, to: '#52c41a' }}
                style={{ marginTop: 10 }}
                format={(p) => `${p}%`}
              />
            </Col>
          </Row>
        </Card>
      )}

      <Row gutter={[20, 20]}>
        <Col xs={24} sm={12} lg={6}>
          <Link to="/revenue/today" style={{ display: 'block' }}>
            <Card
              bordered={false}
              hoverable
              style={{
                ...cardLift,
                cursor: 'pointer',
                background: heroGradient,
                border: `1px solid ${isDark ? 'rgba(82,196,26,0.35)' : 'rgba(82,196,26,0.45)'}`,
                boxShadow: isDark ? '0 4px 18px rgba(0,0,0,0.4)' : '0 6px 20px rgba(82,196,26,0.18)',
                borderRadius: 14,
              }}
              styles={{ body: standardCardBody }}
              {...cardHover}
            >
              <Statistic
                title={<span style={{ color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)' }}>Выручка сегодня</span>}
                value={data.revenueToday}
                formatter={(val) => formatUZS(val as number)}
                prefix={<DollarOutlined style={{ color: isDark ? '#95de64' : '#389e0d' }} />}
                valueStyle={{ color: isDark ? '#d9f7be' : '#135200', fontWeight: 700 }}
              />
              {isAdmin && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {revenueDelta >= 0 ? (
                    <span style={{ color: isDark ? '#95de64' : '#237804' }}>
                      <ArrowUpOutlined /> +{formatUZS(revenueDelta)}
                    </span>
                  ) : (
                    <span style={{ color: '#ff7875' }}>
                      <ArrowDownOutlined /> {formatUZS(revenueDelta)}
                    </span>
                  )}
                  <span style={{ color: isDark ? 'rgba(255,255,255,0.5)' : themeToken.colorTextTertiary, marginLeft: 6 }}>
                    к вчера
                  </span>
                </div>
              )}
            </Card>
          </Link>
        </Col>

        {isAdmin ? (
          <Col xs={24} sm={12} lg={6}>
            <Link to="/deals/closed" style={{ display: 'block' }}>
              <Card
                bordered={false}
                hoverable
                style={{ cursor: 'pointer', ...cardLift }}
                styles={{ body: standardCardBody }}
                {...cardHover}
              >
                <Statistic
                  title="Закрыто сделок"
                  value={data.closedDealsToday}
                  prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                  valueStyle={{ color: '#52c41a' }}
                />
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {closedDealsDelta >= 0 ? (
                    <span style={{ color: '#52c41a' }}>
                      <ArrowUpOutlined /> +{closedDealsDelta}
                    </span>
                  ) : (
                    <span style={{ color: '#ff4d4f' }}>
                      <ArrowDownOutlined /> {closedDealsDelta}
                    </span>
                  )}
                  <span style={{ color: themeToken.colorTextTertiary, marginLeft: 6 }}>к вчера</span>
                </div>
              </Card>
            </Link>
          </Col>
        ) : (
          <Col xs={24} sm={12} lg={6}>
            <Card bordered={false} style={cardLift} styles={{ body: standardCardBody }} {...cardHover}>
              <Statistic
                title="Закрыто сделок"
                value={data.closedDealsToday}
                prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
        )}

        <Col xs={24} sm={12} lg={6}>
          <Link to="/deals" style={{ display: 'block' }}>
            <Card
              bordered={false}
              hoverable
              style={{ cursor: 'pointer', ...cardLift }}
              styles={{ body: standardCardBody }}
              {...cardHover}
            >
              <Statistic
                title="Активные сделки"
                value={data.activeDealsCount}
                prefix={<FundOutlined style={{ color: '#fa8c16' }} />}
                valueStyle={{ color: '#fa8c16' }}
              />
            </Card>
          </Link>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Link to="/finance/debts" style={{ display: 'block' }}>
            <Card
              bordered={false}
              hoverable
              style={{ cursor: 'pointer', ...cardLift }}
              styles={{ body: standardCardBody }}
              {...cardHover}
            >
              <Statistic
                title="Общий долг"
                value={totalDebtDisplay}
                formatter={(val) => formatUZS(val as number)}
                prefix={<WarningOutlined style={{ color: '#ff4d4f' }} />}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Link>
        </Col>
      </Row>

      {/* Инсайты */}
      {isAdmin && (
        <Row gutter={[16, 16]} style={{ marginTop: SECTION_GAP }}>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ ...cardLift, height: '100%' }} styles={{ body: { padding: 14 } }} {...cardHover}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <LineChartOutlined style={{ fontSize: 22, color: themeToken.colorSuccess }} />
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Выручка к вчера
                  </Typography.Text>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                    {revenuePct === null ? (
                      <span style={{ color: themeToken.colorTextSecondary }}>—</span>
                    ) : (
                      <span style={{ color: revenuePct >= 0 ? themeToken.colorSuccess : themeToken.colorError }}>
                        {revenuePct >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{' '}
                        {revenuePct >= 0 ? '+' : ''}
                        {revenuePct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ ...cardLift, height: '100%' }} styles={{ body: { padding: 14 } }} {...cardHover}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <CheckCircleOutlined style={{ fontSize: 22, color: themeToken.colorInfo }} />
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Закрытые сделки к вчера
                  </Typography.Text>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                    {dealsPct === null ? (
                      <span style={{ color: themeToken.colorTextSecondary }}>—</span>
                    ) : (
                      <span style={{ color: dealsPct >= 0 ? themeToken.colorSuccess : themeToken.colorError }}>
                        {dealsPct >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{' '}
                        {dealsPct >= 0 ? '+' : ''}
                        {dealsPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ ...cardLift, height: '100%' }} styles={{ body: { padding: 14 } }} {...cardHover}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <WarningOutlined style={{ fontSize: 22, color: themeToken.colorError }} />
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Портфель долга
                  </Typography.Text>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{formatUZS(totalDebtDisplay)}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                    Динамика дня недоступна без отдельной выгрузки
                  </Typography.Text>
                </div>
              </div>
            </Card>
          </Col>
        </Row>
      )}

      {/* Топы */}
      {showAnalyticsExtras && (
        <Card
          title={
            <span>
              <TeamOutlined style={{ marginRight: 8 }} />
              Топы за месяц
            </span>
          }
          style={{ marginTop: SECTION_GAP, ...cardLift }}
          styles={{ body: { padding: '12px 16px 20px' } }}
        >
          {monthAnalyticsLoading || abcLoading ? (
            <Spin />
          ) : (
            <Row gutter={[20, 20]}>
              <Col xs={24} md={8}>
                <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                  <ShoppingOutlined /> Товары (по выручке)
                </Typography.Text>
                <List
                  size="small"
                  dataSource={topProductsByRevenue}
                  locale={{ emptyText: 'Нет данных' }}
                  renderItem={(item, i) => (
                    <List.Item style={{ padding: '8px 0', borderBlockEndColor: themeToken.colorBorderSecondary }}>
                      <span style={{ width: 22, color: themeToken.colorTextTertiary }}>{i + 1}.</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </span>
                      <Typography.Text strong style={{ marginLeft: 8 }}>{formatUZS(item.revenue)}</Typography.Text>
                    </List.Item>
                  )}
                />
              </Col>
              <Col xs={24} md={8}>
                <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                  <TeamOutlined /> Менеджеры
                </Typography.Text>
                <List
                  size="small"
                  dataSource={topManagers}
                  locale={{ emptyText: 'Нет данных' }}
                  renderItem={(item, i) => (
                    <List.Item style={{ padding: '8px 0', borderBlockEndColor: themeToken.colorBorderSecondary }}>
                      <span style={{ width: 22, color: themeToken.colorTextTertiary }}>{i + 1}.</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.fullName}
                      </span>
                      <Typography.Text strong style={{ marginLeft: 8 }}>{formatUZS(item.totalRevenue)}</Typography.Text>
                    </List.Item>
                  )}
                />
              </Col>
              <Col xs={24} md={8}>
                <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                  <UserOutlined /> Клиенты
                </Typography.Text>
                <List
                  size="small"
                  dataSource={topClients}
                  locale={{ emptyText: 'Нет данных' }}
                  renderItem={(item, i) => (
                    <List.Item
                      style={{ padding: '8px 0', borderBlockEndColor: themeToken.colorBorderSecondary, cursor: 'pointer' }}
                      onClick={() => navigate(`/clients/${item.clientId}`)}
                    >
                      <span style={{ width: 22, color: themeToken.colorTextTertiary }}>{i + 1}.</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.companyName}
                      </span>
                      <Typography.Text strong style={{ marginLeft: 8 }}>{formatUZS(item.totalRevenue)}</Typography.Text>
                    </List.Item>
                  )}
                />
              </Col>
            </Row>
          )}
        </Card>
      )}

      {/* Графики — админ */}
      {isAdmin && (
        <>
          <Row gutter={[20, 20]} style={{ marginTop: SECTION_GAP }}>
            <Col xs={24} lg={12}>
              <Card
                title="Выручка за 30 дней"
                style={cardLift}
                styles={{ body: { padding: '12px 8px 8px' } }}
              >
                <Area
                  data={data.revenueLast30Days || []}
                  xField="day"
                  yField="total"
                  shapeField="smooth"
                  height={260}
                  theme={chartTheme}
                  style={{ fill: 'linear-gradient(-90deg, rgba(82, 196, 26, 0.12) 0%, rgba(82, 196, 26, 0.55) 100%)' }}
                  line={{ style: { stroke: '#52c41a', strokeWidth: 2 } }}
                  axis={{
                    y: { labelFormatter: (v: number) => Math.round(v).toLocaleString('ru-RU'), labelFill: themeToken.colorText },
                    x: { labelFormatter: (v: string) => v.slice(5), labelFill: themeToken.colorText },
                  }}
                  tooltip={{ items: [{ channel: 'y', name: 'Выручка', valueFormatter: (v: number) => formatUZS(v) }] }}
                />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card
                title="Закрытые сделки по дням"
                style={cardLift}
                styles={{ body: { padding: '12px 8px 8px' } }}
              >
                {monthAnalyticsLoading ? (
                  <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spin />
                  </div>
                ) : (
                  <>
                    <Line
                      data={dealsByDayChart}
                      xField="day"
                      yField="count"
                      height={260}
                      theme={chartTheme}
                      shapeField="smooth"
                      style={{ stroke: themeToken.colorInfo, lineWidth: 2 }}
                      axis={{
                        y: { labelFormatter: (v: number) => String(Math.round(v)), labelFill: themeToken.colorText },
                        x: { labelFill: themeToken.colorText },
                      }}
                      tooltip={{ items: [{ channel: 'y', name: 'Сделок', valueFormatter: (v: number) => String(Math.round(v)) }] }}
                    />
                    <Typography.Paragraph type="secondary" style={{ margin: '8px 8px 0', fontSize: 11 }}>
                      Текущий месяц: число закрытых сделок распределено по дням пропорционально дневной выручке (агрегат без отдельного API).
                    </Typography.Paragraph>
                  </>
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[20, 20]} style={{ marginTop: 20 }}>
            <Col span={24}>
              <Card title="Сделки по статусам" style={cardLift} styles={{ body: { padding: '12px 16px 16px' } }}>
                {(() => {
                  const statusCounts = (data.dealsByStatusCounts || [])
                    .filter((d) => d.count > 0)
                    .sort((a, b) => b.count - a.count);
                  const maxCount = Math.max(1, ...statusCounts.map((d) => d.count));
                  const tagColorToHex: Record<string, string> = {
                    blue: '#1677ff', processing: '#1677ff', gold: '#faad14', cyan: '#13c2c2',
                    orange: '#fa8c16', lime: '#a0d911', geekblue: '#2f54eb', purple: '#722ed1',
                    warning: '#faad14', success: '#52c41a', volcano: '#ff7a45', red: '#ff4d4f',
                  };
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 12 }}>
                      {statusCounts.map((d) => {
                        const cfg = statusConfig[d.status as DealStatus];
                        const pct = Math.round((d.count / maxCount) * 100);
                        const barColor = tagColorToHex[cfg?.color || ''] || themeToken.colorPrimary;
                        return (
                          <div
                            key={d.status}
                            style={{
                              cursor: 'pointer',
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: `1px solid ${themeToken.colorBorderSecondary}`,
                              background: themeToken.colorFillQuaternary,
                              transition: 'background 0.2s, border-color 0.2s',
                            }}
                            onClick={() => navigate(`/deals?status=${d.status}`)}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = themeToken.colorFillTertiary;
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = themeToken.colorFillQuaternary;
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <DealStatusTag status={d.status as DealStatus} />
                              <Typography.Text strong style={{ fontSize: 14 }}>{d.count}</Typography.Text>
                            </div>
                            <Progress
                              percent={pct}
                              showInfo={false}
                              size="small"
                              strokeColor={barColor}
                              trailColor={themeToken.colorFillSecondary}
                            />
                          </div>
                        );
                      })}
                      {statusCounts.length === 0 && (
                        <Typography.Text type="secondary">Нет активных сделок</Typography.Text>
                      )}
                    </div>
                  );
                })()}
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* Проблемные остатки */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <WarningOutlined style={{ color: themeToken.colorError, fontSize: 18 }} />
              <Typography.Text strong style={{ fontSize: 16 }}>Проблемные остатки</Typography.Text>
            </span>
            <Badge
              count={allStockIssues.length}
              overflowCount={999}
              style={{ backgroundColor: allStockIssues.length ? themeToken.colorError : themeToken.colorSuccess }}
              showZero
            />
          </div>
        }
        style={{
          marginTop: SECTION_GAP,
          borderRadius: 14,
          border: `1px solid ${allStockIssues.length ? `${themeToken.colorError}55` : themeToken.colorBorderSecondary}`,
          boxShadow: allStockIssues.length
            ? (isDark ? '0 4px 20px rgba(255,77,79,0.12)' : '0 6px 22px rgba(255,77,79,0.1)')
            : cardLift.boxShadow,
          background: allStockIssues.length
            ? (isDark ? 'rgba(255,77,79,0.06)' : 'rgba(255,77,79,0.04)')
            : undefined,
        }}
        styles={{ body: { padding: '16px 20px' } }}
      >
        {allStockIssues.length === 0 ? (
          <Typography.Text type="secondary">
            <CheckCircleOutlined style={{ color: themeToken.colorSuccess, marginRight: 8 }} />
            Все товары в достаточном количестве
          </Typography.Text>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {allStockIssues.map((item) => (
              <Card
                key={item.id}
                size="small"
                style={{
                  ...cardLift,
                  borderLeft: `4px solid ${item.issue === 'zero' ? themeToken.colorError : themeToken.colorWarning}`,
                  cursor: 'pointer',
                  borderRadius: 10,
                }}
                {...cardHover}
                onClick={() => navigate(`/inventory/products/${item.id}`)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Typography.Text strong>{item.name}</Typography.Text>
                    <div><Tag style={{ marginTop: 4 }}>{item.sku}</Tag></div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: item.issue === 'zero' ? themeToken.colorError : themeToken.colorWarning, fontWeight: 700, fontSize: 16 }}>
                      {item.stock}
                    </span>
                    <div style={{ fontSize: 11, color: themeToken.colorTextSecondary }}>мин: {item.minStock}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Table
            dataSource={allStockIssues}
            rowKey="id"
            pagination={false}
            size="small"
            bordered={false}
            rowClassName={(r) => (r.issue === 'zero' ? 'stock-row-zero' : 'stock-row-low')}
            onRow={(r) => ({ onClick: () => navigate(`/inventory/products/${r.id}`), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Товар', dataIndex: 'name' },
              { title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
              {
                title: 'Остаток',
                dataIndex: 'stock',
                align: 'right' as const,
                render: (v: number, r) => (
                  <span style={{ color: r.issue === 'zero' ? themeToken.colorError : themeToken.colorWarning, fontWeight: 700 }}>{v}</span>
                ),
              },
              {
                title: 'Мин. остаток',
                dataIndex: 'minStock',
                align: 'right' as const,
              },
            ]}
          />
        )}
      </Card>

      <style>{`
        .stock-row-zero td { background: rgba(255, 77, 79, 0.06) !important; }
        .stock-row-low td { background: rgba(250, 140, 22, 0.06) !important; }
      `}</style>
    </div>
  );
}
