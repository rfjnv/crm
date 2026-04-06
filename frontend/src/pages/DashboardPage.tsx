import { useMemo, type CSSProperties } from 'react';
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
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { Area } from '@ant-design/charts';
import DealStatusTag, { statusConfig } from '../components/DealStatusTag';
import type { UserRole, DealStatus } from '../types';

const MONTHLY_REVENUE_GOAL_UZS = 250_000_000;

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function DeltaBadge({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) return <span style={{ fontSize: 12, opacity: 0.4 }}>—</span>;
  const up = value >= 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 500, color: up ? '#389e0d' : '#cf1322' }}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{' '}
      {up ? '+' : ''}{value.toFixed(1)}%
      {suffix && <span style={{ opacity: 0.6, marginLeft: 3 }}>{suffix}</span>}
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

  const user = useAuthStore((s) => s.user);
  const { token: tk } = theme.useToken();
  const navigate = useNavigate();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const chartTheme = isDark ? 'classicDark' : 'classic';
  const isMobile = useIsMobile();

  const role = user?.role as UserRole | undefined;
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
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

  if (isLoading || !data) {
    return <Spin size="large" style={{ display: 'block', margin: '120px auto' }} />;
  }

  const totalDebt = debtsData?.totals?.totalDebtOwed ?? data.totalDebt;
  const revPct = isAdmin ? pctChange(data.revenueToday || 0, data.revenueYesterday || 0) : null;
  const dealPct = isAdmin ? pctChange(data.closedDealsToday || 0, data.closedDealsYesterday || 0) : null;
  const goalPct = Math.min(100, Math.round(((data.revenueMonth || 0) / MONTHLY_REVENUE_GOAL_UZS) * 100));

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

  return (
    <div style={{ paddingBottom: 32 }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <Typography.Title level={4} style={{ margin: 0, fontWeight: 600 }}>Дашборд</Typography.Title>
        {user?.fullName && (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Добро пожаловать, {user.fullName.split(' ')[0]}
          </Typography.Text>
        )}
      </div>

      {/* ── KPI cards ── */}
      <Row gutter={[16, 16]}>
        {/* Revenue — accent */}
        <Col xs={24} sm={12} lg={6}>
          <Link to="/revenue/today" style={{ display: 'block', height: '100%' }}>
            <Card
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%', borderLeft: '3px solid #52c41a' }}
              styles={{ body: cardBody }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                Выручка сегодня
              </Typography.Text>
              <div style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}>
                {formatUZS(data.revenueToday || 0)}
              </div>
              {isAdmin && (
                <div style={{ marginTop: 6 }}>
                  <DeltaBadge value={revPct} suffix="к вчера" />
                </div>
              )}
            </Card>
          </Link>
        </Col>

        {/* Closed deals */}
        <Col xs={24} sm={12} lg={6}>
          <Link to={isAdmin ? '/deals/closed' : '#'} style={{ display: 'block', height: '100%' }}>
            <Card bordered={false} hoverable={isAdmin} style={{ ...card, cursor: isAdmin ? 'pointer' : 'default', height: '100%' }} styles={{ body: cardBody }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>Закрыто сделок</Typography.Text>
              <div style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}>
                {data.closedDealsToday}
              </div>
              {isAdmin && (
                <div style={{ marginTop: 8 }}><DeltaBadge value={dealPct} suffix="к вчера" /></div>
              )}
            </Card>
          </Link>
        </Col>

        {/* Active deals */}
        <Col xs={24} sm={12} lg={6}>
          <Link to="/deals" style={{ display: 'block', height: '100%' }}>
            <Card bordered={false} hoverable style={{ ...card, cursor: 'pointer', height: '100%' }} styles={{ body: cardBody }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>Активные сделки</Typography.Text>
              <div style={{ fontSize: 20, fontWeight: 500, marginTop: 4, color: '#fa8c16', lineHeight: 1.3 }}>
                {data.activeDealsCount}
              </div>
            </Card>
          </Link>
        </Col>

        {/* Debt */}
        <Col xs={24} sm={12} lg={6}>
          <Link to="/finance/debts" style={{ display: 'block', height: '100%' }}>
            <Card bordered={false} hoverable style={{ ...card, cursor: 'pointer', height: '100%' }} styles={{ body: cardBody }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>Общий долг</Typography.Text>
              <div style={{ fontSize: 20, fontWeight: 500, marginTop: 4, color: '#cf1322', lineHeight: 1.3 }}>
                {formatUZS(totalDebt)}
              </div>
            </Card>
          </Link>
        </Col>
      </Row>

      {/* ── Monthly goal (compact, clickable → settings) ── */}
      {isAdmin && (
        <Card
          bordered={false}
          hoverable
          style={{ ...card, marginTop: 16, cursor: 'pointer' }}
          styles={{ body: { padding: '12px 20px' } }}
          onClick={() => navigate('/settings/company')}
        >
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
              {formatUZS(data.revenueMonth || 0)} / {formatUZS(MONTHLY_REVENUE_GOAL_UZS)}
            </Typography.Text>
          </div>
        </Card>
      )}

      {/* ── Chart + Statuses ── */}
      {isAdmin && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} lg={14}>
            <Card
              bordered={false}
              style={{ ...card, height: '100%' }}
              styles={{ body: { padding: '16px 12px 8px' } }}
              title={<Typography.Text strong style={{ fontSize: 14 }}>Выручка за 30 дней</Typography.Text>}
            >
              <Area
                data={data.revenueLast30Days || []}
                xField="day"
                yField="total"
                shapeField="smooth"
                height={240}
                theme={chartTheme}
                style={{ fill: isDark ? 'rgba(82,196,26,0.15)' : 'rgba(82,196,26,0.12)' }}
                line={{ style: { stroke: '#52c41a', strokeWidth: 2 } }}
                axis={{
                  y: { labelFormatter: (v: number) => Math.round(v).toLocaleString('ru-RU'), labelFill: tk.colorTextSecondary, grid: false },
                  x: { labelFormatter: (v: string) => v.slice(5), labelFill: tk.colorTextSecondary },
                }}
                tooltip={{ items: [{ channel: 'y', name: 'Выручка', valueFormatter: (v: number) => formatUZS(v) }] }}
              />
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
      )}

      {/* ── Tops ── */}
      {showExtras && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
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
              items: topClients.map((c) => ({ label: c.companyName, value: formatUZS(c.totalRevenue), href: `/clients/${c.clientId}` })),
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                          {row.label}
                        </span>
                        <Typography.Text strong style={{ fontSize: 13, flexShrink: 0 }}>{row.value}</Typography.Text>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* ── Stock issues ── */}
      <Card
        bordered={false}
        style={{ ...card, marginTop: 24 }}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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

      <style>{`
        .stock-row-zero td { background: rgba(255, 77, 79, 0.06) !important; }
        .stock-row-low td { background: rgba(250, 140, 22, 0.06) !important; }
      `}</style>
    </div>
  );
}
