import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Table, Button, Select, Typography, message, Space, Popconfirm, Segmented, Card, Tag, theme } from 'antd';
import { PlusOutlined, InboxOutlined, UnorderedListOutlined, AppstoreOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import DealStatusTag, { statusConfig } from '../components/DealStatusTag';
import { useAuthStore } from '../store/authStore';
import { formatUZS } from '../utils/currency';
import type { Deal, DealStatus, PaymentStatus } from '../types';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

const kanbanStatuses: DealStatus[] = [
  'NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED',
  'FINANCE_APPROVED', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT', 'SHIPPED',
];

function DealCard({ deal }: { deal: Deal }) {
  const cfg = statusConfig[deal.status];
  const { token } = theme.useToken();
  return (
    <Card
      size="small"
      hoverable
      bordered={false}
      style={{
        borderLeft: `3px solid ${cfg.color === 'processing' ? token.colorPrimary : cfg.color}`,
        marginBottom: 8,
      }}
    >
      <Link to={`/deals/${deal.id}`} style={{ textDecoration: 'none' }}>
        <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>{deal.title}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{deal.client?.companyName}</Typography.Text>
        <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography.Text style={{ fontSize: 13, fontWeight: 500 }}>{formatUZS(deal.amount)}</Typography.Text>
          <Tag color={paymentStatusLabels[deal.paymentStatus]?.color} style={{ fontSize: 11, marginRight: 0 }}>
            {paymentStatusLabels[deal.paymentStatus]?.label}
          </Tag>
        </div>
      </Link>
    </Card>
  );
}

function KanbanColumn({ status, deals }: { status: DealStatus; deals: Deal[] }) {
  const { token } = theme.useToken();
  return (
    <div style={{ minWidth: 220, flex: '1 0 220px' }}>
      <div style={{ padding: '8px 12px', marginBottom: 8, background: token.colorBgLayout, borderRadius: 6, fontWeight: 600, fontSize: 13 }}>
        <DealStatusTag status={status} /> ({deals.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 60, borderRadius: 6, padding: 4 }}>
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </div>
    </div>
  );
}

const STORAGE_KEY_VIEW = 'dealsViewMode';
const STORAGE_KEY_STATUS = 'dealsStatusFilter';

export default function DealsPage() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_VIEW);
    return saved === 'kanban' ? 'kanban' : 'table';
  });
  const [statusFilter, setStatusFilter] = useState<DealStatus | undefined>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_STATUS);
    return saved ? (saved as DealStatus) : undefined;
  });

  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  useEffect(() => { localStorage.setItem(STORAGE_KEY_VIEW, viewMode); }, [viewMode]);
  useEffect(() => {
    if (statusFilter) localStorage.setItem(STORAGE_KEY_STATUS, statusFilter);
    else localStorage.removeItem(STORAGE_KEY_STATUS);
  }, [statusFilter]);

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', statusFilter],
    queryFn: () => dealsApi.list(statusFilter),
    refetchInterval: 10_000,
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => dealsApi.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      message.success('Сделка архивирована');
    },
  });

  const dealsByStatus = kanbanStatuses.reduce((acc, status) => {
    acc[status] = (deals ?? []).filter((d) => d.status === status);
    return acc;
  }, {} as Record<DealStatus, Deal[]>);

  const columns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Статус', dataIndex: 'status', render: (s: DealStatus) => <DealStatusTag status={s} /> },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Оплата', dataIndex: 'paymentStatus', render: (s: PaymentStatus) => {
        const cfg = paymentStatusLabels[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      }
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    { title: 'Дата', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    ...(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.permissions?.includes('archive_deals')
      ? [{
        title: '',
        width: 50,
        render: (_: unknown, r: Deal) => (
          <Popconfirm title="Архивировать сделку?" onConfirm={() => archiveMut.mutate(r.id)}>
            <Button type="text" danger icon={<InboxOutlined />} size="small" />
          </Popconfirm>
        ),
      }]
      : []),
  ];

  const canCreate = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'MANAGER';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>Сделки</Typography.Title>
          {viewMode === 'table' && (
            <Select
              allowClear
              placeholder="Фильтр по статусу"
              style={{ width: 200 }}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
              options={Object.entries(statusConfig).map(([k, v]) => ({ label: v.label, value: k }))}
            />
          )}
        </Space>
        <Space>
          <Segmented
            value={viewMode}
            onChange={(v) => { setViewMode(v as 'table' | 'kanban'); if (v === 'kanban') setStatusFilter(undefined); }}
            options={[
              { label: <UnorderedListOutlined />, value: 'table' },
              { label: <AppstoreOutlined />, value: 'kanban' },
            ]}
          />
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/deals/new')}>Создать</Button>
          )}
        </Space>
      </div>

      {viewMode === 'table' ? (
        <Table
          dataSource={deals}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          size="middle"
          bordered={false}
        />
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
          {kanbanStatuses.map((status) => (
            <KanbanColumn key={status} status={status} deals={dealsByStatus[status] ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}
