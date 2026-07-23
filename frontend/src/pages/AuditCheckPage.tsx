import { useState, useEffect, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DatePicker, Card, Typography, Tag, Spin, Empty, Button, Space,
  Descriptions, Table, Badge, Divider, Checkbox, Progress, Popconfirm, theme, Input,
} from 'antd';
import { ThunderboltOutlined, ArrowLeftOutlined, ExportOutlined, CheckCircleFilled, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { dealsApi } from '../api/deals.api';
import { usersApi } from '../api/users.api';
import { clientsApi } from '../api/clients.api';
import { inventoryApi } from '../api/warehouse.api';
import SuperOverridePanel from '../components/SuperOverridePanel';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { formatUZS } from '../utils/currency';
import { useAuthStore } from '../store/authStore';
import type { Deal, DealItem, PaymentRecord, PaymentStatus, UserRole } from '../types';
import { getFirstName } from '../lib/name-utils';
import './AuditCheckPage.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  UNPAID: 'default', PARTIAL: 'orange', PAID: 'green',
};
const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Не оплачено', PARTIAL: 'Частично', PAID: 'Оплачено',
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные', TRANSFER: 'Перечисление', PAYME: 'Payme',
  QR: 'QR', CLICK: 'Click', TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка', DEBT: 'Долг',
};
const DELIVERY_LABELS: Record<string, string> = {
  SELF_PICKUP: 'Самовывоз', YANDEX: 'Яндекс', DELIVERY: 'Доставка',
};

function isoRangeForTashkentYmd(ymd: string) {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    closedFrom: new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00+05:00`).toISOString(),
    closedTo: new Date(`${y}-${pad(m)}-${pad(d)}T23:59:59.999+05:00`).toISOString(),
  };
}

function formatQty(v: number | string | null | undefined): string {
  if (v == null) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : parseFloat(n.toFixed(3)).toString();
}

function dealMatchesSearch(deal: Deal, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    deal.title,
    deal.client?.companyName,
    deal.client?.contactName,
    deal.manager?.fullName,
    deal.vehicleNumber,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

/** App's top nav bar (.ant-layout-header) is itself sticky at top:0 with a higher
 * z-index. A page-level sticky bar also pinned at top:0 would render underneath it
 * (hidden), so we measure the real header height and stick right below it instead. */
function useStickyTopOffset() {
  const [top, setTop] = useState(56);
  useEffect(() => {
    const header = document.querySelector('.ant-layout-header');
    if (!header) return;
    const update = () => setTop(header.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return top;
}

// ─── Deal card ────────────────────────────────────────────────────────────────

function DealAuditCard({ deal, onOverride, checked, onToggle }: {
  deal: Deal;
  onOverride: (id: string) => void;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ['deal', deal.id],
    queryFn: () => dealsApi.getById(deal.id),
  });
  const { data: payments = [] } = useQuery({
    queryKey: ['deal-payments', deal.id],
    queryFn: () => dealsApi.getDealPayments(deal.id),
  });

  const { token } = theme.useToken();
  const d = detail ?? deal;
  const items: DealItem[] = detail?.items ?? [];
  const debt = Number(d.amount) - Number(d.paidAmount);

  const paymentColumns = [
    {
      title: 'Дата', key: 'paidAt', width: 130,
      render: (_: unknown, r: PaymentRecord) => dayjs(r.paidAt).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: 'Сумма', key: 'amount', align: 'right' as const,
      render: (_: unknown, r: PaymentRecord) => formatUZS(r.amount),
    },
    {
      title: 'Способ', key: 'method', width: 110,
      render: (_: unknown, r: PaymentRecord) => r.method ? (PAYMENT_METHOD_LABELS[r.method] ?? r.method) : '—',
    },
    {
      title: 'Внёс', key: 'creator',
      render: (_: unknown, r: PaymentRecord) => getFirstName(r.creator?.fullName) || '—',
    },
  ];

  const itemColumns = [
    { title: 'Товар', dataIndex: ['product', 'name'] as string[], key: 'name' },
    {
      title: 'Арт.', dataIndex: ['product', 'sku'] as string[], key: 'sku',
      render: (v: string) => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—',
    },
    {
      title: 'Кол-во', dataIndex: 'requestedQty', key: 'qty', align: 'right' as const, width: 80,
      render: (v: unknown) => formatQty(v as number),
    },
    { title: 'Ед.', dataIndex: ['product', 'unit'] as string[], key: 'unit', width: 55 },
    {
      title: 'Цена', dataIndex: 'price', key: 'price', align: 'right' as const,
      render: (v: unknown) => v != null ? formatUZS(v as string) : '—',
    },
    {
      title: 'Сумма', key: 'total', align: 'right' as const,
      render: (_: unknown, r: DealItem) =>
        r.requestedQty != null && r.price != null
          ? formatUZS(Number(r.price) * Number(r.requestedQty))
          : '—',
    },
  ];

  return (
    <Card
      size="small"
      className={checked ? 'audit-checked-card' : undefined}
      style={checked ? ({
        '--audit-checked-bg': token.colorSuccessBg,
        '--audit-checked-border': token.colorSuccess,
      } as CSSProperties) : undefined}
      title={
        <Space
          wrap
          size={8}
          align="center"
          style={{ cursor: 'pointer', padding: '8px 0', margin: '-8px 0' }}
          onClick={() => onToggle(deal.id)}
        >
          <Checkbox
            checked={checked}
            onChange={() => onToggle(deal.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={checked ? 'Отметить сделку как непроверенную' : 'Отметить сделку как проверенную'}
          />
          <ClientCompanyDisplay client={deal.client} />
          <Typography.Text strong>{formatUZS(deal.amount)}</Typography.Text>
          <Tag color={PAYMENT_STATUS_COLORS[deal.paymentStatus]}>
            {PAYMENT_STATUS_LABELS[deal.paymentStatus]}
          </Tag>
          {deal.closedAt && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {dayjs(deal.closedAt).format('HH:mm')}
            </Typography.Text>
          )}
          {checked && (
            <Tag color="success" icon={<CheckCircleFilled />} style={{ margin: 0 }}>
              Проверено
            </Tag>
          )}
        </Space>
      }
      extra={
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          style={{ background: '#722ed1', borderColor: '#722ed1', color: '#fff' }}
          onClick={() => onOverride(deal.id)}
        >
          Override
        </Button>
      }
    >
      {isLoading ? (
        <Spin size="small" style={{ display: 'block', margin: '16px auto' }} />
      ) : (
        <>
          <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small" style={{ marginBottom: 12 }}>
            <Descriptions.Item label="Менеджер">{getFirstName(d.manager?.fullName) || '—'}</Descriptions.Item>
            <Descriptions.Item label="Способ оплаты">
              {d.paymentMethod
                ? <Tag color={d.paymentMethod === 'DEBT' ? 'red' : 'blue'}>{PAYMENT_METHOD_LABELS[d.paymentMethod] ?? d.paymentMethod}</Tag>
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Тип оплаты">
              {d.paymentType === 'FULL' ? 'Полная' : d.paymentType === 'PARTIAL' ? 'Частичная' : 'Рассрочка'}
            </Descriptions.Item>
            <Descriptions.Item label="Оплачено">
              {formatUZS(d.paidAmount)} / {formatUZS(d.amount)}
            </Descriptions.Item>
            {debt > 0 && (
              <Descriptions.Item label="Долг">
                <Typography.Text type="danger" strong>{formatUZS(debt)}</Typography.Text>
              </Descriptions.Item>
            )}
            {d.discount && Number(d.discount) > 0 && (
              <Descriptions.Item label="Скидка">{formatUZS(d.discount)}</Descriptions.Item>
                  )}
                  {d.dueDate && (
                    <Descriptions.Item label="Срок оплаты">
                      {dayjs(d.dueDate).format('DD.MM.YYYY')}
                    </Descriptions.Item>
                  )}
                  {d.deliveryType && (
                    <Descriptions.Item label="Доставка">
                      {DELIVERY_LABELS[d.deliveryType] ?? d.deliveryType}
                    </Descriptions.Item>
                  )}
                  {d.vehicleNumber && (
                    <Descriptions.Item label="Машина">
                      {d.vehicleNumber}{d.vehicleType ? ` (${d.vehicleType})` : ''}
                    </Descriptions.Item>
                  )}
                  {d.contract && (
                    <Descriptions.Item label="Договор">{d.contract.contractNumber}</Descriptions.Item>
                  )}
                  {d.transferInn && (
                    <Descriptions.Item label="ИНН">
                      <Typography.Text code>{d.transferInn}</Typography.Text>
                    </Descriptions.Item>
                  )}
                  {d.terms && (
                    <Descriptions.Item label="Условия" span={2}>{d.terms}</Descriptions.Item>
                  )}
                  <Descriptions.Item label="Создана">
                    {dayjs(d.createdAt).format('DD.MM.YYYY HH:mm')}
                  </Descriptions.Item>
                  <Descriptions.Item label="Закрыта">
                    {d.closedAt ? dayjs(d.closedAt).format('DD.MM.YYYY HH:mm') : '—'}
                  </Descriptions.Item>
                </Descriptions>

                {payments.length > 0 && (
                  <>
                    <Divider style={{ margin: '8px 0 10px' }}>
                      Платежи ({payments.length})
                    </Divider>
                    <Table
                      dataSource={payments}
                      columns={paymentColumns}
                      rowKey="id"
                      size="small"
                      pagination={false}
                      scroll={{ x: 420 }}
                    />
                  </>
                )}

                {items.length > 0 && (
                  <>
                    <Divider style={{ margin: '8px 0 10px' }}>
                      Товары ({items.length})
                    </Divider>
                    <Table
                      dataSource={items}
                      columns={itemColumns}
                      rowKey="id"
                      size="small"
                      pagination={false}
                      scroll={{ x: 480 }}
                      summary={() => {
                        const total = items.reduce(
                          (s, i) => s + Number(i.price ?? 0) * Number(i.requestedQty ?? 0), 0,
                        );
                        if (total <= 0) return null;
                        return (
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={5} align="right">
                              <Typography.Text strong>Итого:</Typography.Text>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right">
                              <Typography.Text strong>{formatUZS(total)}</Typography.Text>
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        );
                      }}
                    />
                  </>
                )}

                {detail?.shipment && (
                  <>
                    <Divider style={{ margin: '10px 0 8px' }}>Отгрузка</Divider>
                    <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                      <Descriptions.Item label="Транспорт">
                        {detail.shipment.vehicleType} · {detail.shipment.vehicleNumber}
                      </Descriptions.Item>
                      <Descriptions.Item label="Водитель">{detail.shipment.driverName}</Descriptions.Item>
                      <Descriptions.Item label="Накладная">{detail.shipment.deliveryNoteNumber}</Descriptions.Item>
                      <Descriptions.Item label="Отправлено">
                        {dayjs(detail.shipment.departureTime).format('DD.MM.YYYY HH:mm')}
                      </Descriptions.Item>
                    </Descriptions>
                  </>
                )}

              <div style={{ marginTop: 14 }}>
                <Link to={`/deals/${deal.id}`} target="_blank">
                  <Button size="small" icon={<ExportOutlined />}>Открыть сделку</Button>
                </Link>
              </div>
            </>
          )}
    </Card>
  );
}

// ─── Override mode (inline full-page) ─────────────────────────────────────────

function OverrideModeView({ dealId, onBack }: { dealId: string; onBack: () => void }) {
  const queryClient = useQueryClient();

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => dealsApi.getById(dealId),
  });
  const { data: payments = [] } = useQuery({
    queryKey: ['deal-payments', dealId],
    queryFn: () => dealsApi.getDealPayments(dealId),
  });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: inventoryApi.listProducts });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() });
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list });

  return (
    <div style={{ paddingBottom: 88 }}>
      <Space align="center" wrap style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>Назад к аудиту</Button>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Override: {deal?.title ?? '...'}
        </Typography.Title>
        <Tag color="red">SUPER OVERRIDE</Tag>
      </Space>

      {isLoading && <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />}

      {deal && (
        <SuperOverridePanel
          deal={deal}
          payments={payments}
          products={products}
          users={users}
          clients={clients.map((c) => ({
            id: c.id,
            companyName: c.companyName,
            contactName: c.contactName ?? null,
            phone: c.phone ?? null,
            isSvip: c.isSvip,
          }))}
          onCancel={onBack}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['deal', dealId] });
            queryClient.invalidateQueries({ queryKey: ['audit-check-deals'] });
            onBack();
          }}
        />
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AuditCheckPage() {
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const role = user?.role as UserRole | undefined;
  const canOverride = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const [params, setParams] = useSearchParams();
  const dateStr = params.get('date');
  const date: Dayjs = dateStr ? dayjs(dateStr) : dayjs();

  const [overrideDealId, setOverrideDealId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const stickyTop = useStickyTopOffset();

  const ymd = date.format('YYYY-MM-DD');
  const { closedFrom, closedTo } = isoRangeForTashkentYmd(ymd);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`audit-checked-${ymd}`);
      setCheckedIds(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch {
      setCheckedIds(new Set());
    }
    setSearch('');
  }, [ymd]);

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(`audit-checked-${ymd}`, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['audit-check-deals', ymd],
    queryFn: () => dealsApi.list('CLOSED', true, { closedFrom, closedTo }),
  });

  if (overrideDealId && canOverride) {
    return <OverrideModeView dealId={overrideDealId} onBack={() => setOverrideDealId(null)} />;
  }

  const totalAmount = deals.reduce((s, d) => s + Number(d.amount), 0);
  const totalPaid = deals.reduce((s, d) => s + Number(d.paidAmount), 0);
  const checkedCount = deals.filter((d) => checkedIds.has(d.id)).length;
  const progressPercent = deals.length > 0 ? Math.round((checkedCount / deals.length) * 100) : 0;

  const allDone = deals.length > 0 && checkedCount === deals.length;

  const filteredDeals = deals.filter((d) => dealMatchesSearch(d, search));

  return (
    <div style={{ paddingBottom: 88 }}>
      {/* Whole header stays pinned below the app's own sticky top nav while scrolling */}
      <div style={{
        position: 'sticky',
        top: stickyTop,
        zIndex: 20,
        background: token.colorBgLayout,
        paddingBottom: 12,
        marginBottom: 10,
        borderBottom: `2px solid ${token.colorBorderSecondary}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <BackButton fallback="/dashboard" />
          <Typography.Title level={4} style={{ margin: 0 }}>Аудит-проверка сделок</Typography.Title>
        </div>

        <Space wrap align="center" size={8} style={{ marginBottom: 10 }}>
          <DatePicker
            value={date}
            onChange={(d) => {
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (d) next.set('date', d.format('YYYY-MM-DD'));
                else next.delete('date');
                return next;
              });
            }}
            format="DD.MM.YYYY"
            allowClear={false}
          />
          {!isLoading && deals.length > 0 && (
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
              placeholder="Поиск по клиенту, менеджеру, машине..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 260 }}
            />
          )}
          {!isLoading && deals.length > 0 && (
            <Space size={6} wrap>
              <Badge count={deals.length} style={{ backgroundColor: token.colorPrimary }} />
              <Typography.Text type="secondary">сделок</Typography.Text>
              <Typography.Text type="secondary">·</Typography.Text>
              <Typography.Text>Сумма: <strong>{formatUZS(totalAmount)}</strong></Typography.Text>
              {totalPaid < totalAmount && (
                <>
                  <Typography.Text type="secondary">·</Typography.Text>
                  <Typography.Text>Оплачено: <strong>{formatUZS(totalPaid)}</strong></Typography.Text>
                  <Typography.Text type="secondary">·</Typography.Text>
                  <Typography.Text type="danger">Долг: <strong>{formatUZS(totalAmount - totalPaid)}</strong></Typography.Text>
                </>
              )}
            </Space>
          )}
        </Space>

        {!isLoading && deals.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Typography.Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              Проверено:{' '}
              <strong style={{ color: allDone ? token.colorSuccess : token.colorPrimary, fontSize: 15 }}>
                {checkedCount}
              </strong>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}> / {deals.length}</Typography.Text>
            </Typography.Text>
            <Progress
              percent={progressPercent}
              strokeColor={allDone ? token.colorSuccess : token.colorPrimary}
              showInfo
              size="small"
              style={{ flex: 1, margin: 0 }}
              format={(p) => <span style={{ fontSize: 12, color: allDone ? token.colorSuccess : undefined }}>{p}%</span>}
            />
            {/* Reset button is always mounted (just disabled at 0) so its width never
                shows up/disappears and shifts the row when the first item is checked. */}
            <Popconfirm
              title="Сбросить прогресс проверки?"
              description={`Отметки о проверке для ${date.format('DD.MM.YYYY')} будут удалены.`}
              okText="Сбросить"
              okButtonProps={{ danger: true }}
              cancelText="Отмена"
              onConfirm={() => {
                setCheckedIds(new Set());
                try { localStorage.removeItem(`audit-checked-${ymd}`); } catch {}
              }}
            >
              <Button
                size="small"
                type="link"
                danger
                disabled={checkedCount === 0}
                style={{ padding: '8px 4px', height: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}
              >
                Сбросить
              </Button>
            </Popconfirm>
          </div>
        )}
      </div>

      {isLoading && <Spin style={{ display: 'block', margin: '60px auto' }} />}

      {!isLoading && deals.length === 0 && (
        <Empty
          description={`Нет закрытых сделок за ${date.format('DD.MM.YYYY')}`}
          style={{ marginTop: 60 }}
        />
      )}

      {!isLoading && deals.length > 0 && filteredDeals.length === 0 && (
        <Empty
          description={`Ничего не найдено по запросу «${search}»`}
          style={{ marginTop: 60 }}
        />
      )}

      <Space direction="vertical" style={{ width: '100%' }} size={6}>
        {filteredDeals.map((deal) => (
          <DealAuditCard
            key={deal.id}
            deal={deal}
            onOverride={canOverride ? setOverrideDealId : () => {}}
            checked={checkedIds.has(deal.id)}
            onToggle={toggleChecked}
          />
        ))}
      </Space>
    </div>
  );
}
