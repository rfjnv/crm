import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography, Input, Tag } from 'antd';
import { dealsApi } from '../api/deals.api';
import DealStatusTag from '../components/DealStatusTag';
import { formatUZS } from '../utils/currency';
import type { Deal, PaymentStatus } from '../types';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

export default function ClosedDealsPage() {
  const [search, setSearch] = useState('');

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', 'CLOSED'],
    queryFn: () => dealsApi.list('CLOSED', true),
  });

  const filtered = (deals ?? []).filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return d.title.toLowerCase().includes(q) || d.client?.companyName?.toLowerCase().includes(q);
  });

  const columns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Статус', dataIndex: 'status', render: () => <DealStatusTag status="CLOSED" /> },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Оплата', dataIndex: 'paymentStatus', render: (s: PaymentStatus) => {
        const cfg = paymentStatusLabels[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      }
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    { title: 'Дата закрытия', dataIndex: 'updatedAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Закрытые сделки</Typography.Title>
        <Input.Search
          placeholder="Поиск по названию или клиенту..."
          style={{ width: 300 }}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Table
        dataSource={filtered}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
        size="middle"
        bordered={false}
        locale={{ emptyText: 'Нет закрытых сделок' }}
      />
    </div>
  );
}
