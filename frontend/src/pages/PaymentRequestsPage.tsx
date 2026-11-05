import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, DatePicker, Empty, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Skeleton,
  Space, Table, Tag, Typography, message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import BackButton from '../components/BackButton';
import { clientsApi } from '../api/clients.api';
import { productsApi } from '../api/products.api';
import {
  paymentRequestsApi,
  type AllocationSource,
  type PaymentRequest,
  type PaymentRequestProduct,
  type PaymentRequestStatus,
} from '../api/paymentRequests.api';
import { useAuthStore } from '../store/authStore';
import { userHasRole } from '../lib/roles';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { Product } from '../types';

/**
 * Заявки на оплату: менеджер собирает товары за период и отправляет бухгалтеру, бухгалтер
 * принимает оплату. Сделки при этом не меняются, на них только добавляются оплаты.
 */

const STATUS_LABEL: Record<PaymentRequestStatus, { text: string; color: string }> = {
  PENDING: { text: 'На рассмотрении', color: 'gold' },
  ACCEPTED: { text: 'Принята', color: 'green' },
  REJECTED: { text: 'Отклонена', color: 'red' },
  CANCELED: { text: 'Отозвана', color: 'default' },
};

const METHODS = [
  { label: 'Перечисление', value: 'TRANSFER' },
  { label: 'Наличные', value: 'CASH' },
  { label: 'Click', value: 'CLICK' },
  { label: 'Payme', value: 'PAYME' },
  { label: 'QR', value: 'QR' },
  { label: 'Терминал', value: 'TERMINAL' },
];
const methodLabel = (value: string) => METHODS.find((m) => m.value === value)?.label ?? value;

const SOURCE_LABEL: Record<AllocationSource, string> = {
  goods: 'Товар из заявки',
  period: 'Другой долг за период',
  other: 'Долг вне периода',
};

const ruDate = (date: string) => dayjs(date).format('DD.MM.YYYY');
const qtyText = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);

function errorText(err: unknown): string {
  const d = (err as { response?: { data?: { error?: string; details?: string[] } } })?.response?.data;
  return [d?.error, ...(d?.details ?? [])].filter(Boolean).join(': ') || 'Ошибка';
}

interface DraftRow {
  product: PaymentRequestProduct;
  boughtQty: number;
  requestedQty: number;
  qty: number | null;
  price: number | null;
}

function NewRequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [clientId, setClientId] = useState<string>();
  const [period, setPeriod] = useState<[Dayjs, Dayjs] | null>(null);
  const [method, setMethod] = useState('TRANSFER');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);

  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list, enabled: open });
  const { data: products } = useQuery<Product[]>({ queryKey: ['products'], queryFn: productsApi.list, enabled: open });

  const from = period?.[0].format('YYYY-MM-DD');
  const to = period?.[1].format('YYYY-MM-DD');
  const { data: available, isFetching } = useQuery({
    queryKey: ['payment-requests-available', clientId, from, to],
    queryFn: () => paymentRequestsApi.available(clientId!, from!, to!),
    enabled: open && !!clientId && !!from && !!to,
  });

  useEffect(() => {
    if (!available) return;
    setRows(available.rows.map((r) => ({
      product: r.product,
      boughtQty: r.boughtQty,
      requestedQty: r.requestedQty,
      qty: null,
      price: r.price || null,
    })));
  }, [available]);

  const reset = () => {
    setClientId(undefined);
    setPeriod(null);
    setMethod('TRANSFER');
    setNote('');
    setRows([]);
  };
  const close = () => { reset(); onClose(); };

  const chosen = rows.filter((r) => (r.qty ?? 0) > 0);
  const total = chosen.reduce((sum, r) => sum + (r.qty ?? 0) * (r.price ?? 0), 0);
  const missingPrice = chosen.some((r) => !r.price);
  const updateRow = (id: string, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r) => (r.product.id === id ? { ...r, ...patch } : r)));

  const addableProducts = useMemo(() => {
    const present = new Set(rows.map((r) => r.product.id));
    return (products ?? [])
      .filter((p) => !present.has(p.id))
      .map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }));
  }, [products, rows]);

  const createMut = useMutation({
    mutationFn: () => paymentRequestsApi.create({
      clientId: clientId!,
      from: from!,
      to: to!,
      method,
      note: note.trim() || undefined,
      items: chosen.map((r) => ({ productId: r.product.id, qty: r.qty!, price: r.price! })),
    }),
    onSuccess: (created) => {
      message.success(`Заявка №${created.number} отправлена бухгалтеру`);
      qc.invalidateQueries({ queryKey: ['payment-requests'] });
      qc.invalidateQueries({ queryKey: ['payment-requests-summary'] });
      qc.removeQueries({ queryKey: ['payment-requests-available'] });
      close();
    },
    onError: (err) => message.error(errorText(err)),
  });

  const columns = [
    {
      title: 'Товар',
      key: 'product',
      render: (_: unknown, r: DraftRow) => (
        <>
          <div>{r.product.sku}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.product.name}</Typography.Text>
        </>
      ),
    },
    {
      title: 'Куплено',
      key: 'bought',
      align: 'right' as const,
      width: 110,
      render: (_: unknown, r: DraftRow) => `${qtyText(r.boughtQty)} ${r.product.unit}`,
    },
    {
      title: 'Уже в заявках',
      key: 'requested',
      align: 'right' as const,
      width: 110,
      render: (_: unknown, r: DraftRow) => (r.requestedQty > 0 ? qtyText(r.requestedQty) : '—'),
    },
    {
      title: 'К оплате',
      key: 'qty',
      width: 170,
      render: (_: unknown, r: DraftRow) => {
        const free = Math.max(0, r.boughtQty - r.requestedQty);
        const over = (r.qty ?? 0) > free;
        return (
          <Space.Compact style={{ width: '100%' }}>
            <InputNumber
              aria-label={`Количество к оплате, ${r.product.sku}`}
              min={0}
              value={r.qty}
              status={over ? 'warning' : undefined}
              style={{ width: '100%' }}
              onChange={(v) => updateRow(r.product.id, { qty: v })}
            />
            {free > 0 && <Button onClick={() => updateRow(r.product.id, { qty: Number(free.toFixed(3)) })}>Всё</Button>}
          </Space.Compact>
        );
      },
    },
    {
      title: 'Цена',
      key: 'price',
      width: 140,
      render: (_: unknown, r: DraftRow) => (
        <InputNumber
          aria-label={`Цена, ${r.product.sku}`}
          min={0}
          value={r.price}
          formatter={moneyFormatter}
          parser={moneyParser}
          style={{ width: '100%' }}
          onChange={(v) => updateRow(r.product.id, { price: v as number | null })}
        />
      ),
    },
    {
      title: 'Сумма',
      key: 'sum',
      align: 'right' as const,
      width: 130,
      render: (_: unknown, r: DraftRow) => ((r.qty ?? 0) > 0 && r.price ? formatUZS((r.qty ?? 0) * r.price) : '—'),
    },
  ];

  const hasOver = chosen.some((r) => (r.qty ?? 0) > Math.max(0, r.boughtQty - r.requestedQty));

  return (
    <Modal
      open={open}
      onCancel={close}
      title="Новая заявка на оплату"
      width={isMobile ? '100%' : 960}
      okText="Отправить бухгалтеру"
      cancelText="Отмена"
      okButtonProps={{ disabled: chosen.length === 0 || missingPrice, loading: createMut.isPending }}
      onOk={() => createMut.mutate()}
      destroyOnHidden
    >
      <Space wrap style={{ marginBottom: 12, width: '100%' }}>
        <Select
          showSearch
          aria-label="Клиент"
          placeholder="Клиент"
          style={{ width: 260, maxWidth: '100%' }}
          value={clientId}
          optionFilterProp="label"
          options={(clients ?? []).map((c) => ({ value: c.id, label: c.companyName }))}
          onChange={setClientId}
        />
        <DatePicker.RangePicker
          format="DD.MM.YYYY"
          value={period}
          placeholder={['Начало периода', 'Конец периода']}
          onChange={(v) => setPeriod(v && v[0] && v[1] ? [v[0], v[1]] : null)}
        />
        <Select aria-label="Способ оплаты" style={{ width: 170 }} value={method} options={METHODS} onChange={setMethod} />
      </Space>

      {!clientId || !period ? (
        <Empty description="Выберите клиента и период: система покажет, что куплено" />
      ) : isFetching ? (
        <Skeleton active />
      ) : (
        <>
          {available && available.dealsInPeriod > 0 && (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              Сделок за период: {available.dealsInPeriod}, долг по ним: {formatUZS(available.periodDebt)}
            </Typography.Paragraph>
          )}
          {available && available.dealsInPeriod === 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              message="За этот период сделок не найдено. Можно добавить товары вручную, но оплата ляжет на другие долги клиента."
            />
          )}
          <Table
            size="small"
            rowKey={(r) => r.product.id}
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 760 }}
            locale={{ emptyText: 'Нет товаров' }}
          />
          <Select
            showSearch
            aria-label="Добавить товар"
            placeholder="Добавить товар не из списка"
            style={{ width: 320, maxWidth: '100%', marginTop: 8 }}
            value={null}
            optionFilterProp="label"
            options={addableProducts}
            onChange={(id: string) => {
              const p = products?.find((x) => x.id === id);
              if (p) setRows((rs) => [...rs, {
                product: { id: p.id, name: p.name, sku: p.sku, unit: p.unit },
                boughtQty: 0,
                requestedQty: 0,
                qty: null,
                price: null,
              }]);
            }}
          />
          {hasOver && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              message="По некоторым товарам к оплате больше, чем куплено за период и ещё не попало в заявки. Отправить можно, бухгалтер увидит расхождение."
            />
          )}
          <Input.TextArea
            rows={2}
            maxLength={500}
            placeholder="Комментарий для бухгалтера"
            value={note}
            style={{ marginTop: 12 }}
            onChange={(e) => setNote(e.target.value)}
          />
          <Typography.Title level={5} style={{ textAlign: 'right', marginTop: 12, marginBottom: 0 }}>
            Итого: {formatUZS(total)}
          </Typography.Title>
        </>
      )}
    </Modal>
  );
}

function AcceptModal({ request, onClose }: { request: PaymentRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [note, setNote] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['payment-requests-preview', request.id],
    queryFn: () => paymentRequestsApi.preview(request.id),
    gcTime: 0,
  });

  const acceptMut = useMutation({
    mutationFn: () => paymentRequestsApi.accept(request.id, {
      // Сегодня — текущий момент; прошлый день — полдень, чтобы оплата осталась в своём дне.
      paidAt: (date.isSame(dayjs(), 'day') ? dayjs() : date.hour(12).minute(0).second(0)).toISOString(),
      note: note.trim() || undefined,
    }),
    onSuccess: () => {
      message.success(`Оплата по заявке №${request.number} принята`);
      qc.invalidateQueries({ queryKey: ['payment-requests'] });
      qc.invalidateQueries({ queryKey: ['payment-requests-summary'] });
      onClose();
    },
    onError: (err) => message.error(errorText(err)),
  });

  const mismatched = data?.lines.filter((l) => l.qty > l.boughtQty) ?? [];

  return (
    <Modal
      open
      onCancel={onClose}
      title={`Принять оплату: заявка №${request.number}`}
      width={isMobile ? '100%' : 860}
      okText={`Принять ${formatUZS(request.amount)}`}
      cancelText="Отмена"
      okButtonProps={{ disabled: !data || data.unallocated > 0, loading: acceptMut.isPending }}
      onOk={() => acceptMut.mutate()}
    >
      {isLoading && <Skeleton active />}
      {error && <Alert type="error" showIcon message={errorText(error)} />}
      {data && (
        <>
          <Typography.Title level={5}>Товары в заявке</Typography.Title>
          <Table
            size="small"
            rowKey={(l) => l.product.id + l.price}
            pagination={false}
            scroll={{ x: 560 }}
            dataSource={data.lines}
            columns={[
              { title: 'Товар', key: 'p', render: (_, l) => l.product.sku },
              { title: 'В заявке', key: 'q', align: 'right', render: (_, l) => `${qtyText(l.qty)} ${l.product.unit}` },
              {
                title: 'Куплено за период',
                key: 'b',
                align: 'right',
                render: (_, l) => (
                  <Typography.Text type={l.qty > l.boughtQty ? 'warning' : undefined}>
                    {qtyText(l.boughtQty)} {l.product.unit}
                  </Typography.Text>
                ),
              },
              { title: 'Цена', key: 'c', align: 'right', render: (_, l) => formatUZS(l.price) },
              { title: 'Сумма', key: 's', align: 'right', render: (_, l) => formatUZS(l.lineTotal) },
            ]}
          />
          {mismatched.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              message="В заявке больше, чем куплено за период. Разница ляжет на другие долги клиента, см. ниже."
            />
          )}

          <Typography.Title level={5} style={{ marginTop: 16 }}>Куда ляжет оплата</Typography.Title>
          <Table
            size="small"
            rowKey={(a) => a.deal.id}
            pagination={false}
            scroll={{ x: 560 }}
            dataSource={data.allocations}
            locale={{ emptyText: 'Нет сделок с долгом' }}
            columns={[
              { title: 'Сделка', key: 'd', render: (_, a) => <Link to={`/deals/${a.deal.id}`} target="_blank">{a.deal.title}</Link> },
              { title: 'Дата', key: 'dt', render: (_, a) => ruDate(a.deal.date) },
              { title: 'Долг', key: 'debt', align: 'right', render: (_, a) => formatUZS(a.debt) },
              { title: 'Оплата', key: 'amt', align: 'right', render: (_, a) => <b>{formatUZS(a.amount)}</b> },
              {
                title: 'Основание',
                key: 's',
                render: (_, a) => <Tag color={a.source === 'goods' ? 'green' : 'orange'}>{SOURCE_LABEL[a.source]}</Tag>,
              },
            ]}
          />
          {data.unallocated > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 8 }}
              message={`Сумма заявки больше всего долга клиента на ${formatUZS(data.unallocated)}. Принять нельзя: отклоните заявку и попросите исправить.`}
            />
          )}

          <Space wrap style={{ marginTop: 16, width: '100%' }}>
            <span>Дата оплаты:</span>
            <DatePicker
              format="DD.MM.YYYY"
              allowClear={false}
              value={date}
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
              onChange={(d) => d && setDate(d)}
            />
          </Space>
          <Input.TextArea
            rows={2}
            maxLength={400}
            placeholder="Примечание к оплате"
            style={{ marginTop: 8 }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </>
      )}
    </Modal>
  );
}

function RejectModal({ request, onClose }: { request: PaymentRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const rejectMut = useMutation({
    mutationFn: () => paymentRequestsApi.reject(request.id, reason.trim()),
    onSuccess: () => {
      message.success(`Заявка №${request.number} отклонена`);
      qc.invalidateQueries({ queryKey: ['payment-requests'] });
      qc.invalidateQueries({ queryKey: ['payment-requests-summary'] });
      onClose();
    },
    onError: (err) => message.error(errorText(err)),
  });
  return (
    <Modal
      open
      onCancel={onClose}
      title={`Отклонить заявку №${request.number}`}
      okText="Отклонить"
      cancelText="Отмена"
      okButtonProps={{ danger: true, disabled: reason.trim().length < 3, loading: rejectMut.isPending }}
      onOk={() => rejectMut.mutate()}
    >
      <Input.TextArea
        rows={3}
        maxLength={500}
        autoFocus
        placeholder="Причина: её увидит менеджер"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}

function RequestCard({ request, canDecide, currentUserId, onAccept, onReject }: {
  request: PaymentRequest;
  canDecide: boolean;
  currentUserId?: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const qc = useQueryClient();
  const status = STATUS_LABEL[request.status];
  const cancelMut = useMutation({
    mutationFn: () => paymentRequestsApi.cancel(request.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-requests'] });
      qc.invalidateQueries({ queryKey: ['payment-requests-summary'] });
    },
    onError: (err) => message.error(errorText(err)),
  });
  const isPending = request.status === 'PENDING';

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space wrap>
          <Typography.Text strong>№{request.number}</Typography.Text>
          <Link to={`/clients/${request.client.id}`}>{request.client.companyName}</Link>
          <Typography.Text type="secondary">{ruDate(request.from)} — {ruDate(request.to)}</Typography.Text>
          <Tag color={status.color}>{status.text}</Tag>
          <Tag>{methodLabel(request.method)}</Tag>
        </Space>
        <Typography.Text strong style={{ fontSize: 16 }}>{formatUZS(request.amount)}</Typography.Text>
      </Space>

      <div style={{ marginTop: 8 }}>
        {request.items.map((item) => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>{item.product.sku}</span>
            <Typography.Text type="secondary">
              {qtyText(item.qty)} {item.product.unit} × {formatUZS(item.price)} = {formatUZS(item.lineTotal)}
            </Typography.Text>
          </div>
        ))}
      </div>

      {request.note && <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>{request.note}</Typography.Paragraph>}

      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
        {request.createdBy.fullName}, {dayjs(request.createdAt).format('DD.MM.YYYY HH:mm')}
        {request.decidedBy && request.decidedAt && (
          <> · решил(а) {request.decidedBy.fullName}, {dayjs(request.decidedAt).format('DD.MM.YYYY HH:mm')}</>
        )}
        {request.paidAt && <> · дата оплаты {dayjs(request.paidAt).format('DD.MM.YYYY')}</>}
      </Typography.Paragraph>
      {request.decisionNote && (
        <Typography.Paragraph type={request.status === 'REJECTED' ? 'danger' : 'secondary'} style={{ marginTop: 4, marginBottom: 0 }}>
          {request.decisionNote}
        </Typography.Paragraph>
      )}

      {request.payments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Оплата на сделках: </Typography.Text>
          {request.payments.map((p, idx) => (
            <span key={p.id} style={{ fontSize: 12 }}>
              {idx > 0 && ', '}
              <Link to={`/deals/${p.deal.id}`}>{p.deal.title}</Link> ({formatUZS(p.amount)})
            </span>
          ))}
        </div>
      )}

      {isPending && (canDecide || request.createdBy.id === currentUserId) && (
        <Space wrap style={{ marginTop: 12 }}>
          {canDecide && <Button type="primary" onClick={onAccept}>Принять оплату</Button>}
          {canDecide && <Button danger onClick={onReject}>Отклонить</Button>}
          {request.createdBy.id === currentUserId && (
            <Popconfirm title="Отозвать заявку?" okText="Отозвать" cancelText="Нет" onConfirm={() => cancelMut.mutate()}>
              <Button loading={cancelMut.isPending}>Отозвать</Button>
            </Popconfirm>
          )}
        </Space>
      )}
    </Card>
  );
}

export default function PaymentRequestsPage() {
  const user = useAuthStore((s) => s.user);
  const canDecide = userHasRole(user, 'SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT');
  const [status, setStatus] = useState<PaymentRequestStatus>('PENDING');
  const [creating, setCreating] = useState(false);
  const [accepting, setAccepting] = useState<PaymentRequest | null>(null);
  const [rejecting, setRejecting] = useState<PaymentRequest | null>(null);

  const { data: requests, isLoading } = useQuery({
    queryKey: ['payment-requests', status],
    queryFn: () => paymentRequestsApi.list(status),
    refetchInterval: 60_000,
  });

  return (
    <div>
      <BackButton />
      <Space wrap style={{ justifyContent: 'space-between', width: '100%', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Заявки на оплату</Typography.Title>
          <Typography.Text type="secondary">
            Менеджер собирает товары за период, бухгалтер принимает оплату. Сделки не меняются.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Новая заявка</Button>
      </Space>

      <Segmented
        style={{ marginBottom: 16, maxWidth: '100%', overflowX: 'auto' }}
        value={status}
        onChange={(v) => setStatus(v as PaymentRequestStatus)}
        options={[
          { label: 'На рассмотрении', value: 'PENDING' },
          { label: 'Принятые', value: 'ACCEPTED' },
          { label: 'Отклонённые', value: 'REJECTED' },
          { label: 'Отозванные', value: 'CANCELED' },
        ]}
      />

      {isLoading ? <Skeleton active /> : !requests?.length ? (
        <Empty description="Заявок нет" />
      ) : requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          canDecide={canDecide}
          currentUserId={user?.id}
          onAccept={() => setAccepting(request)}
          onReject={() => setRejecting(request)}
        />
      ))}

      <NewRequestModal open={creating} onClose={() => setCreating(false)} />
      {accepting && <AcceptModal request={accepting} onClose={() => setAccepting(null)} />}
      {rejecting && <RejectModal request={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}
