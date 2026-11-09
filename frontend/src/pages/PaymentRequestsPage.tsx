import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, DatePicker, Empty, Image, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Skeleton,
  Space, Table, Tag, Typography, Upload, message,
} from 'antd';
import { CameraOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import BackButton from '../components/BackButton';
import DealStatusTag from '../components/DealStatusTag';
import { clientsApi } from '../api/clients.api';
import { productsApi } from '../api/products.api';
import {
  paymentRequestsApi,
  type AllocationSource,
  type PaymentRequest,
  type PaymentRequestProduct,
  type PaymentRequestStatus,
  type RecognizedRow,
  type RecognizedTable,
} from '../api/paymentRequests.api';
import { useAuthStore } from '../store/authStore';
import { userHasRole } from '../lib/roles';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { DealStatus, Product } from '../types';

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

/** Предел API для одного фото: около 3,75 МБ файла. */
const MAX_PHOTO_BYTES = 3_700_000;
const SENDABLE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Снимок с телефона часто больше предела: уменьшаем в браузере, цифры при этом остаются читаемыми. */
async function preparePhoto(file: Blob): Promise<Blob> {
  if (file.size <= MAX_PHOTO_BYTES && SENDABLE_PHOTO_TYPES.includes(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  for (const [side, quality] of [[3000, 0.9], [2400, 0.85], [1800, 0.8]] as const) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_PHOTO_BYTES) return blob;
  }
  throw new Error('too big');
}

const rowLabel = (r: RecognizedRow) => [r.category, r.format].filter(Boolean).join(' ');

interface DraftRow {
  product: PaymentRequestProduct;
  boughtQty: number;
  requestedQty: number;
  qty: number | null;
  price: number | null;
}

/** Кладёт строку с фото в заявку: в уже показанный товар или новой строкой. */
function applyRecognized(rows: DraftRow[], row: RecognizedRow, product: PaymentRequestProduct) {
  let target = rows.find((r) => r.product.id === product.id);
  if (!target) {
    target = { product, boughtQty: 0, requestedQty: 0, qty: null, price: null };
    rows.push(target);
  }
  target.qty = Number(((target.qty ?? 0) + row.qty).toFixed(3));
  if (row.price != null) target.price = row.price;
}

function NewRequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [clientId, setClientId] = useState<string>();
  const [period, setPeriod] = useState<[Dayjs, Dayjs] | null>(null);
  const [method, setMethod] = useState('TRANSFER');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [recognized, setRecognized] = useState<RecognizedTable | null>(null);
  const [unmatched, setUnmatched] = useState<RecognizedRow[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list, enabled: open });
  const { data: products } = useQuery<Product[]>({ queryKey: ['products'], queryFn: productsApi.list, enabled: open });

  const from = period?.[0].format('YYYY-MM-DD');
  const to = period?.[1].format('YYYY-MM-DD');
  const { data: available, isFetching } = useQuery({
    queryKey: ['payment-requests-available', clientId, from, to],
    queryFn: () => paymentRequestsApi.available(clientId!, from!, to!),
    enabled: open && !!clientId && !!from && !!to,
  });

  // Строки из сделок периода, поверх них то, что прочитано с фото.
  useEffect(() => {
    if (!available) return;
    const next: DraftRow[] = available.rows.map((r) => ({
      product: r.product,
      boughtQty: r.boughtQty,
      requestedQty: r.requestedQty,
      qty: null,
      price: r.price || null,
    }));
    for (const row of recognized?.rows ?? []) {
      if (row.product) applyRecognized(next, row, row.product);
    }
    // Заполненное с фото наверх: так его проще сверять со снимком.
    next.sort((x, y) => Number((y.qty ?? 0) > 0) - Number((x.qty ?? 0) > 0));
    setRows(next);
  }, [available, recognized]);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  const recognizeMut = useMutation({
    mutationFn: async (file: Blob) => {
      const photo = await preparePhoto(file);
      return { table: await paymentRequestsApi.recognize(photo), url: URL.createObjectURL(photo) };
    },
    onSuccess: ({ table, url }) => {
      setPhotoUrl(url);
      setRecognized(table);
      setUnmatched(table.rows.filter((r) => !r.product));
      if (table.period) setPeriod([dayjs(table.period.from), dayjs(table.period.to)]);
      if (table.method) setMethod(table.method);
    },
    onError: (err) => message.error(
      (err as Error).message === 'too big' ? 'Фото слишком большое, сделайте снимок поменьше' : errorText(err),
    ),
  });

  const reset = () => {
    setClientId(undefined);
    setPeriod(null);
    setMethod('TRANSFER');
    setNote('');
    setRows([]);
    setRecognized(null);
    setUnmatched([]);
    setPhotoUrl(null);
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
      okButtonProps={{ disabled: chosen.length === 0 || missingPrice || unmatched.length > 0, loading: createMut.isPending }}
      onOk={() => createMut.mutate()}
      destroyOnHidden
    >
      <div
        onPaste={(e) => {
          const image = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
          if (image && !recognizeMut.isPending) {
            e.preventDefault();
            recognizeMut.mutate(image);
          }
        }}
      >
      <Space wrap align="center" style={{ marginBottom: 12, width: '100%' }}>
        <Upload
          accept="image/*"
          showUploadList={false}
          disabled={recognizeMut.isPending}
          beforeUpload={(file) => { recognizeMut.mutate(file); return false; }}
        >
          <Button icon={<CameraOutlined />} loading={recognizeMut.isPending}>
            {recognizeMut.isPending ? 'Читаю фото…' : 'Заполнить по фото таблицы'}
          </Button>
        </Upload>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>или вставьте снимок: Ctrl+V</Typography.Text>
        {photoUrl && <Image src={photoUrl} alt="Фото таблицы" height={40} style={{ objectFit: 'cover' }} />}
      </Space>
      {recognized && (
        <Alert
          type={recognized.warnings.length > 0 ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 12 }}
          message={`С фото прочитано строк: ${recognized.rows.length}${recognized.periodText ? `, период ${recognized.periodText}` : ''}. Сверьте с фото перед отправкой.`}
          description={recognized.warnings.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {recognized.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          ) : undefined}
        />
      )}
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
          {unmatched.map((row, idx) => (
            <Alert
              key={`${rowLabel(row)}-${idx}`}
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              message={`С фото: ${rowLabel(row)}, ${qtyText(row.qty)}${row.price != null ? ` × ${formatUZS(row.price)}` : ''}. Какой это товар?`}
              description={(
                <Space wrap>
                  <Select
                    showSearch
                    aria-label={`Товар для строки ${rowLabel(row)}`}
                    placeholder="Выберите товар"
                    style={{ width: 300, maxWidth: '100%' }}
                    optionFilterProp="label"
                    value={null}
                    options={(row.candidates.length > 0 ? row.candidates : products ?? [])
                      .map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }))}
                    onChange={(id: string) => {
                      const p = [...row.candidates, ...(products ?? [])].find((x) => x.id === id);
                      if (!p) return;
                      setRows((rs) => {
                        const next = rs.map((r) => ({ ...r }));
                        applyRecognized(next, row, { id: p.id, name: p.name, sku: p.sku, unit: p.unit });
                        return next;
                      });
                      setUnmatched((list) => list.filter((r) => r !== row));
                    }}
                  />
                  <Button onClick={() => setUnmatched((list) => list.filter((r) => r !== row))}>Пропустить строку</Button>
                </Space>
              )}
            />
          ))}
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
      </div>
    </Modal>
  );
}

interface DealDraftLine {
  dealItemId: string;
  product: PaymentRequestProduct;
  qty: number;
  price: number;
  requestedQty: number;
  pay: number | null;
}

/**
 * Заявка по одной сделке, в том числе не закрытой: менеджер берёт часть количества
 * (например, 4 000 из 10 400 листов). Делить сделку не нужно, оплата ляжет только на неё.
 */
function DealRequestModal({ initialDealId, onClose }: { initialDealId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [clientId, setClientId] = useState<string>();
  const [dealId, setDealId] = useState<string | undefined>(initialDealId);
  const [method, setMethod] = useState('TRANSFER');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DealDraftLine[]>([]);

  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list });
  const { data: deals, isFetching: dealsLoading } = useQuery({
    queryKey: ['payment-requests-deals', clientId],
    queryFn: () => paymentRequestsApi.deals(clientId!),
    enabled: !!clientId,
  });
  const { data: goods, isFetching: goodsLoading, error: goodsError } = useQuery({
    queryKey: ['payment-requests-deal', dealId],
    queryFn: () => paymentRequestsApi.dealGoods(dealId!),
    enabled: !!dealId,
    gcTime: 0,
  });

  useEffect(() => {
    if (!goods) return;
    if (!clientId) setClientId(goods.deal.client.id);
    setLines(goods.lines.map((l) => ({ ...l, pay: null })));
  }, [goods]); // eslint-disable-line react-hooks/exhaustive-deps

  const free = (l: DealDraftLine) => Math.max(0, Number((l.qty - l.requestedQty).toFixed(3)));
  const chosen = lines.filter((l) => (l.pay ?? 0) > 0);
  const total = Math.round(chosen.reduce((sum, l) => sum + (l.pay ?? 0) * l.price, 0) * 100) / 100;
  const debt = goods?.deal.debt ?? 0;
  const overDebt = total > debt + 0.001;
  const overQty = chosen.some((l) => (l.pay ?? 0) > free(l) + 1e-9);
  const setPay = (id: string, pay: number | null) =>
    setLines((ls) => ls.map((l) => (l.dealItemId === id ? { ...l, pay } : l)));

  const createMut = useMutation({
    mutationFn: () => paymentRequestsApi.create({
      clientId: goods!.deal.client.id,
      dealId: goods!.deal.id,
      method,
      note: note.trim() || undefined,
      items: chosen.map((l) => ({ productId: l.product.id, dealItemId: l.dealItemId, qty: l.pay!, price: l.price })),
    }),
    onSuccess: (created) => {
      message.success(`Заявка №${created.number} отправлена бухгалтеру`);
      qc.invalidateQueries({ queryKey: ['payment-requests'] });
      qc.invalidateQueries({ queryKey: ['payment-requests-summary'] });
      qc.removeQueries({ queryKey: ['payment-requests-deal'] });
      qc.removeQueries({ queryKey: ['payment-requests-deals'] });
      onClose();
    },
    onError: (err) => message.error(errorText(err)),
  });

  const columns = [
    {
      title: 'Товар',
      key: 'product',
      render: (_: unknown, l: DealDraftLine) => (
        <>
          <div>{l.product.sku}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{l.product.name}</Typography.Text>
        </>
      ),
    },
    {
      title: 'В сделке',
      key: 'qty',
      align: 'right' as const,
      width: 110,
      render: (_: unknown, l: DealDraftLine) => `${qtyText(l.qty)} ${l.product.unit}`,
    },
    {
      title: 'Уже в заявках',
      key: 'requested',
      align: 'right' as const,
      width: 110,
      render: (_: unknown, l: DealDraftLine) => (l.requestedQty > 0 ? qtyText(l.requestedQty) : '—'),
    },
    {
      title: 'К оплате',
      key: 'pay',
      width: 180,
      render: (_: unknown, l: DealDraftLine) => {
        const left = free(l);
        return (
          <Space.Compact style={{ width: '100%' }}>
            <InputNumber
              aria-label={`Количество к оплате, ${l.product.sku}`}
              min={0}
              max={left}
              disabled={left <= 0}
              placeholder={left > 0 ? `до ${qtyText(left)}` : 'всё в заявках'}
              value={l.pay}
              status={(l.pay ?? 0) > left ? 'error' : undefined}
              style={{ width: '100%' }}
              onChange={(v) => setPay(l.dealItemId, v)}
            />
            {left > 0 && <Button onClick={() => setPay(l.dealItemId, left)}>Всё</Button>}
          </Space.Compact>
        );
      },
    },
    {
      title: 'Цена',
      key: 'price',
      align: 'right' as const,
      width: 120,
      render: (_: unknown, l: DealDraftLine) => formatUZS(l.price),
    },
    {
      title: 'Сумма',
      key: 'sum',
      align: 'right' as const,
      width: 130,
      render: (_: unknown, l: DealDraftLine) => ((l.pay ?? 0) > 0 ? formatUZS((l.pay ?? 0) * l.price) : '—'),
    },
  ];

  return (
    <Modal
      open
      onCancel={onClose}
      title="Заявка на оплату по сделке"
      width={isMobile ? '100%' : 960}
      okText="Отправить бухгалтеру"
      cancelText="Отмена"
      okButtonProps={{ disabled: !goods || chosen.length === 0 || overDebt || overQty, loading: createMut.isPending }}
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
          onChange={(id: string) => { setClientId(id); setDealId(undefined); setLines([]); }}
        />
        <Select
          showSearch
          aria-label="Сделка"
          placeholder={clientId ? 'Сделка с долгом' : 'Сначала клиент'}
          style={{ width: 380, maxWidth: '100%' }}
          disabled={!clientId}
          loading={dealsLoading}
          value={dealId}
          optionFilterProp="label"
          notFoundContent="Нет сделок с долгом"
          options={[
            ...(goods && !deals?.some((d) => d.id === goods.deal.id)
              ? [{ value: goods.deal.id, label: `${goods.deal.title} · долг ${formatUZS(goods.deal.debt)}` }]
              : []),
            ...(deals ?? []).map((d) => ({
              value: d.id,
              label: `${d.title} · ${ruDate(d.date)} · долг ${formatUZS(d.debt)}`,
            })),
          ]}
          onChange={(id: string) => setDealId(id)}
        />
        <Select aria-label="Способ оплаты" style={{ width: 170 }} value={method} options={METHODS} onChange={setMethod} />
      </Space>

      {goodsError ? (
        <Alert type="error" showIcon message={errorText(goodsError)} />
      ) : !dealId ? (
        <Empty description="Выберите клиента и сделку: можно взять часть количества по каждому товару" />
      ) : goodsLoading || !goods ? (
        <Skeleton active />
      ) : (
        <>
          <Space wrap style={{ marginBottom: 8 }}>
            <Link to={`/deals/${goods.deal.id}`} target="_blank">{goods.deal.title}</Link>
            <DealStatusTag status={goods.deal.status as DealStatus} />
            <Typography.Text type="secondary">
              Сумма {formatUZS(goods.deal.amount)} · оплачено {formatUZS(goods.deal.paid)} · долг {formatUZS(goods.deal.debt)}
            </Typography.Text>
          </Space>
          {goods.deal.pendingAmount > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
              message={`По этой сделке уже ждут бухгалтера заявки на ${formatUZS(goods.deal.pendingAmount)}.`}
            />
          )}
          <Table
            size="small"
            rowKey={(l) => l.dealItemId}
            columns={columns}
            dataSource={lines}
            pagination={false}
            scroll={{ x: 760 }}
            locale={{ emptyText: 'В сделке нет позиций с количеством и ценой' }}
          />
          {overDebt && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 8 }}
              message={`Сумма больше долга по сделке (${formatUZS(debt)}). Уменьшите количество.`}
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
                title: request.deal ? 'В сделке' : 'Куплено за период',
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
              message={request.deal
                ? 'В заявке больше, чем в сделке. Проверьте распределение ниже.'
                : 'В заявке больше, чем куплено за период. Разница ляжет на другие долги клиента, см. ниже.'}
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
          {request.deal ? (
            <Typography.Text type="secondary">
              по сделке <Link to={`/deals/${request.deal.id}`}>{request.deal.title}</Link>
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">{ruDate(request.from)} — {ruDate(request.to)}</Typography.Text>
          )}
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
  const [searchParams, setSearchParams] = useSearchParams();
  // Из карточки сделки приходим с ?dealId=: сразу открываем заявку по этой сделке.
  const [dealRequest, setDealRequest] = useState<{ dealId?: string } | null>(
    () => (searchParams.get('dealId') ? { dealId: searchParams.get('dealId')! } : null),
  );
  const closeDealRequest = () => {
    setDealRequest(null);
    if (searchParams.has('dealId')) {
      searchParams.delete('dealId');
      setSearchParams(searchParams, { replace: true });
    }
  };
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
            Менеджер собирает товары по сделке или за период, бухгалтер принимает оплату. Сделки не меняются.
          </Typography.Text>
        </div>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDealRequest({})}>По сделке</Button>
          <Button icon={<PlusOutlined />} onClick={() => setCreating(true)}>За период</Button>
        </Space>
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
      {dealRequest && <DealRequestModal initialDealId={dealRequest.dealId} onClose={closeDealRequest} />}
      {accepting && <AcceptModal request={accepting} onClose={() => setAccepting(null)} />}
      {rejecting && <RejectModal request={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}
