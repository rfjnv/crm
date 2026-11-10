import { useState, useMemo, useEffect } from 'react';
import {
  Tabs, Form, Input, InputNumber, Select, DatePicker, Button, Alert,
  Typography, Popconfirm, message, Tooltip, Switch,
} from 'antd';
import { PlusOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, type OverrideDealData } from '../api/admin.api';
import { moneyFormatter, moneyParser, formatUZS } from '../utils/currency';
import { smartFilterOption, matchesSearch } from '../utils/translit';
import { findItemMissingRollCount } from '../utils/lamination';
import { useIsMobile } from '../hooks/useIsMobile';
import { mobileMainContentBottomPadding } from '../config/mobileBottomNav';
import DealStatusTag from './DealStatusTag';
import { ClientCompanyDisplay } from './ClientCompanyDisplay';
import type { Deal, Product, DealStatus, User, PaymentRecord, DealComment } from '../types';
import { getFirstName } from '../lib/name-utils';
import dayjs from 'dayjs';
import './SuperOverridePanel.css';

const ALL_STATUSES: DealStatus[] = [
  'NEW', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED', 'IN_PROGRESS',
  'WAITING_FINANCE', 'FINANCE_APPROVED', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT',
  'SHIPMENT_ON_HOLD',
  'WAITING_WAREHOUSE_MANAGER', 'PENDING_ADMIN', 'READY_FOR_LOADING',
  'LOADING_ASSIGNED', 'READY_FOR_DELIVERY', 'IN_DELIVERY',
  'CLOSED', 'CANCELED', 'REJECTED',
];

const PAYMENT_METHOD_OPTIONS = [
  { label: 'Наличные', value: 'CASH' },
  { label: 'Payme', value: 'PAYME' },
  { label: 'QR', value: 'QR' },
  { label: 'Click', value: 'CLICK' },
  { label: 'Терминал', value: 'TERMINAL' },
  { label: 'Перечисление', value: 'TRANSFER' },
  { label: 'Рассрочка', value: 'INSTALLMENT' },
  { label: 'Долг', value: 'DEBT' },
];
const PAYMENT_METHOD_LABELS: Record<string, string> = Object.fromEntries(PAYMENT_METHOD_OPTIONS.map((o) => [o.value, o.label]));

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'суперадмин', ADMIN: 'админ', MANAGER: 'менеджер', ACCOUNTANT: 'бухгалтер',
  WAREHOUSE: 'склад', WAREHOUSE_MANAGER: 'зав. склада', OPERATOR: 'оператор',
  DRIVER: 'водитель', LOADER: 'грузчик', HR: 'HR',
};

export interface SuperOverridePanelProps {
  deal: Deal;
  payments: PaymentRecord[];
  products: Product[];
  users: User[];
  clients: { id: string; companyName: string; contactName?: string | null; phone?: string | null; isSvip?: boolean }[];
  onCancel: () => void;
  onSuccess: () => void;
  /** «modal» — кнопки прилипают к низу окна; «page» — к низу экрана поверх страницы */
  variant?: 'modal' | 'page';
}

interface OverrideItem {
  key: string;
  id?: string;
  productId: string;
  requestedQty?: number;
  price?: number;
  rollCount?: number;
  requestComment?: string;
  warehouseComment?: string;
  dealDate?: dayjs.Dayjs;
  confirmedAt?: dayjs.Dayjs;
  createdAt?: dayjs.Dayjs;
  shippedAt?: dayjs.Dayjs;
  deliveredAt?: dayjs.Dayjs;
}

interface OverridePayment {
  id: string;
  paidAt?: dayjs.Dayjs;
  createdAt?: dayjs.Dayjs;
}

interface OverrideComment {
  id: string;
  text: string;
  createdAt?: dayjs.Dayjs;
}

let nextKey = 0;

export default function SuperOverridePanel({
  deal,
  payments,
  products,
  users,
  clients,
  onCancel,
  onSuccess,
  variant = 'page',
}: SuperOverridePanelProps) {
  const [form] = Form.useForm();
  const [shipmentForm] = Form.useForm();
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<OverrideItem[]>([]);
  const [paymentDates, setPaymentDates] = useState<OverridePayment[]>([]);
  const [commentDates, setCommentDates] = useState<OverrideComment[]>([]);
  const [editItems, setEditItems] = useState(false);
  const [editShipment, setEditShipment] = useState(false);
  const [showItemDates, setShowItemDates] = useState(false);
  const [reasonTouched, setReasonTouched] = useState(false);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!deal) return;
    setReason('');
    setEditItems(false);
    setEditShipment(false);

    form.setFieldsValue({
      title: deal.title,
      status: deal.status,
      clientId: deal.clientId,
      managerId: deal.managerId,
      paymentMethod: deal.paymentMethod || undefined,
      paymentType: deal.paymentType,
      paidAmount: Number(deal.paidAmount),
      discount: Number(deal.discount || 0),
      dueDate: deal.dueDate ? dayjs(deal.dueDate) : undefined,
      createdAt: deal.createdAt ? dayjs(deal.createdAt) : undefined,
      closedAt: deal.closedAt ? dayjs(deal.closedAt) : undefined,
      terms: deal.terms || '',
      deliveryType: deal.deliveryType || undefined,
      vehicleNumber: deal.vehicleNumber || '',
      vehicleType: deal.vehicleType || '',
      deliveryComment: deal.deliveryComment || '',
      loadingAssigneeId: deal.loadingAssigneeId || undefined,
      deliveryDriverId: deal.deliveryDriverId || undefined,
    });

    const dealItems: OverrideItem[] = (deal.items ?? []).map((i) => ({
      key: `oi-${nextKey++}`,
      id: i.id,
      productId: i.productId,
      requestedQty: i.requestedQty != null ? Number(i.requestedQty) : undefined,
      price: i.price != null ? Number(i.price) : undefined,
      rollCount: i.rollCount != null ? Number(i.rollCount) : undefined,
      requestComment: i.requestComment || undefined,
      warehouseComment: i.warehouseComment || undefined,
      dealDate: i.dealDate ? dayjs(i.dealDate) : undefined,
      confirmedAt: i.confirmedAt ? dayjs(i.confirmedAt) : undefined,
      createdAt: i.createdAt ? dayjs(i.createdAt) : undefined,
      shippedAt: i.shippedAt ? dayjs(i.shippedAt) : undefined,
      deliveredAt: i.deliveredAt ? dayjs(i.deliveredAt) : undefined,
    }));
    setItems(dealItems);

    setPaymentDates(
      (payments ?? []).map((payment) => ({
        id: payment.id,
        paidAt: payment.paidAt ? dayjs(payment.paidAt) : undefined,
        createdAt: payment.createdAt ? dayjs(payment.createdAt) : undefined,
      })),
    );

    setCommentDates(
      ((deal.comments ?? []) as DealComment[]).map((comment) => ({
        id: comment.id,
        text: comment.text,
        createdAt: comment.createdAt ? dayjs(comment.createdAt) : undefined,
      })),
    );

    if (deal.shipment) {
      setEditShipment(true);
      shipmentForm.setFieldsValue({
        vehicleType: deal.shipment.vehicleType,
        vehicleNumber: deal.shipment.vehicleNumber,
        driverName: deal.shipment.driverName,
        departureTime: dayjs(deal.shipment.departureTime),
        shippedAt: deal.shipment.shippedAt ? dayjs(deal.shipment.shippedAt) : undefined,
        deliveryNoteNumber: deal.shipment.deliveryNoteNumber,
        shipmentComment: deal.shipment.shipmentComment || '',
      });
    } else {
      shipmentForm.resetFields();
    }
  }, [deal, payments, form, shipmentForm]);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    (products ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const overrideMut = useMutation({
    mutationFn: (data: OverrideDealData) => adminApi.overrideDeal(deal.id, data),
    onSuccess: () => {
      message.success('Сделка обновлена');
      queryClient.invalidateQueries({ queryKey: ['deal', deal.id] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка override';
      message.error(msg);
    },
  });

  function handleSubmit() {
    if (reason.trim().length < 3) {
      setReasonTouched(true);
      message.error('Укажите причину изменения (мин. 3 символа)');
      return;
    }

    form.validateFields().then((values) => {
      const data: OverrideDealData = { reason: reason.trim() };

      if (values.title !== deal.title) data.title = values.title;
      if (values.status !== deal.status) data.status = values.status;
      if (values.clientId !== deal.clientId) data.clientId = values.clientId;
      if (values.managerId !== deal.managerId) data.managerId = values.managerId;
      // contractId намеренно НЕ передаётся: в форме нет Form.Item для него,
      // и setFieldsValue ранее хранил его в store — validateFields мог вернуть null
      // (AntD хранит undefined как null для незарегистрированных полей), что
      // отправляло contractId: null и откреплял договор. Теперь contractId
      // не попадает в store и никогда не трогается при override.
      // Read payment fields via getFieldValue to get store value even if "Оплата" tab was never visited.
      // validateFields() only returns mounted Form.Item values; unvisited tabs are lazy-rendered and may
      // return undefined, causing silent field resets (e.g. paymentMethod → null → contract card gone).
      const fPaymentMethod = form.getFieldValue('paymentMethod');
      if ((fPaymentMethod || null) !== (deal.paymentMethod || null)) data.paymentMethod = fPaymentMethod || null;
      const fPaymentType = form.getFieldValue('paymentType');
      if (fPaymentType !== deal.paymentType) data.paymentType = fPaymentType;
      const fPaidAmount = form.getFieldValue('paidAmount');
      if (fPaidAmount !== Number(deal.paidAmount)) data.paidAmount = fPaidAmount;
      const fDiscount = form.getFieldValue('discount');
      if (fDiscount !== Number(deal.discount || 0)) data.discount = fDiscount;
      const fTerms = form.getFieldValue('terms');
      if ((fTerms ?? '') !== (deal.terms || '')) data.terms = fTerms || null;

      if ((values.deliveryType || null) !== (deal.deliveryType || null)) data.deliveryType = values.deliveryType || null;
      if ((values.vehicleNumber || '') !== (deal.vehicleNumber || '')) data.vehicleNumber = values.vehicleNumber || null;
      if ((values.vehicleType || '') !== (deal.vehicleType || '')) data.vehicleType = values.vehicleType || null;
      if ((values.deliveryComment || '') !== (deal.deliveryComment || '')) data.deliveryComment = values.deliveryComment || null;
      if ((values.loadingAssigneeId || null) !== (deal.loadingAssigneeId || null)) data.loadingAssigneeId = values.loadingAssigneeId || null;
      if ((values.deliveryDriverId || null) !== (deal.deliveryDriverId || null)) data.deliveryDriverId = values.deliveryDriverId || null;

      const fDueDate = form.getFieldValue('dueDate');
      const formDueDate = fDueDate ? fDueDate.toISOString() : null;
      const dealDueDate = deal.dueDate ? dayjs(deal.dueDate).toISOString() : null;
      if (formDueDate !== dealDueDate) data.dueDate = formDueDate;

      const formCreatedAt = values.createdAt ? values.createdAt.toISOString() : null;
      const dealCreatedAt = deal.createdAt ? dayjs(deal.createdAt).toISOString() : null;
      if (formCreatedAt !== dealCreatedAt) data.createdAt = formCreatedAt;

      const formClosedAt = values.closedAt ? values.closedAt.toISOString() : null;
      const dealClosedAt = deal.closedAt ? dayjs(deal.closedAt).toISOString() : null;
      if (formClosedAt !== dealClosedAt) data.closedAt = formClosedAt;

      const hasItemDateChanges = items.some((item) => {
        const original = deal.items?.find((entry) => entry.id === item.id);
        return (
          (item.dealDate ? item.dealDate.toISOString() : null) !== (original?.dealDate ? dayjs(original.dealDate).toISOString() : null)
          || (item.confirmedAt ? item.confirmedAt.toISOString() : null) !== (original?.confirmedAt ? dayjs(original.confirmedAt).toISOString() : null)
          || (item.createdAt ? item.createdAt.toISOString() : null) !== (original?.createdAt ? dayjs(original.createdAt).toISOString() : null)
          || (item.shippedAt ? item.shippedAt.toISOString() : null) !== (original?.shippedAt ? dayjs(original.shippedAt).toISOString() : null)
          || (item.deliveredAt ? item.deliveredAt.toISOString() : null) !== (original?.deliveredAt ? dayjs(original.deliveredAt).toISOString() : null)
        );
      });

      if (editItems || hasItemDateChanges) {
        // Замена товара на рулонный без указания рулонов пересчитывала килограммы, но не рулоны —
        // остаток на складе молча расходился с фактом. Проверяем только когда позиции реально
        // уходят в запрос: у сделки правкой одних дат легаси-позиция без рулонов блокироваться
        // не должна. Бэкенд страхует тем же правилом.
        const missingRolls = findItemMissingRollCount(items, productMap);
        if (missingRolls) {
          message.error(`Укажите кол-во рулонов для "${missingRolls.productName}"`);
          return;
        }

        data.items = items
          .filter((i) => i.productId)
          .map((i) => ({
            id: i.id,
            productId: i.productId,
            requestedQty: i.requestedQty,
            price: i.price,
            rollCount: i.rollCount ?? null,
            requestComment: i.requestComment,
            warehouseComment: i.warehouseComment,
            dealDate: i.dealDate ? i.dealDate.toISOString() : null,
            confirmedAt: i.confirmedAt ? i.confirmedAt.toISOString() : null,
            createdAt: i.createdAt ? i.createdAt.toISOString() : null,
            shippedAt: i.shippedAt ? i.shippedAt.toISOString() : null,
            deliveredAt: i.deliveredAt ? i.deliveredAt.toISOString() : null,
          }));
      }

      const changedPayments = paymentDates
        .map((payment) => {
          const original = payments.find((entry) => entry.id === payment.id);
          const paidAt = payment.paidAt ? payment.paidAt.toISOString() : null;
          const createdAt = payment.createdAt ? payment.createdAt.toISOString() : null;
          const originalPaidAt = original?.paidAt ? dayjs(original.paidAt).toISOString() : null;
          const originalCreatedAt = original?.createdAt ? dayjs(original.createdAt).toISOString() : null;
          if (paidAt === originalPaidAt && createdAt === originalCreatedAt) return null;
          return { id: payment.id, paidAt, createdAt };
        })
        .filter((entry): entry is NonNullable<typeof entry> => !!entry);
      if (changedPayments.length > 0) data.payments = changedPayments;

      const changedComments = commentDates
        .map((comment) => {
          const original = deal.comments?.find((entry) => entry.id === comment.id);
          const createdAt = comment.createdAt ? comment.createdAt.toISOString() : null;
          const originalCreatedAt = original?.createdAt ? dayjs(original.createdAt).toISOString() : null;
          if (createdAt === originalCreatedAt) return null;
          return { id: comment.id, createdAt };
        })
        .filter((entry): entry is NonNullable<typeof entry> => !!entry);
      if (changedComments.length > 0) data.comments = changedComments;

      if (editShipment && !deal.shipment) {
        shipmentForm.validateFields().then((sv) => {
          data.shipment = {
            vehicleType: sv.vehicleType,
            vehicleNumber: sv.vehicleNumber,
            driverName: sv.driverName,
            departureTime: sv.departureTime.toISOString(),
            shippedAt: sv.shippedAt ? sv.shippedAt.toISOString() : null,
            deliveryNoteNumber: sv.deliveryNoteNumber,
            shipmentComment: sv.shipmentComment || undefined,
          };
          overrideMut.mutate(data);
        }).catch(() => message.error('Заполните все поля отгрузки'));
        return;
      } else if (editShipment && deal.shipment) {
        const sv = shipmentForm.getFieldsValue();
        if (sv.vehicleType && sv.vehicleNumber && sv.driverName && sv.departureTime && sv.deliveryNoteNumber) {
          data.shipment = {
            vehicleType: sv.vehicleType,
            vehicleNumber: sv.vehicleNumber,
            driverName: sv.driverName,
            departureTime: sv.departureTime.toISOString(),
            shippedAt: sv.shippedAt ? sv.shippedAt.toISOString() : null,
            deliveryNoteNumber: sv.deliveryNoteNumber,
            shipmentComment: sv.shipmentComment || undefined,
          };
        }
      }

      overrideMut.mutate(data);
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { key: `oi-${nextKey++}`, productId: '' }]);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  function updateItem(key: string, patch: Partial<OverrideItem>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function updatePaymentDate(id: string, patch: Partial<OverridePayment>) {
    setPaymentDates((prev) => prev.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)));
  }

  function updateCommentDate(id: string, patch: Partial<OverrideComment>) {
    setCommentDates((prev) => prev.map((comment) => (comment.id === id ? { ...comment, ...patch } : comment)));
  }

  const itemsTotal = useMemo(() =>
    items.reduce((s, i) => s + (i.requestedQty || 0) * (i.price || 0), 0),
    [items]);

  const footerBottomPad = isMobile ? mobileMainContentBottomPadding() : 12;

  const itemDateFields: { key: 'dealDate' | 'confirmedAt' | 'createdAt' | 'shippedAt' | 'deliveredAt'; label: string; hint: string }[] = [
    { key: 'dealDate', label: 'Дата строки', hint: 'По ней строка попадает в выручку и отчёты' },
    { key: 'confirmedAt', label: 'Подтверждено складом', hint: 'Когда склад подтвердил наличие' },
    { key: 'createdAt', label: 'Добавлено в сделку', hint: 'Когда строку создали' },
    { key: 'shippedAt', label: 'Отгружено', hint: 'Когда товар отгрузили' },
    { key: 'deliveredAt', label: 'Доставлено', hint: 'Когда товар доставили' },
  ];

  const dateInput = (value: dayjs.Dayjs | undefined, onChange: (v: dayjs.Dayjs | undefined) => void, allowClear = true) => (
    <DatePicker
      showTime
      allowClear={allowClear}
      style={{ width: '100%' }}
      format="DD.MM.YYYY HH:mm"
      value={value}
      onChange={(v) => onChange(v ?? undefined)}
    />
  );

  const userOptions = (roles?: string[]) => (users ?? [])
    .filter((u) => u.isActive && (!roles || roles.includes(u.role)))
    .map((u) => ({ label: roles?.length === 1 ? getFirstName(u.fullName) : `${getFirstName(u.fullName)} · ${ROLE_LABELS[u.role] ?? u.role}`, value: u.id }));

  const itemsTab = !editItems ? (
    <div className="so-empty">
      <Typography.Text type="secondary">
        Сохранение товаров полностью заменит текущий список позиций сделки.
      </Typography.Text>
      <Button type="primary" onClick={() => setEditItems(true)}>
        Редактировать товары
      </Button>
    </div>
  ) : (
    <>
      <div className="so-items-bar">
        <label className="so-switch">
          <Switch size="small" checked={showItemDates} onChange={setShowItemDates} />
          Даты по строкам
        </label>
        <span className="so-items-total">Итого: <b>{formatUZS(itemsTotal)}</b></span>
      </div>
      {!isMobile && (
        <div className="so-item-grid so-item-grid--head">
          <span>Товар</span>
          <span>Кол-во</span>
          <span>Рулоны</span>
          <span>Цена</span>
          <span className="so-num">Сумма</span>
          <span />
        </div>
      )}
      {items.map((item) => {
        const lineTotal = (item.requestedQty || 0) * (item.price || 0);
        return (
          <div key={item.key} className="so-item">
            <div className="so-item-grid">
              <Select
                showSearch
                filterOption={smartFilterOption}
                placeholder="Товар"
                className="so-item__product"
                value={item.productId || undefined}
                onChange={(v) => {
                  const p = productMap.get(v);
                  updateItem(item.key, {
                    productId: v,
                    price: p?.salePrice ? Number(p.salePrice) : item.price,
                  });
                }}
                options={(products ?? []).filter((p) => p.isActive).map((p) => ({
                  label: `${p.name} (${p.sku})`,
                  value: p.id,
                }))}
              />
              <InputNumber
                min={0.001}
                step={1}
                placeholder={isMobile ? 'Кол-во' : undefined}
                style={{ width: '100%' }}
                value={item.requestedQty}
                onChange={(v) => updateItem(item.key, { requestedQty: v ?? undefined })}
              />
              <InputNumber
                min={0}
                step={1}
                placeholder={isMobile ? 'Рулоны' : '—'}
                style={{ width: '100%' }}
                value={item.rollCount}
                onChange={(v) => updateItem(item.key, { rollCount: v ?? undefined })}
              />
              <InputNumber
                min={0}
                placeholder={isMobile ? 'Цена' : undefined}
                style={{ width: '100%' }}
                formatter={moneyFormatter}
                parser={(v) => moneyParser(v) as unknown as number}
                value={item.price}
                onChange={(v) => updateItem(item.key, { price: v ?? undefined })}
              />
              <span className="so-num so-item__sum">{lineTotal > 0 ? formatUZS(lineTotal) : '—'}</span>
              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeItem(item.key)} aria-label="Удалить строку" />
            </div>
            {showItemDates && (
              <div className="so-item-dates">
                {itemDateFields.map((f) => (
                  <div key={f.key}>
                    <Tooltip title={f.hint}><span className="so-label">{f.label}</span></Tooltip>
                    {dateInput(item[f.key], (v) => updateItem(item.key, { [f.key]: v }))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Button type="dashed" block icon={<PlusOutlined />} onClick={addItem} style={{ marginTop: 10 }}>
        Добавить товар
      </Button>
    </>
  );

  const footer = (
    <div className={`so-footer so-footer--${variant}`} style={variant === 'page' ? { paddingBottom: footerBottomPad } : undefined}>
      <Input
        className="so-footer__reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Причина изменения — обязательно, попадёт в аудит"
        status={reasonTouched && reason.trim().length < 3 ? 'error' : undefined}
      />
      <div className="so-footer__actions">
        <Button onClick={onCancel}>Отмена</Button>
        <Popconfirm
          title="Применить изменения?"
          description="Они обойдут обычный порядок работы и будут записаны в аудит."
          okText="Применить"
          cancelText="Нет"
          onConfirm={handleSubmit}
        >
          <Button type="primary" danger loading={overrideMut.isPending}>
            Применить
          </Button>
        </Popconfirm>
      </div>
    </div>
  );

  return (
    <div className={`so-panel so-panel--${variant}`}>
      <Alert
        type="warning"
        showIcon
        className="so-alert"
        message="Изменения обходят обычный порядок работы со сделкой и записываются в аудит вместе с причиной."
      />

      <Tabs
        className="so-tabs"
        items={[
          {
            key: 'basic',
            label: 'Основное',
            forceRender: true,
            children: (
              <Form form={form} layout="vertical" className="so-form">
                <div className="so-grid">
                  <Form.Item name="title" label="Название">
                    <Input />
                  </Form.Item>
                  <Form.Item name="status" label="Статус">
                    <Select>
                      {ALL_STATUSES.map((s) => (
                        <Select.Option key={s} value={s}>
                          <DealStatusTag status={s} />
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item name="clientId" label="Клиент">
                    <Select
                      showSearch
                      options={clients.map((c) => ({
                        value: c.id,
                        label: <ClientCompanyDisplay client={c} />,
                      }))}
                      filterOption={(input, option) => {
                        const c = clients.find((x) => x.id === option?.value);
                        if (!c) return false;
                        return matchesSearch(`${c.companyName || ''} ${c.contactName || ''} ${c.phone || ''}`, input);
                      }}
                    />
                  </Form.Item>
                  <Form.Item name="managerId" label="Менеджер">
                    <Select showSearch filterOption={smartFilterOption} options={userOptions()} />
                  </Form.Item>
                  <Form.Item name="createdAt" label="Дата создания сделки">
                    <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
                  </Form.Item>
                  <Form.Item
                    name="closedAt"
                    label={
                      <span>
                        Дата закрытия
                        <Tooltip title="Момент статуса «Закрыто» (доставка клиенту). Не путать с датами по строкам товаров.">
                          <InfoCircleOutlined className="so-hint" />
                        </Tooltip>
                      </span>
                    }
                  >
                    <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" allowClear />
                  </Form.Item>
                </div>
              </Form>
            ),
          },
          {
            key: 'items',
            label: `Товары (${items.length})`,
            children: itemsTab,
          },
          {
            key: 'payment',
            label: `Оплата${paymentDates.length ? ` (${paymentDates.length})` : ''}`,
            forceRender: true,
            children: (
              <>
                <Form form={form} layout="vertical" className="so-form">
                  <div className="so-grid">
                    <Form.Item name="paymentMethod" label="Способ оплаты">
                      <Select allowClear placeholder="Не указан" options={PAYMENT_METHOD_OPTIONS} />
                    </Form.Item>
                    <Form.Item name="paymentType" label="Тип оплаты">
                      <Select options={[
                        { label: 'Полная', value: 'FULL' },
                        { label: 'Частичная', value: 'PARTIAL' },
                        { label: 'Рассрочка', value: 'INSTALLMENT' },
                      ]} />
                    </Form.Item>
                    <Form.Item name="paidAmount" label="Оплачено">
                      <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
                    </Form.Item>
                    <Form.Item name="discount" label="Скидка">
                      <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
                    </Form.Item>
                    <Form.Item name="dueDate" label="Срок оплаты">
                      <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
                    </Form.Item>
                    <Form.Item name="terms" label="Условия">
                      <Input placeholder="Условия оплаты..." />
                    </Form.Item>
                  </div>
                </Form>

                <div className="so-section">Даты оплат</div>
                {paymentDates.length === 0 ? (
                  <Typography.Text type="secondary">По сделке оплат нет.</Typography.Text>
                ) : (
                  <div className="so-rows">
                    {paymentDates.map((payment) => {
                      const original = payments.find((entry) => entry.id === payment.id);
                      return (
                        <div key={payment.id} className="so-row">
                          <div className="so-row__title">
                            <b>{original?.amount ? formatUZS(Number(original.amount)) : 'Оплата'}</b>
                            {original?.method && <span> · {PAYMENT_METHOD_LABELS[original.method] ?? original.method}</span>}
                          </div>
                          <div>
                            <span className="so-label">Дата оплаты</span>
                            {dateInput(payment.paidAt, (v) => updatePaymentDate(payment.id, { paidAt: v }))}
                          </div>
                          <div>
                            <span className="so-label">Внесена в CRM</span>
                            {dateInput(payment.createdAt, (v) => updatePaymentDate(payment.id, { createdAt: v }))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ),
          },
          {
            key: 'delivery',
            label: 'Доставка',
            // Поля доставки читаются при сохранении — вкладка должна быть отрисована,
            // даже если её не открывали, иначе пустые значения обнулили бы доставку.
            forceRender: true,
            children: (
              <>
                <Form form={form} layout="vertical" className="so-form">
                  <div className="so-grid">
                    <Form.Item name="deliveryType" label="Тип доставки">
                      <Select allowClear placeholder="Не указан" options={[
                        { label: 'Самовывоз', value: 'SELF_PICKUP' },
                        { label: 'Яндекс', value: 'YANDEX' },
                        { label: 'Доставка', value: 'DELIVERY' },
                      ]} />
                    </Form.Item>
                    <Form.Item name="deliveryComment" label="Комментарий доставки">
                      <Input placeholder="Комментарий..." />
                    </Form.Item>
                    <Form.Item name="vehicleType" label="Тип машины">
                      <Input placeholder="Газель, фура..." />
                    </Form.Item>
                    <Form.Item name="vehicleNumber" label="Номер машины">
                      <Input placeholder="01 A 123 AA" />
                    </Form.Item>
                    <Form.Item name="loadingAssigneeId" label="Грузил">
                      <Select allowClear showSearch filterOption={smartFilterOption} placeholder="Не назначен"
                        options={userOptions(['WAREHOUSE', 'DRIVER', 'LOADER'])}
                      />
                    </Form.Item>
                    <Form.Item name="deliveryDriverId" label="Водитель доставки">
                      <Select allowClear showSearch filterOption={smartFilterOption} placeholder="Не назначен"
                        options={userOptions(['DRIVER'])}
                      />
                    </Form.Item>
                  </div>
                </Form>

                <div className="so-section">Отгрузка по накладной</div>
                {!editShipment ? (
                  <div className="so-empty">
                    <Typography.Text type="secondary">
                      {deal.shipment ? 'Отгрузка оформлена.' : 'Отгрузка не оформлена.'}
                    </Typography.Text>
                    <Button onClick={() => setEditShipment(true)}>
                      {deal.shipment ? 'Редактировать отгрузку' : 'Добавить отгрузку'}
                    </Button>
                  </div>
                ) : (
                  <Form form={shipmentForm} layout="vertical" className="so-form">
                    <div className="so-grid">
                      <Form.Item name="deliveryNoteNumber" label="Номер накладной" rules={[{ required: true, message: 'Укажите номер' }]}>
                        <Input placeholder="Номер накладной" />
                      </Form.Item>
                      <Form.Item name="shippedAt" label="Дата отгрузки (по накладной)">
                        <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" allowClear />
                      </Form.Item>
                      <Form.Item name="vehicleType" label="Транспорт" rules={[{ required: true, message: 'Укажите транспорт' }]}>
                        <Input placeholder="Грузовик, фура..." />
                      </Form.Item>
                      <Form.Item name="vehicleNumber" label="Номер транспорта" rules={[{ required: true, message: 'Укажите номер' }]}>
                        <Input placeholder="01 A 123 AA" />
                      </Form.Item>
                      <Form.Item name="driverName" label="Водитель" rules={[{ required: true, message: 'Укажите водителя' }]}>
                        <Input placeholder="ФИО водителя" />
                      </Form.Item>
                      <Form.Item name="departureTime" label="Время отправления" rules={[{ required: true, message: 'Укажите время' }]}>
                        <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
                      </Form.Item>
                      <Form.Item name="shipmentComment" label="Комментарий" className="so-grid__wide">
                        <Input placeholder="Комментарий к отгрузке" />
                      </Form.Item>
                    </div>
                  </Form>
                )}
              </>
            ),
          },
          {
            key: 'comments',
            label: `Комментарии (${commentDates.length})`,
            children: commentDates.length === 0 ? (
              <Typography.Text type="secondary">Комментариев нет.</Typography.Text>
            ) : (
              <div className="so-rows">
                {commentDates.map((comment) => (
                  <div key={comment.id} className="so-row so-row--comment">
                    <div className="so-row__title">{comment.text || 'Комментарий'}</div>
                    <div>
                      <span className="so-label">Дата комментария</span>
                      {dateInput(comment.createdAt, (v) => updateCommentDate(comment.id, { createdAt: v }))}
                    </div>
                  </div>
                ))}
              </div>
            ),
          },
        ]}
      />

      {footer}
    </div>
  );
}
