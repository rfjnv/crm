import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Table, Button, Select, Typography, message, Space, Popconfirm, Segmented, Card, Tag, theme } from 'antd';
import { PlusOutlined, InboxOutlined, UnorderedListOutlined, AppstoreOutlined, LinkOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import DealStatusTag, { statusConfig } from '../components/DealStatusTag';
import { useAuthStore } from '../store/authStore';
import { DILNOZA_DEALS_FILTER_OPTIONS } from '../constants/dilnozaPayments';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import type { Deal, DealStatus, PaymentStatus } from '../types';
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

function DealCard({ deal, openLabel }: { deal: Deal; openLabel: string }) {
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

function isDilnozaUser(fullName?: string, login?: string): boolean {
  const f = (fullName || '').trim().toLowerCase();
  const l = (login || '').trim().toLowerCase();
  return f === 'dilnoza' || f.includes('дилноза') || l === 'dilnoza';
}

export default function DealsPage() {
  const navigate = useNavigate();
  const location = useLocation();
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
  const isDilnoza = isDilnozaUser(user?.fullName, user?.login);
  const paymentFilter = new URLSearchParams(location.search).get('dilnozaPayment');
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

  // Fetch all deals (unfiltered) to know which statuses have deals
  const { data: allDeals } = useQuery({
    queryKey: ['deals', undefined],
    queryFn: () => dealsApi.list(undefined),
    refetchInterval: 10_000,
  });

  const hideIfEmpty: DealStatus[] = ['READY_FOR_SHIPMENT', 'SHIPMENT_ON_HOLD', 'REOPENED'];
  const filteredDeals = (deals ?? []).filter((d) => {
    if (!isDilnoza || !paymentFilter) return true;
    if (paymentFilter === 'ACCOUNTING') return d.paymentMethod === 'TRANSFER' || d.paymentMethod === 'INSTALLMENT';
    return d.paymentMethod === paymentFilter;
  });
  const filteredAllDeals = (allDeals ?? []).filter((d) => {
    if (!isDilnoza || !paymentFilter) return true;
    if (paymentFilter === 'ACCOUNTING') return d.paymentMethod === 'TRANSFER' || d.paymentMethod === 'INSTALLMENT';
    return d.paymentMethod === paymentFilter;
  });
  const statusesWithDeals = new Set(filteredAllDeals.map((d) => d.status));

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
    acc[status] = filteredDeals.filter((d) => d.status === status);
    return acc;
  }, {} as Record<DealStatus, Deal[]>);

  const columns = [
    { title: oneEntityLabel, dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
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
          <Typography.Title level={4} style={{ margin: 0 }}>{entityLabel}</Typography.Title>
          {isDilnoza && (
            <Select
              style={{ width: isMobile ? '100%' : 220 }}
              value={paymentFilter || 'ALL'}
              onChange={(v) => navigate(v === 'ALL' ? '/deals' : `/deals?dilnozaPayment=${v}`)}
              options={DILNOZA_DEALS_FILTER_OPTIONS}
            />
          )}
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
            data={filteredDeals}
            rowKey="id"
            loading={isLoading}
            renderCard={(deal) => <DealCard deal={deal} openLabel={openLabel} />}
          />
        ) : (
          <Table
            dataSource={filteredDeals}
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
