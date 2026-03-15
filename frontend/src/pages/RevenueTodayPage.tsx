import { useQuery } from '@tanstack/react-query';
import { Table, Typography, Spin, Button, Card } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import dayjs from 'dayjs';
import { dashboardApi } from '../api/warehouse.api';
import { formatUZS } from '../utils/currency';
import type { RevenueTodayPayment } from '../types';

export default function RevenueTodayPage() {
  const isMobile = useIsMobile();
  const { data, isLoading } = useQuery({
    queryKey: ['revenue-today'],
    queryFn: dashboardApi.revenueToday,
    refetchInterval: 15_000,
  });

  if (isLoading || !data) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const columns = [
    {
      title: 'Время',
      dataIndex: 'paidAt',
      width: 80,
      render: (v: string) => dayjs(v).format('HH:mm'),
    },
    {
      title: 'Клиент',
      dataIndex: ['client', 'companyName'],
    },
    {
      title: 'Сделка',
      dataIndex: ['deal', 'title'],
      render: (v: string, r: RevenueTodayPayment) => (
        <Link to={`/deals/${r.deal.id}`}>{v}</Link>
      ),
    },
    {
      title: 'Менеджер',
      dataIndex: ['creator', 'fullName'],
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Способ оплаты',
      dataIndex: 'method',
      width: 140,
      render: (v: string | null) => v || '—',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link to="/dashboard">
          <Button type="text" icon={<ArrowLeftOutlined />} />
        </Link>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Выручка за сегодня
        </Typography.Title>
      </div>

      <Card bordered={false}>
        {isMobile ? (
          <>
            <MobileCardList
              data={data.payments}
              rowKey="id"
              renderCard={(p: RevenueTodayPayment) => (
                <Card size="small" bordered>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography.Text strong>{formatUZS(p.amount)}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(p.paidAt).format('HH:mm')}</Typography.Text>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <Link to={`/deals/${p.deal.id}`}><Typography.Text style={{ fontSize: 12 }}>{p.deal.title}</Typography.Text></Link>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>{p.client?.companyName} · {p.method || '—'}</Typography.Text>
                </Card>
              )}
            />
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Typography.Text strong style={{ fontSize: 16, color: '#52c41a' }}>Итого: {formatUZS(data.total)}</Typography.Text>
            </div>
          </>
        ) : (
        <Table
          dataSource={data.payments}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="middle"
          bordered={false}
          scroll={{ x: 600 }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <strong>Итого</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <strong style={{ color: '#52c41a' }}>{formatUZS(data.total)}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} />
            </Table.Summary.Row>
          )}
        />
        )}
      </Card>
    </div>
  );
}
