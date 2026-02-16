import { useQuery } from '@tanstack/react-query';
import { Table, Typography, Spin, Button, Card } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { dashboardApi } from '../api/warehouse.api';
import { formatUZS } from '../utils/currency';
import type { RevenueTodayPayment } from '../types';

export default function RevenueTodayPage() {
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
        <Table
          dataSource={data.payments}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="middle"
          bordered={false}
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
      </Card>
    </div>
  );
}
