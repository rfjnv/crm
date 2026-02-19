import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Descriptions, Typography, Spin, Timeline, Tag, Space, Input, Button,
  List, Table, message, InputNumber, Form, Modal, Popconfirm, DatePicker, Tabs,
  Select, Alert, Radio,
} from 'antd';
import {
  SendOutlined, PlusOutlined, DeleteOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ArrowRightOutlined, EditOutlined,
} from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { inventoryApi } from '../api/warehouse.api';
import { usersApi } from '../api/users.api';
import DealStatusTag from '../components/DealStatusTag';
import DealPipeline from '../components/DealPipeline';
import { useAuthStore } from '../store/authStore';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { DealStatus, Deal, DealItem, PaymentStatus, DealHistoryEntry, UserRole } from '../types';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [comment, setComment] = useState('');
  const [itemModal, setItemModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [warehouseResponseModal, setWarehouseResponseModal] = useState(false);
  const [setQuantitiesModal, setSetQuantitiesModal] = useState(false);
  const [shipmentModal, setShipmentModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [paymentRecordModal, setPaymentRecordModal] = useState(false);
  const [itemForm] = Form.useForm();
  const [paymentForm] = Form.useForm();
  const [paymentRecordForm] = Form.useForm();
  const [warehouseForm] = Form.useForm();
  const [quantitiesForm] = Form.useForm();
  const [shipmentForm] = Form.useForm();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = user?.role as UserRole | undefined;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['deal', id] });
    queryClient.invalidateQueries({ queryKey: ['deal-logs', id] });
    queryClient.invalidateQueries({ queryKey: ['deal-history', id] });
    queryClient.invalidateQueries({ queryKey: ['deal-payments', id] });
  };

  const { data: dealData, isLoading } = useQuery({
    queryKey: ['deal', id],
    queryFn: () => dealsApi.getById(id!),
    enabled: !!id,
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
    enabled: role === 'SUPER_ADMIN' || role === 'ADMIN',
  });

  const { data: history } = useQuery({
    queryKey: ['deal-history', id],
    queryFn: () => dealsApi.getHistory(id!),
    enabled: !!id,
  });

  const { data: dealPayments } = useQuery({
    queryKey: ['deal-payments', id],
    queryFn: () => dealsApi.getDealPayments(id!),
    enabled: !!id,
  });

  // ──── Mutations ────

  const statusMut = useMutation({
    mutationFn: (status: DealStatus) => dealsApi.update(id!, { status }),
    onMutate: async (newStatus: DealStatus) => {
      await queryClient.cancelQueries({ queryKey: ['deal', id] });
      const prev = queryClient.getQueryData<Deal>(['deal', id]);
      if (prev) {
        queryClient.setQueryData<Deal>(['deal', id], { ...prev, status: newStatus });
      }
      return { prev };
    },
    onError: (err: unknown, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['deal', id], context.prev);
      }
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка обновления статуса';
      message.error(msg);
    },
    onSettled: () => { invalidate(); },
    onSuccess: () => { message.success('Статус обновлён'); },
  });

  const commentMut = useMutation({
    mutationFn: (text: string) => dealsApi.addComment(id!, text),
    onSuccess: () => { invalidate(); setComment(''); message.success('Комментарий добавлен'); },
  });

  const addItemMut = useMutation({
    mutationFn: (data: { productId: string; requestComment?: string }) => dealsApi.addItem(id!, data),
    onSuccess: () => { invalidate(); setItemModal(false); itemForm.resetFields(); message.success('Товар добавлен'); },
    onError: () => message.error('Ошибка добавления товара'),
  });

  const removeItemMut = useMutation({
    mutationFn: (itemId: string) => dealsApi.removeItem(id!, itemId),
    onSuccess: () => { invalidate(); message.success('Товар удалён'); },
  });

  const paymentMut = useMutation({
    mutationFn: (data: { paidAmount: number; paymentType?: 'FULL' | 'PARTIAL' | 'DEBT'; dueDate?: string | null; terms?: string | null }) => dealsApi.updatePayment(id!, data),
    onSuccess: () => { invalidate(); setPaymentModal(false); message.success('Оплата обновлена'); },
    onError: () => message.error('Ошибка обновления оплаты'),
  });

  const warehouseResponseMut = useMutation({
    mutationFn: (items: { dealItemId: string; warehouseComment: string }[]) =>
      dealsApi.submitWarehouseResponse(id!, items),
    onSuccess: () => { invalidate(); setWarehouseResponseModal(false); warehouseForm.resetFields(); message.success('Ответ склада отправлен'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const setQuantitiesMut = useMutation({
    mutationFn: (data: {
      items: { dealItemId: string; requestedQty: number; price: number }[];
      discount?: number;
      paymentType?: 'FULL' | 'PARTIAL' | 'DEBT';
      paidAmount?: number;
      dueDate?: string;
      terms?: string;
    }) => dealsApi.setItemQuantities(id!, data),
    onSuccess: () => { invalidate(); setSetQuantitiesModal(false); quantitiesForm.resetFields(); message.success('Количества и цены установлены'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const financeApproveMut = useMutation({
    mutationFn: () => dealsApi.approveFinance(id!),
    onSuccess: () => { invalidate(); message.success('Финансы одобрены'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const financeRejectMut = useMutation({
    mutationFn: (reason: string) => dealsApi.rejectFinance(id!, reason),
    onSuccess: () => { invalidate(); setRejectModal(false); setRejectReason(''); message.success('Сделка отклонена'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const adminApproveMut = useMutation({
    mutationFn: () => dealsApi.approveAdmin(id!),
    onSuccess: () => { invalidate(); message.success('Админ одобрил'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const shipmentMut = useMutation({
    mutationFn: (data: { vehicleType: string; vehicleNumber: string; driverName: string; departureTime: string; deliveryNoteNumber: string; shipmentComment?: string }) =>
      dealsApi.submitShipment(id!, data),
    onSuccess: () => { invalidate(); setShipmentModal(false); shipmentForm.resetFields(); message.success('Отгрузка оформлена'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка оформления отгрузки';
      message.error(msg);
    },
  });

  const releaseHoldMut = useMutation({
    mutationFn: () => dealsApi.releaseShipmentHold(id!),
    onSuccess: () => { invalidate(); message.success('Сделка возвращена в очередь на отгрузку'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const managerMut = useMutation({
    mutationFn: (managerId: string) => dealsApi.update(id!, { managerId }),
    onSuccess: () => { invalidate(); message.success('Менеджер изменён'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка смены менеджера';
      message.error(msg);
    },
  });

  const paymentRecordMut = useMutation({
    mutationFn: (data: { amount: number; method?: string; note?: string; paidAt?: string }) =>
      dealsApi.createPayment(id!, data),
    onSuccess: () => { invalidate(); setPaymentRecordModal(false); paymentRecordForm.resetFields(); message.success('Платёж добавлен'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка добавления платежа';
      message.error(msg);
    },
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!dealData) return <Typography.Text>Сделка не найдена</Typography.Text>;
  const deal = dealData;

  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const isReadOnly = deal.status === 'CLOSED' || deal.status === 'CANCELED';
  const canEditItems = ['NEW', 'IN_PROGRESS'].includes(deal.status) && (isAdmin || role === 'MANAGER');
  const hasQuantities = (deal.items ?? []).some((i) => i.requestedQty != null);

  // ──── Role-based action buttons ────

  function renderWorkflowActions() {
    const actions: React.ReactNode[] = [];

    if (deal.status === 'NEW' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Button key="start" type="primary" icon={<ArrowRightOutlined />} loading={statusMut.isPending} onClick={() => statusMut.mutate('IN_PROGRESS')}>
          Взять в работу
        </Button>,
      );
    }

    if (deal.status === 'IN_PROGRESS' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Button key="stock-req" type="primary" icon={<ArrowRightOutlined />} loading={statusMut.isPending} onClick={() => statusMut.mutate('WAITING_STOCK_CONFIRMATION')}>
          Запросить ответ склада
        </Button>,
      );
    }

    if (deal.status === 'WAITING_STOCK_CONFIRMATION' && (isAdmin || role === 'WAREHOUSE' || role === 'WAREHOUSE_MANAGER')) {
      actions.push(
        <Button key="warehouse-response" type="primary" icon={<CheckCircleOutlined />} onClick={() => {
          const initialValues = (deal.items ?? []).map((item) => ({
            dealItemId: item.id,
            productName: item.product?.name || 'Товар',
            requestComment: item.requestComment || '',
            warehouseComment: '',
          }));
          warehouseForm.setFieldsValue({ items: initialValues });
          setWarehouseResponseModal(true);
        }}>
          Ответить
        </Button>,
      );
    }

    if (deal.status === 'STOCK_CONFIRMED' && (isAdmin || role === 'MANAGER') && !hasQuantities) {
      actions.push(
        <Button key="set-quantities" type="primary" icon={<EditOutlined />} onClick={() => {
          const initialValues = (deal.items ?? []).map((item) => ({
            dealItemId: item.id,
            productName: item.product?.name || 'Товар',
            unit: item.product?.unit || 'шт',
            warehouseComment: item.warehouseComment || '',
            requestedQty: Number(item.requestedQty) || 0,
            price: Number(item.price) || 0,
          }));
          quantitiesForm.setFieldsValue({ items: initialValues, discount: 0, paymentType: 'FULL', paidAmount: 0 });
          setSetQuantitiesModal(true);
        }}>
          Указать количества и цены
        </Button>,
      );
    }

    if (deal.status === 'STOCK_CONFIRMED' && (isAdmin || role === 'ACCOUNTANT') && hasQuantities) {
      actions.push(
        <Popconfirm key="fin-approve" title="Одобрить финансы?" onConfirm={() => financeApproveMut.mutate()}>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={financeApproveMut.isPending}>
            Одобрить финансы
          </Button>
        </Popconfirm>,
        <Button key="fin-reject" danger icon={<CloseCircleOutlined />} onClick={() => setRejectModal(true)}>
          Отклонить
        </Button>,
      );
    }

    if (deal.status === 'FINANCE_APPROVED' && isAdmin) {
      actions.push(
        <Popconfirm key="admin-approve" title="Одобрить сделку?" onConfirm={() => adminApproveMut.mutate()}>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={adminApproveMut.isPending}>
            Одобрить (Админ)
          </Button>
        </Popconfirm>,
      );
    }

    if (deal.status === 'ADMIN_APPROVED' && isAdmin) {
      actions.push(
        <Button key="ready-ship" type="primary" icon={<ArrowRightOutlined />} loading={statusMut.isPending} onClick={() => statusMut.mutate('READY_FOR_SHIPMENT')}>
          Готова к отгрузке
        </Button>,
      );
    }

    if (deal.status === 'READY_FOR_SHIPMENT' && (isAdmin || role === 'WAREHOUSE_MANAGER')) {
      actions.push(
        <Button key="ship" type="primary" icon={<CheckCircleOutlined />} onClick={() => setShipmentModal(true)}>
          Оформить отгрузку
        </Button>,
      );
    }

    if (deal.status === 'SHIPMENT_ON_HOLD' && (isAdmin || role === 'WAREHOUSE_MANAGER')) {
      actions.push(
        <Popconfirm key="release-hold" title="Вернуть сделку в очередь на отгрузку?" onConfirm={() => releaseHoldMut.mutate()}>
          <Button type="primary" icon={<ArrowRightOutlined />} loading={releaseHoldMut.isPending}>
            Вернуть в очередь
          </Button>
        </Popconfirm>,
      );
    }

    if (deal.status === 'SHIPPED' && isAdmin) {
      actions.push(
        <Popconfirm key="close" title="Закрыть сделку?" onConfirm={() => statusMut.mutate('CLOSED')}>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={statusMut.isPending}>
            Закрыть сделку
          </Button>
        </Popconfirm>,
      );
    }

    if (deal.status === 'REJECTED' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Button key="rework" type="primary" icon={<ArrowRightOutlined />} loading={statusMut.isPending} onClick={() => statusMut.mutate('IN_PROGRESS')}>
          Вернуть в работу
        </Button>,
      );
    }

    if (!isReadOnly && deal.status !== 'REJECTED' && deal.status !== 'SHIPPED' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Popconfirm key="cancel" title="Отменить сделку?" onConfirm={() => statusMut.mutate('CANCELED')}>
          <Button danger icon={<CloseCircleOutlined />} loading={statusMut.isPending}>
            Отменить
          </Button>
        </Popconfirm>,
      );
    }

    if (actions.length === 0) return null;

    return (
      <Card bordered={false} style={{ marginBottom: 16 }}>
        <Space wrap>{actions}</Space>
      </Card>
    );
  }

  // Build item columns dynamically based on deal state
  const itemColumns = [
    { title: 'Товар', dataIndex: ['product', 'name'] },
    { title: 'Артикул', dataIndex: ['product', 'sku'], render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Комментарий запроса', dataIndex: 'requestComment', render: (v: string | null) => v || '—' },
    ...(hasQuantities ? [
      { title: 'Кол-во', dataIndex: 'requestedQty', align: 'right' as const, width: 90, render: (v: number | null) => v != null ? Number(v) : '—' },
      { title: 'Ед.', dataIndex: ['product', 'unit'], width: 60 },
      { title: 'Цена', dataIndex: 'price', align: 'right' as const, render: (v: string | null) => v != null ? formatUZS(v) : '—' },
      { title: 'Сумма', key: 'total', align: 'right' as const, render: (_: unknown, r: DealItem) => r.requestedQty != null && r.price != null ? formatUZS(Number(r.price) * Number(r.requestedQty)) : '—' },
    ] : [
      { title: 'Ед.', dataIndex: ['product', 'unit'], width: 60 },
    ]),
    ...(deal.items?.some((i) => i.warehouseComment) ? [
      { title: 'Ответ склада', dataIndex: 'warehouseComment', render: (v: string | null) => v || '—' },
    ] : []),
    ...(canEditItems ? [{
      title: '', width: 50,
      render: (_: unknown, r: DealItem) => (
        <Popconfirm title="Удалить позицию?" onConfirm={() => removeItemMut.mutate(r.id)}>
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    }] : []),
  ];

  function renderWarehouseInfo() {
    const respondedItems = (deal.items ?? []).filter((i) => i.warehouseComment);
    if (respondedItems.length === 0) return null;
    const firstResponded = respondedItems[0];

    return (
      <Card title="Ответ склада" bordered={false}>
        <Table
          dataSource={respondedItems}
          rowKey="id"
          pagination={false}
          size="small"
          bordered={false}
          columns={[
            { title: 'Товар', dataIndex: ['product', 'name'] },
            { title: 'Комментарий запроса', dataIndex: 'requestComment', render: (v: string | null) => v || '—' },
            { title: 'Ответ склада', dataIndex: 'warehouseComment', render: (v: string | null) => v || '—' },
          ]}
        />
        {firstResponded?.confirmedAt && (
          <Typography.Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
            Ответ: {dayjs(firstResponded.confirmedAt).format('DD.MM.YYYY HH:mm')}
            {firstResponded?.confirmer && ` — ${firstResponded.confirmer.fullName}`}
          </Typography.Text>
        )}
      </Card>
    );
  }

  function renderShipment() {
    if (!deal.shipment) return null;

    return (
      <Card title="Отгрузка" bordered={false}>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="Тип транспорта">{deal.shipment.vehicleType}</Descriptions.Item>
          <Descriptions.Item label="Номер транспорта">{deal.shipment.vehicleNumber}</Descriptions.Item>
          <Descriptions.Item label="Водитель">{deal.shipment.driverName}</Descriptions.Item>
          <Descriptions.Item label="Время отправления">{dayjs(deal.shipment.departureTime).format('DD.MM.YYYY HH:mm')}</Descriptions.Item>
          <Descriptions.Item label="Номер накладной">{deal.shipment.deliveryNoteNumber}</Descriptions.Item>
          {deal.shipment.shipmentComment && (
            <Descriptions.Item label="Комментарий" span={2}>{deal.shipment.shipmentComment}</Descriptions.Item>
          )}
        </Descriptions>
        <Typography.Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
          Оформлено: {dayjs(deal.shipment.shippedAt).format('DD.MM.YYYY HH:mm')}
          {deal.shipment.user && ` — ${deal.shipment.user.fullName}`}
        </Typography.Text>
      </Card>
    );
  }

  return (
    <div>
      <Typography.Title level={4}>{deal.title}</Typography.Title>

      <Card bordered={false} style={{ marginBottom: 16 }}>
        <DealPipeline status={deal.status} />
      </Card>

      {renderWorkflowActions()}

      <Tabs
        defaultActiveKey="details"
        items={[
          {
            key: 'details',
            label: 'Детали',
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card bordered={false}>
                  <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                    <Descriptions.Item label="Клиент">
                      <Link to={`/clients/${deal.clientId}`}>{deal.client?.companyName}</Link>
                    </Descriptions.Item>
                    <Descriptions.Item label="Менеджер">
                      {isAdmin ? (
                        <Select
                          value={deal.managerId}
                          onChange={(val) => managerMut.mutate(val)}
                          loading={managerMut.isPending}
                          style={{ minWidth: 200 }}
                          showSearch
                          optionFilterProp="label"
                          options={(users ?? []).filter((u) => u.isActive && u.role === 'MANAGER').map((u) => ({ label: u.fullName, value: u.id }))}
                        />
                      ) : (
                        deal.manager?.fullName
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="Сумма">
                      {hasQuantities ? formatUZS(deal.amount) : <Typography.Text type="secondary">Не установлено</Typography.Text>}
                    </Descriptions.Item>
                    {deal.discount && Number(deal.discount) > 0 && (
                      <Descriptions.Item label="Скидка">{formatUZS(deal.discount)}</Descriptions.Item>
                    )}
                    <Descriptions.Item label="Создана">{dayjs(deal.createdAt).format('DD.MM.YYYY HH:mm')}</Descriptions.Item>
                    {deal.contract && (
                      <Descriptions.Item label="Договор">{deal.contract.contractNumber}</Descriptions.Item>
                    )}
                    <Descriptions.Item label="Статус">
                      <DealStatusTag status={deal.status} />
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                {hasQuantities && (
                  <Card
                    title="Оплата"
                    extra={
                      <Space>
                        {!isReadOnly && (isAdmin || role === 'MANAGER' || role === 'ACCOUNTANT') && (
                          <Button size="small" icon={<PlusOutlined />} onClick={() => setPaymentRecordModal(true)}>Добавить платёж</Button>
                        )}
                        {!isReadOnly && (isAdmin || role === 'MANAGER' || role === 'ACCOUNTANT') && (
                          <Button size="small" onClick={() => { paymentForm.setFieldsValue({ paidAmount: Number(deal.paidAmount), paymentType: deal.paymentType, dueDate: deal.dueDate ? dayjs(deal.dueDate) : null, terms: deal.terms || '' }); setPaymentModal(true); }}>Изменить</Button>
                        )}
                      </Space>
                    }
                    bordered={false}
                  >
                    <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                      <Descriptions.Item label="Тип">{deal.paymentType === 'FULL' ? 'Полная' : deal.paymentType === 'PARTIAL' ? 'Частичная' : 'В долг'}</Descriptions.Item>
                      <Descriptions.Item label="Статус оплаты">
                        <Tag color={paymentStatusLabels[deal.paymentStatus]?.color}>{paymentStatusLabels[deal.paymentStatus]?.label}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="Оплачено">{formatUZS(deal.paidAmount)} / {formatUZS(deal.amount)}</Descriptions.Item>
                      {Number(deal.amount) - Number(deal.discount || 0) - Number(deal.paidAmount) > 0 && (
                        <Descriptions.Item label="Долг">
                          <Typography.Text type="danger" strong>{formatUZS(Number(deal.amount) - Number(deal.discount || 0) - Number(deal.paidAmount))}</Typography.Text>
                        </Descriptions.Item>
                      )}
                      {deal.dueDate && (
                        <Descriptions.Item label="Срок оплаты">{dayjs(deal.dueDate).format('DD.MM.YYYY')}</Descriptions.Item>
                      )}
                      {deal.terms && (
                        <Descriptions.Item label="Условия" span={2}>{deal.terms}</Descriptions.Item>
                      )}
                    </Descriptions>

                    {(dealPayments ?? []).length > 0 && (
                      <Table
                        dataSource={dealPayments}
                        rowKey="id"
                        pagination={false}
                        size="small"
                        bordered={false}
                        style={{ marginTop: 16 }}
                        columns={[
                          { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
                          { title: 'Способ', dataIndex: 'method', render: (v: string | null) => v || '—' },
                          { title: 'Дата оплаты', dataIndex: 'paidAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm') },
                          { title: 'Кем внесено', dataIndex: ['creator', 'fullName'], render: (v: string) => v || '—' },
                          { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
                        ]}
                      />
                    )}
                  </Card>
                )}

                <Card title={`Товары (${deal.items?.length ?? 0})`} extra={canEditItems && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setItemModal(true)}>Добавить</Button>} bordered={false}>
                  <Table
                    dataSource={deal.items ?? []}
                    columns={itemColumns}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    bordered={false}
                    summary={() => {
                      if (!hasQuantities) return null;
                      const total = (deal.items ?? []).reduce((sum, item) => sum + Number(item.price ?? 0) * Number(item.requestedQty ?? 0), 0);
                      return total > 0 ? (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={itemColumns.length - 1}><Typography.Text strong>Итого</Typography.Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={1} align="right"><Typography.Text strong>{formatUZS(total)}</Typography.Text></Table.Summary.Cell>
                        </Table.Summary.Row>
                      ) : null;
                    }}
                  />
                </Card>

                {renderWarehouseInfo()}
                {renderShipment()}

                <Card title="Комментарии" bordered={false}>
                  <List
                    dataSource={deal.comments ?? []}
                    locale={{ emptyText: 'Нет комментариев' }}
                    renderItem={(item) => (
                      <List.Item>
                        <List.Item.Meta
                          title={
                            <Space>
                              <Typography.Text strong>{item.author?.fullName}</Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {dayjs(item.createdAt).format('DD.MM.YYYY HH:mm')}
                              </Typography.Text>
                            </Space>
                          }
                          description={item.text}
                        />
                      </List.Item>
                    )}
                  />
                  {!isReadOnly && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                      <Input
                        placeholder="Написать комментарий..."
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        onPressEnter={() => comment.trim() && commentMut.mutate(comment.trim())}
                      />
                      <Button type="primary" icon={<SendOutlined />} loading={commentMut.isPending} onClick={() => comment.trim() && commentMut.mutate(comment.trim())} />
                    </div>
                  )}
                </Card>
              </Space>
            ),
          },
          {
            key: 'history',
            label: 'История',
            children: (
              <Card bordered={false}>
                <Timeline
                  items={(history ?? []).map((entry: DealHistoryEntry) => {
                    if (entry.kind === 'audit') {
                      return {
                        color: entry.action === 'STATUS_CHANGE' ? 'blue' : entry.action === 'CREATE' ? 'green' : 'gray',
                        children: (
                          <div>
                            <Typography.Text strong>{entry.user?.fullName}</Typography.Text>{' '}
                            <Tag>{entry.action}</Tag>{' '}
                            <Typography.Text type="secondary">{dayjs(entry.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text>
                            {entry.action === 'STATUS_CHANGE' && entry.before && entry.after && (
                              <div style={{ marginTop: 4 }}>
                                <DealStatusTag status={entry.before.status as DealStatus} />{' → '}
                                <DealStatusTag status={entry.after.status as DealStatus} />
                              </div>
                            )}
                          </div>
                        ),
                      };
                    }
                    return {
                      color: entry.type === 'IN' ? 'green' : 'red',
                      children: (
                        <div>
                          <Tag color={entry.type === 'IN' ? 'green' : 'red'}>{entry.type === 'IN' ? 'Приход' : 'Расход'}</Tag>{' '}
                          <Typography.Text strong>{entry.product?.name}</Typography.Text>{' '}
                          <Typography.Text>({entry.product?.sku})</Typography.Text>{' '}
                          <Typography.Text>x {entry.quantity}</Typography.Text>{' '}
                          <Typography.Text type="secondary">{dayjs(entry.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text>
                          {entry.note && <div style={{ marginTop: 4 }}><Typography.Text type="secondary">{entry.note}</Typography.Text></div>}
                        </div>
                      ),
                    };
                  })}
                />
              </Card>
            ),
          },
        ]}
      />

      {/* Add Item Modal */}
      <Modal
        title="Добавить товар"
        open={itemModal}
        onCancel={() => setItemModal(false)}
        onOk={() => itemForm.submit()}
        confirmLoading={addItemMut.isPending}
        okText="Добавить"
        cancelText="Отмена"
      >
        <Form form={itemForm} layout="vertical" onFinish={(v) => addItemMut.mutate({ productId: v.productId, requestComment: v.requestComment || undefined })}>
          <Form.Item name="productId" label="Товар" rules={[{ required: true, message: 'Выберите товар' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Выберите товар"
              options={(products ?? []).filter((p) => p.isActive).map((p) => ({ label: `${p.name} (${p.sku}) — остаток: ${p.stock}`, value: p.id }))}
            />
          </Form.Item>
          <Form.Item name="requestComment" label="Комментарий / запрос">
            <Input.TextArea rows={2} placeholder="Например: нужно 50 тонн, уточнить наличие" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Payment Modal */}
      <Modal
        title="Обновить оплату"
        open={paymentModal}
        onCancel={() => setPaymentModal(false)}
        onOk={() => paymentForm.submit()}
        confirmLoading={paymentMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={paymentForm} layout="vertical" onFinish={(v) => paymentMut.mutate({ ...v, dueDate: v.dueDate ? v.dueDate.format('YYYY-MM-DD') : null, terms: v.terms || null })}>
          <Form.Item name="paidAmount" label="Оплаченная сумма" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Form.Item name="paymentType" label="Тип оплаты">
            <Select options={[{ label: 'Полная', value: 'FULL' }, { label: 'Частичная', value: 'PARTIAL' }, { label: 'В долг', value: 'DEBT' }]} />
          </Form.Item>
          <Form.Item name="dueDate" label="Срок оплаты">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="terms" label="Условия">
            <Input.TextArea rows={2} placeholder="Условия оплаты..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Warehouse Response Modal */}
      <Modal
        title="Ответ склада"
        open={warehouseResponseModal}
        onCancel={() => setWarehouseResponseModal(false)}
        onOk={() => warehouseForm.submit()}
        confirmLoading={warehouseResponseMut.isPending}
        okText="Ответить"
        cancelText="Отмена"
        width={700}
      >
        <Form form={warehouseForm} layout="vertical" onFinish={(values) => {
          const items = values.items.map((item: Record<string, unknown>) => ({
            dealItemId: item.dealItemId,
            warehouseComment: item.warehouseComment as string,
          }));
          warehouseResponseMut.mutate(items);
        }}>
          <Form.List name="items">
            {(fields) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {fields.map((field) => {
                  const itemData = warehouseForm.getFieldValue(['items', field.name]);
                  return (
                    <Card key={field.key} size="small" title={itemData?.productName || 'Товар'} bordered>
                      <Form.Item name={[field.name, 'dealItemId']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'productName']} hidden><Input /></Form.Item>
                      {itemData?.requestComment && (
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                          Запрос менеджера: {itemData.requestComment}
                        </Typography.Text>
                      )}
                      <Form.Item
                        name={[field.name, 'warehouseComment']}
                        label="Ответ склада"
                        rules={[{ required: true, message: 'Укажите ответ' }]}
                      >
                        <Input.TextArea rows={2} placeholder="Есть в наличии 40 тонн, срок доставки 3 дня..." />
                      </Form.Item>
                    </Card>
                  );
                })}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Set Quantities Modal */}
      <Modal
        title="Указать количества и цены"
        open={setQuantitiesModal}
        onCancel={() => setSetQuantitiesModal(false)}
        onOk={() => quantitiesForm.submit()}
        confirmLoading={setQuantitiesMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        width={800}
      >
        <Form form={quantitiesForm} layout="vertical" onFinish={(values) => {
          const items = values.items.map((item: Record<string, unknown>) => ({
            dealItemId: item.dealItemId,
            requestedQty: item.requestedQty as number,
            price: item.price as number,
          }));
          setQuantitiesMut.mutate({
            items,
            discount: values.discount || 0,
            paymentType: values.paymentType || 'FULL',
            paidAmount: values.paymentType === 'FULL' ? undefined : values.paidAmount || 0,
            dueDate: values.dueDate ? values.dueDate.format('YYYY-MM-DD') : undefined,
            terms: values.terms || undefined,
          });
        }}>
          <Form.List name="items">
            {(fields) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                {fields.map((field) => {
                  const itemData = quantitiesForm.getFieldValue(['items', field.name]);
                  return (
                    <Card key={field.key} size="small" title={`${itemData?.productName || 'Товар'} (${itemData?.unit || 'шт'})`} bordered>
                      <Form.Item name={[field.name, 'dealItemId']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'productName']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'unit']} hidden><Input /></Form.Item>
                      {itemData?.warehouseComment && (
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                          Ответ склада: {itemData.warehouseComment}
                        </Typography.Text>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Form.Item name={[field.name, 'requestedQty']} label="Количество" rules={[{ required: true, message: 'Обязательно' }]}>
                          <InputNumber style={{ width: '100%' }} min={0.1} step={0.1} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'price']} label="Цена за единицу" rules={[{ required: true, message: 'Обязательно' }]}>
                          <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
                        </Form.Item>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </Form.List>

          <Card size="small" title="Оплата" bordered>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item name="discount" label="Скидка">
                <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
              </Form.Item>
              <Form.Item name="paymentType" label="Тип оплаты">
                <Radio.Group>
                  <Radio.Button value="FULL">Полная</Radio.Button>
                  <Radio.Button value="PARTIAL">Частичная</Radio.Button>
                  <Radio.Button value="DEBT">В долг</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.paymentType !== cur.paymentType}>
                {({ getFieldValue }) => getFieldValue('paymentType') !== 'FULL' && (
                  <Form.Item name="paidAmount" label="Оплачено">
                    <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
                  </Form.Item>
                )}
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.paymentType !== cur.paymentType}>
                {({ getFieldValue }) => getFieldValue('paymentType') !== 'FULL' && (
                  <Form.Item name="dueDate" label="Срок оплаты">
                    <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
                  </Form.Item>
                )}
              </Form.Item>
            </div>
            <Form.Item name="terms" label="Условия">
              <Input.TextArea rows={2} placeholder="Условия оплаты..." />
            </Form.Item>
          </Card>
        </Form>
      </Modal>

      {/* Shipment Modal */}
      <Modal
        title="Оформить отгрузку"
        open={shipmentModal}
        onCancel={() => setShipmentModal(false)}
        onOk={() => shipmentForm.submit()}
        confirmLoading={shipmentMut.isPending}
        okText="Оформить"
        cancelText="Отмена"
        width={600}
      >
        <Form form={shipmentForm} layout="vertical" onFinish={(v) => shipmentMut.mutate({ ...v, departureTime: v.departureTime.toISOString(), shipmentComment: v.shipmentComment || undefined })}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="vehicleType" label="Тип транспорта" rules={[{ required: true, message: 'Обязательно' }]}>
              <Input placeholder="Грузовик / Фура / ..." />
            </Form.Item>
            <Form.Item name="vehicleNumber" label="Номер транспорта" rules={[{ required: true, message: 'Обязательно' }]}>
              <Input placeholder="01 A 123 AA" />
            </Form.Item>
            <Form.Item name="driverName" label="Водитель" rules={[{ required: true, message: 'Обязательно' }]}>
              <Input placeholder="ФИО водителя" />
            </Form.Item>
            <Form.Item name="departureTime" label="Время отправления" rules={[{ required: true, message: 'Обязательно' }]}>
              <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
            </Form.Item>
            <Form.Item name="deliveryNoteNumber" label="Номер накладной" rules={[{ required: true, message: 'Обязательно' }]}>
              <Input placeholder="Номер накладной" />
            </Form.Item>
            <Form.Item name="shipmentComment" label="Комментарий">
              <Input placeholder="Комментарий к отгрузке" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* Finance Reject Modal */}
      <Modal
        title="Отклонить сделку"
        open={rejectModal}
        onCancel={() => { setRejectModal(false); setRejectReason(''); }}
        onOk={() => { if (rejectReason.trim()) financeRejectMut.mutate(rejectReason.trim()); else message.warning('Укажите причину'); }}
        confirmLoading={financeRejectMut.isPending}
        okText="Отклонить"
        okButtonProps={{ danger: true }}
        cancelText="Отмена"
      >
        <Alert message="Сделка будет возвращена со статусом «Отклонена». Менеджер сможет доработать и отправить повторно." type="warning" showIcon style={{ marginBottom: 16 }} />
        <Input.TextArea
          rows={3}
          placeholder="Причина отклонения..."
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      {/* Payment Record Modal */}
      <Modal
        title="Добавить платёж"
        open={paymentRecordModal}
        onCancel={() => setPaymentRecordModal(false)}
        onOk={() => paymentRecordForm.submit()}
        confirmLoading={paymentRecordMut.isPending}
        okText="Добавить"
        cancelText="Отмена"
      >
        <Form form={paymentRecordForm} layout="vertical" onFinish={(v) => paymentRecordMut.mutate({ ...v, paidAt: v.paidAt ? v.paidAt.toISOString() : undefined })}>
          <Form.Item name="amount" label="Сумма" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Form.Item name="method" label="Способ оплаты">
            <Input placeholder="Наличные, перевод, карта..." />
          </Form.Item>
          <Form.Item name="paidAt" label="Дата оплаты">
            <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
          </Form.Item>
          <Form.Item name="note" label="Примечание">
            <Input.TextArea rows={2} placeholder="Примечание к платежу..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
