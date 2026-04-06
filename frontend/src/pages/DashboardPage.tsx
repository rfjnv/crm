import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Table, Typography, Spin, Tag, Badge, theme, Progress } from 'antd';
import {
  DollarOutlined,
  FundOutlined,
  WarningOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { dashboardApi } from '../api/warehouse.api';
import { financeApi } from '../api/finance.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { Area } from '@ant-design/charts';
import DealStatusTag, { statusConfig } from '../components/DealStatusTag';
import type { UserRole, DealStatus } from '../types';

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.summary,
    refetchInterval: 10_000,
  });

  // Долг по закрытым сделкам (как на кассе / «Долги»)
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

  if (isLoading || !data) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const revenueDelta = (data.revenueToday || 0) - (data.revenueYesterday || 0);
  const closedDealsDelta = (data.closedDealsToday || 0) - (data.closedDealsYesterday || 0);

  const allStockIssues = [
    ...(data.zeroStockProducts || []).map((p) => ({ ...p, issue: 'zero' as const })),
    ...(data.lowStockProducts || []).map((p) => ({ ...p, issue: 'low' as const })),
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>Дашборд</Typography.Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Link to="/revenue/today" style={{ display: 'block' }}>
            <Card bordered={false} hoverable style={{ cursor: 'pointer' }}>
              <Statistic
                title="Выручка сегодня"
                value={data.revenueToday}
                formatter={(val) => formatUZS(val as number)}
                prefix={<DollarOutlined style={{ color: '#52c41a' }} />}
                valueStyle={{ color: '#52c41a' }}
              />
              {isAdmin && (
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  {revenueDelta >= 0 ? (
                    <span style={{ color: '#52c41a' }}>
                      <ArrowUpOutlined /> +{formatUZS(revenueDelta)}
                    </span>
                  ) : (
                    <span style={{ color: '#ff4d4f' }}>
                      <ArrowDownOutlined /> {formatUZS(revenueDelta)}
                    </span>
                  )}
                  <span style={{ color: themeToken.colorTextTertiary, marginLeft: 4 }}>vs вчера</span>
                </div>
              )}
            </Card>
          </Link>
        </Col>

        {isAdmin ? (
          <Col xs={24} sm={12} lg={6}>
            <Link to="/deals/closed" style={{ display: 'block' }}>
              <Card bordered={false} hoverable style={{ cursor: 'pointer' }}>
                <Statistic
                  title="Закрыто сделок"
                  value={data.closedDealsToday}
                  prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                  valueStyle={{ color: '#52c41a' }}
                />
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  {closedDealsDelta >= 0 ? (
                    <span style={{ color: '#52c41a' }}>
                      <ArrowUpOutlined /> +{closedDealsDelta}
                    </span>
                  ) : (
                    <span style={{ color: '#ff4d4f' }}>
                      <ArrowDownOutlined /> {closedDealsDelta}
                    </span>
                  )}
                  <span style={{ color: themeToken.colorTextTertiary, marginLeft: 4 }}>vs вчера</span>
                </div>
              </Card>
            </Link>
          </Col>
        ) : (
          <Col xs={24} sm={12} lg={6}>
            <Card bordered={false}>
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
            <Card bordered={false} hoverable style={{ cursor: 'pointer' }}>
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
            <Card bordered={false} hoverable style={{ cursor: 'pointer' }}>
              <Statistic
                title="Общий долг"
                value={debtsData?.totals?.totalDebtOwed ?? data.totalDebt}
                formatter={(val) => formatUZS(val as number)}
                prefix={<WarningOutlined style={{ color: '#ff4d4f' }} />}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Link>
        </Col>
      </Row>

      {/* Charts — Admin only */}
      {isAdmin && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={14}>
            <Card title="Выручка за 30 дней" bordered={false}>
              <Area
                data={data.revenueLast30Days || []}
                xField="day"
                yField="total"
                shapeField="smooth"
                height={280}
                theme={chartTheme}
                style={{ fill: 'linear-gradient(-90deg, rgba(82, 196, 26, 0.15) 0%, rgba(82, 196, 26, 0.6) 100%)' }}
                line={{ style: { stroke: '#52c41a', strokeWidth: 2 } }}
                axis={{
                  y: { labelFormatter: (v: number) => Math.round(v).toLocaleString('ru-RU'), labelFill: themeToken.colorText },
                  x: { labelFormatter: (v: string) => v.slice(5), labelFill: themeToken.colorText },
                }}
                tooltip={{ items: [{ channel: 'y', name: 'Выручка', valueFormatter: (v: number) => formatUZS(v) }] }}
              />
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card title="Сделки по статусам" bordered={false}>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 280, overflowY: 'auto' }}>
                    {statusCounts.map((d) => {
                      const cfg = statusConfig[d.status as DealStatus];
                      const pct = Math.round((d.count / maxCount) * 100);
                      const barColor = tagColorToHex[cfg?.color || ''] || themeToken.colorPrimary;
                      return (
                        <div
                          key={d.status}
                          style={{ cursor: 'pointer', padding: '4px 0' }}
                          onClick={() => navigate(`/deals?status=${d.status}`)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
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
      )}

      {/* Stock issues */}
      <Card
        title={
          <span>
            <WarningOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            Проблемные остатки
            {allStockIssues.length > 0 && (
              <Badge count={allStockIssues.length} style={{ marginLeft: 8 }} />
            )}
          </span>
        }
        bordered={false}
        style={{ marginTop: 16 }}
      >
        {allStockIssues.length === 0 ? (
          <Typography.Text type="secondary">Все товары в достаточном количестве</Typography.Text>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allStockIssues.map((item) => (
              <Card
                key={item.id}
                size="small"
                style={{ borderLeft: `3px solid ${item.issue === 'zero' ? '#ff4d4f' : '#fa8c16'}`, cursor: 'pointer' }}
                onClick={() => navigate(`/inventory/products/${item.id}`)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Typography.Text strong>{item.name}</Typography.Text>
                    <div><Tag style={{ marginTop: 4 }}>{item.sku}</Tag></div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: item.issue === 'zero' ? '#ff4d4f' : '#fa8c16', fontWeight: 600, fontSize: 16 }}>
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
            rowClassName={(r) => r.issue === 'zero' ? 'stock-row-zero' : 'stock-row-low'}
            onRow={(r) => ({ onClick: () => navigate(`/inventory/products/${r.id}`), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Товар', dataIndex: 'name' },
              { title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
              {
                title: 'Остаток',
                dataIndex: 'stock',
                align: 'right' as const,
                render: (v: number, r) => (
                  <span style={{ color: r.issue === 'zero' ? '#ff4d4f' : '#fa8c16', fontWeight: 600 }}>{v}</span>
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
