import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography } from 'antd';
import DealStatusTag from '../components/DealStatusTag';
import { formatUZS } from '../utils/currency';
import { dealsApi } from '../api/deals.api';
import { useAuthStore } from '../store/authStore';
import type { Deal, DealStatus } from '../types';
import dayjs from 'dayjs';

export default function ApprovalsPage() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  let filterStatus: DealStatus | undefined;
  let title = 'Ожидающие действий';
  let description = '';

  if (role === 'WAREHOUSE') {
    filterStatus = 'WAITING_STOCK_CONFIRMATION';
    title = 'Ожидает подтв. склада';
    description = 'Сделки, ожидающие подтверждения наличия на складе.';
  } else if (role === 'ACCOUNTANT') {
    filterStatus = 'STOCK_CONFIRMED';
    title = 'Финансовое одобрение';
    description = 'Сделки, ожидающие финансового одобрения.';
  } else if (role === 'WAREHOUSE_MANAGER') {
    filterStatus = 'READY_FOR_SHIPMENT';
    title = 'Отгрузка';
    description = 'Сделки, готовые к отгрузке.';
  }

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', filterStatus],
    queryFn: () => dealsApi.list(filterStatus),
  });

  const columns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Статус', dataIndex: 'status', render: (s: Deal['status']) => <DealStatusTag status={s} /> },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    { title: 'Позиций', dataIndex: ['_count', 'items'], align: 'center' as const },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    { title: 'Дата', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>{title}</Typography.Title>
      {description && (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          {description}
        </Typography.Text>
      )}

      <Table
        dataSource={deals}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20 }}
        size="middle"
        bordered={false}
        locale={{ emptyText: 'Нет сделок, ожидающих действий' }}
      />
    </div>
  );
}
