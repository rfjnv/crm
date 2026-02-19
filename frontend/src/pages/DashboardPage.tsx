import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Table, Typography, Spin, Tag, Badge, theme } from 'antd';
import {
  DollarOutlined,
  RiseOutlined,
  FundOutlined,
  WarningOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { dashboardApi } from '../api/warehouse.api';
import { formatUZS } from '../utils/currency';
import { useAuthStore } from '../store/authStore';
import { Area, Bar as BarChart } from '@ant-design/charts';
import { statusConfig } from '../components/DealStatusTag';
import type { UserRole, DealStatus } from '../types';

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.summary,
    refetchInterval: 10_000,
  });
  const user = useAuthStore((s) => s.user);
  const { token: themeToken } = theme.useToken();

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
            <Card bordered={false}>
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
          </Col>
        ) : (
          <Col xs={24} sm={12} lg={6}>
            <Card bordered={false}>
              <Statistic
                title="Выручка за месяц"
                value={data.revenueMonth}
                formatter={(val) => formatUZS(val as number)}
                prefix={<RiseOutlined style={{ color: '#1677ff' }} />}
                valueStyle={{ color: '#1677ff' }}
              />
            </Card>
          </Col>
        )}

        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="Активные сделки"
              value={data.activeDealsCount}
              prefix={<FundOutlined style={{ color: '#fa8c16' }} />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="Общий долг"
              value={data.totalDebt}
              formatter={(val) => formatUZS(val as number)}
              prefix={<WarningOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
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
                style={{ fill: 'linear-gradient(-90deg, rgba(82, 196, 26, 0.15) 0%, rgba(82, 196, 26, 0.6) 100%)' }}
                line={{ style: { stroke: '#52c41a', strokeWidth: 2 } }}
                axis={{
                  y: { labelFormatter: (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : String(v) },
                  x: { labelFormatter: (v: string) => v.slice(5) },
                }}
                tooltip={{ items: [{ channel: 'y', name: 'Выручка', valueFormatter: (v: number) => formatUZS(v) }] }}
              />
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card title="Сделки по статусам" bordered={false}>
              <BarChart
                data={(data.dealsByStatusCounts || []).map((d) => ({
                  status: (statusConfig[d.status as DealStatus]?.label) || d.status,
                  count: d.count,
                }))}
                xField="count"
                yField="status"
                height={280}
                colorField="status"
                axis={{ y: { labelFormatter: (v: string) => v.length > 16 ? v.slice(0, 14) + '...' : v } }}
                tooltip={{ items: [{ channel: 'x', name: 'Сделок' }] }}
              />
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
        ) : (
          <Table
            dataSource={allStockIssues}
            rowKey="id"
            pagination={false}
            size="small"
            bordered={false}
            rowClassName={(r) => r.issue === 'zero' ? 'stock-row-zero' : 'stock-row-low'}
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
