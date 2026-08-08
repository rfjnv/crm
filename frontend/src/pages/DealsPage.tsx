import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Table, Button, Select, Typography, message, Space, Popconfirm, Segmented, Card, Tag, theme } from 'antd';
import { PlusOutlined, InboxOutlined, UnorderedListOutlined, AppstoreOutlined, LinkOutlined, WarningOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import DealStatusTag, { statusConfig } from '../components/DealStatusTag';
import ReceiptPunchedTag from '../components/ReceiptPunchedTag';
import { useAuthStore } from '../store/authStore';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import BackButton from '../components/BackButton';
import MobileCardList from '../components/MobileCardList';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import type { Deal, DealStatus, PaymentStatus } from '../types';
import { getFirstName } from '../lib/name-utils';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

const kanbanStatuses: DealStatus[] = [
  'NEW', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED', 'IN_PROGRESS',
  'WAITING_FINANCE', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT', 'SHIPMENT_ON_HOLD',
  'REJECTED', 'REOPENED',
];

function DebtTag({ deal }: { deal: Deal }) {
  const isDebt = deal.paymentType === 'PARTIAL' || deal.paymentType === 'INSTALLMENT';
  if (!isDebt || deal.paymentStatus === 'PAID') return null;
  const overdue = deal.dueDate && dayjs(deal.dueDate).isBefore(dayjs(), 'day');
  return (
    <Tag
      color={overdue ? 'red' : 'orange'}
      style={{ fontSize: 11, padding: '0 6px', fontWeight: 700, marginRight: 0 }}
    >
      {overdue ? '🔴 ПРОСРОЧЕН' : '🟡 В ДОЛГ'}
      {deal.dueDate && ` · ${dayjs(deal.dueDate).format('DD.MM')}`}
    </Tag>
  );
}

function DealCard({ deal, openLabel }: { deal: Deal; openLabel: string }) {
  const cfg = statusConfig[deal.status];
  const { token } = theme.useToken();
  const isDebt = deal.paymentType === 'PARTIAL' || deal.paymentType === 'INSTALLMENT';
  const overdue = isDebt && deal.paymentStatus !== 'PAID' && deal.dueDate && dayjs(deal.dueDate).isBefore(dayjs(), 'day');
  return (
    <Card
      size="small"
      hoverable
      bordered={false}
      style={{
        borderLeft: `3px solid ${overdue ? '#ff4d4f' : isDebt && deal.paymentStatus !== 'PAID' ? '#faad14' : cfg.color === 'processing' ? token.colorPrimary : cfg.color}`,
        marginBottom: 8,
      }}
    >
      <Link to={`/deals/${deal.id}`} style={{ textDecoration: 'none' }}>
        <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>{deal.title}</Typography.Text>
        <ClientCompanyDisplay client={deal.client} secondary />
        {deal.isOverridden && (
          <Tag color="red" icon={<WarningOutlined />} style={{ fontSize: 11, marginTop: 4 }}>
            Изменено супер-админом
          </Tag>
        )}
        <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <Typography.Text style={{ fontSize: 13, fontWeight: 500 }}>{formatUZS(deal.amount)}</Typography.Text>
          <Space size={4} wrap>
            <DebtTag deal={deal} />
            <Tag color={paymentStatusLabels[deal.paymentStatus]?.color} style={{ fontSize: 11, marginRight: 0 }}>
              {paymentStatusLabels[deal.paymentStatus]?.label}
            </Tag>
            <ReceiptPunchedTag isReceiptPunched={deal.isReceiptPunched} />
          </Space>
        </div>
        <div style={{ marginTop: 6 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <LinkOutlined style={{ marginRight: 6 }} />
            {openLabel}
          </Typography.Text>
        </div>
      </Link>
    </Card>
  );
}

function KanbanColumn({ status, deals, openLabel }: { status: DealStatus; deals: Deal[]; openLabel: string }) {
  const { token } = theme.useToken();
  return (
    <div style={{ minWidth: 220, flex: '1 0 220px' }}>
      <div style={{ padding: '8px 12px', marginBottom: 8, background: token.colorBgLayout, borderRadius: 6, fontWeight: 600, fontSize: 13 }}>
        <DealStatusTag status={status} /> ({deals.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 60, borderRadius: 6, padding: 4 }}>
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} openLabel={openLabel} />
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
  const isManager = user?.role === 'MANAGER';
  const entityLabel = isManager ? 'Заявки' : 'Сделки';
  const oneEntityLabel = isManager ? 'Заявка' : 'Сделка';
  const openLabel = isManager ? 'Открыть заявку' : 'Открыть сделку';

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

  // Какие колонки непустые. Раньше ради этого выкачивался весь список сделок
  // вторым запросом каждые 10 секунд — теперь сервер отдаёт только счётчики.
  const { data: statusCounts } = useQuery({
    queryKey: ['deals', 'status-counts'],
    queryFn: () => dealsApi.statusCounts(),
    refetchInterval: 10_000,
  });

  const hideIfEmpty: DealStatus[] = ['READY_FOR_SHIPMENT', 'SHIPMENT_ON_HOLD', 'REOPENED'];
  const statusesWithDeals = new Set(
    Object.entries(statusCounts ?? {})
      .filter(([, count]) => count > 0)
      .map(([status]) => status as DealStatus),
  );

  const archiveMut = useMutation({
    mutationFn: (id: string) => dealsApi.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      message.success('Сделка архивирована');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка архивации';
      message.error(msg);
    },
  });

  const dealsByStatus = kanbanStatuses.reduce((acc, status) => {
    acc[status] = (deals ?? []).filter((d) => d.status === status);
    return acc;
  }, {} as Record<DealStatus, Deal[]>);

  const columns = [
    { title: oneEntityLabel, dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', key: 'client', render: (_: unknown, r: Deal) => <ClientCompanyDisplay client={r.client} link /> },
    {
      title: 'Статус',
      dataIndex: 'status',
      render: (s: DealStatus, r: Deal) => (
        <Space size={4} wrap>
          <DealStatusTag status={s} />
          <ReceiptPunchedTag isReceiptPunched={r.isReceiptPunched} />
          {r.isOverridden && (
            <Tag color="red" icon={<WarningOutlined />}>
              Изменено супер-админом
            </Tag>
          )}
        </Space>
      ),
    },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Оплата',
      key: 'payment',
      render: (_: unknown, r: Deal) => (
        <Space size={4} wrap>
          <DebtTag deal={r} />
          <Tag color={paymentStatusLabels[r.paymentStatus]?.color || 'default'}>
            {paymentStatusLabels[r.paymentStatus]?.label || r.paymentStatus}
          </Tag>
        </Space>
      ),
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'], render: (v: string) => getFirstName(v) || v },
    { title: 'Дата', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    ...(isManager
      ? [{
        title: '',
        width: 150,
        render: (_: unknown, r: Deal) => (
          <Button size="small" icon={<LinkOutlined />} onClick={() => navigate(`/deals/${r.id}`)}>
            Открыть заявку
          </Button>
        ),
      }]
      : []),
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
  const isMobile = useIsMobile();

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', marginBottom: 16, gap: 8 }}>
        <Space wrap>
          <BackButton fallback="/dashboard" />
          <Typography.Title level={4} style={{ margin: 0 }}>{entityLabel}</Typography.Title>
          {viewMode === 'table' && (
            <Select
              allowClear
              placeholder="Фильтр по статусу"
              style={{ width: isMobile ? '100%' : 200 }}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
              options={Object.entries(statusConfig)
                .filter(([k]) => k !== 'CLOSED')
                .filter(([k]) => !hideIfEmpty.includes(k as DealStatus) || statusesWithDeals.has(k as DealStatus))
                .map(([k, v]) => ({ label: v.label, value: k }))}
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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/deals/new')}>
              {isMobile ? '' : isManager ? 'Новая заявка' : 'Создать'}
            </Button>
          )}
        </Space>
      </div>

      {viewMode === 'table' ? (
        isMobile ? (
          <MobileCardList
            data={deals ?? []}
            rowKey="id"
            loading={isLoading}
            renderCard={(deal) => <DealCard deal={deal} openLabel={openLabel} />}
          />
        ) : (
          <Table
            dataSource={deals}
            columns={columns}
            rowKey="id"
            loading={isLoading}
            pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
            size="middle"
            bordered={false}
          />
        )
      ) : (
        isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {kanbanStatuses.map((status) => {
              const statusDeals = dealsByStatus[status] ?? [];
              if (statusDeals.length === 0) return null;
              return (
                <div key={status}>
                  <div style={{ padding: '6px 12px', marginBottom: 8, background: 'rgba(0,0,0,0.03)', borderRadius: 6, fontWeight: 600, fontSize: 13 }}>
                    <DealStatusTag status={status} /> ({statusDeals.length})
                  </div>
                  {statusDeals.map((deal) => (
                    <DealCard key={deal.id} deal={deal} openLabel={openLabel} />
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
            {kanbanStatuses.map((status) => (
              <KanbanColumn key={status} status={status} deals={dealsByStatus[status] ?? []} openLabel={openLabel} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
