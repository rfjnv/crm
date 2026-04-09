import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Typography, Button, Space, Tag, Modal, Form, Input, DatePicker,
  message, Badge, Card, Tabs, Pagination,
} from 'antd';
import { SendOutlined, PauseCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import type { Deal, DealItem } from '../types';
import dayjs from 'dayjs';
import BackButton from '../components/BackButton';
import DealStatusTag from '../components/DealStatusTag';

const deliveryLabels: Record<string, string> = { SELF_PICKUP: 'Самовывоз', YANDEX: 'Яндекс', DELIVERY: 'Доставка' };

export default function ShipmentPage() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('queue');

  const [shipmentModal, setShipmentModal] = useState<string | null>(null);
  const [holdModal, setHoldModal] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [shipmentForm] = Form.useForm();
  const [closedPage, setClosedPage] = useState(1);

  const { data: deals, isLoading } = useQuery({
    queryKey: ['shipment-queue'],
    queryFn: dealsApi.shipmentQueue,
    refetchInterval: 10_000,
  });

  const { data: closedResult, isLoading: closedLoading } = useQuery({
    queryKey: ['closed-deals', closedPage],
    queryFn: () => dealsApi.closedDeals(closedPage, 20),
    refetchInterval: 30_000,
  });

  const shipmentMut = useMutation({
    mutationFn: ({ dealId, data }: { dealId: string; data: Parameters<typeof dealsApi.submitShipment>[1] }) =>
      dealsApi.submitShipment(dealId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment-queue'] });
      queryClient.invalidateQueries({ queryKey: ['closed-deals'] });
      message.success('Отгрузка оформлена, товар списан со склада');
      setShipmentModal(null);
      shipmentForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка оформления отгрузки';
      message.error(msg);
    },
  });

  const holdMut = useMutation({
    mutationFn: ({ dealId, reason }: { dealId: string; reason: string }) =>
      dealsApi.holdShipment(dealId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment-queue'] });
      message.success('Отгрузка приостановлена');
      setHoldModal(null);
      setHoldReason('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const list = deals ?? [];
  const closedDeals = closedResult?.data ?? [];
  const closedPagination = closedResult?.pagination;

  /* ---- Mobile card for shipment queue ---- */
  const renderQueueCard = (r: Deal) => (
    <Card size="small" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/deals/${r.id}`}>
            <Typography.Text strong>{r.title}</Typography.Text>
          </Link>
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {(r as any).client?.companyName}
            </Typography.Text>
          </div>
          <div style={{ marginTop: 2 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Менеджер: {(r as any).manager?.fullName}
            </Typography.Text>
          </div>
          <div style={{ marginTop: 4 }}>
            <Typography.Text strong>{formatUZS(Number(r.amount))}</Typography.Text>
            <Badge count={r.items?.length ?? 0} showZero style={{ backgroundColor: '#52c41a', marginLeft: 8 }} />
          </div>
          <div style={{ marginTop: 4 }}>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
              {r.items?.map((it: any) => (
                <li key={it.id}>
                  {it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}
                  {it.product?.stock != null && Number(it.product.stock) < Number(it.requestedQty) && (
                    <Typography.Text type="danger" style={{ fontSize: 11, marginLeft: 4 }}>
                      (остаток: {it.product.stock})
                    </Typography.Text>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: '#999' }}>
            {dayjs(r.createdAt).format('DD.MM.YYYY')}
          </div>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Button type="primary" size="small" icon={<SendOutlined />} onClick={() => { setShipmentModal(r.id); shipmentForm.resetFields(); }}>
            Отгрузить
          </Button>
          <Button size="small" icon={<PauseCircleOutlined />} onClick={() => { setHoldModal(r.id); setHoldReason(''); }}>
            Стоп
          </Button>
        </div>
      </div>
    </Card>
  );

  /* ---- Mobile card for closed deals ---- */
  const renderClosedCard = (r: Deal) => (
    <Card size="small" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/deals/${r.id}`}>
            <Typography.Text strong>{r.title}</Typography.Text>
          </Link>
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {(r as any).client?.companyName}
            </Typography.Text>
          </div>
          <div style={{ marginTop: 2 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Менеджер: {(r as any).manager?.fullName}
            </Typography.Text>
          </div>
          <div style={{ marginTop: 4 }}>
            <Space size={4} wrap>
              <DealStatusTag status={r.status} />
              {r.deliveryType && <Tag color={r.deliveryType === 'DELIVERY' ? 'orange' : r.deliveryType === 'YANDEX' ? 'purple' : 'blue'}>
                {deliveryLabels[r.deliveryType] || r.deliveryType}
              </Tag>}
            </Space>
          </div>
          {r.deliveryDriver && (
            <div style={{ marginTop: 2, fontSize: 12 }}>
              <Tag color="green" style={{ fontSize: 11 }}>Водитель: {r.deliveryDriver.fullName}</Tag>
            </div>
          )}
          {(r as any).loadingAssignee && (
            <div style={{ marginTop: 2, fontSize: 12 }}>
              <Tag color="cyan" style={{ fontSize: 11 }}>Грузил: {(r as any).loadingAssignee.fullName}</Tag>
            </div>
          )}
          <div style={{ marginTop: 4 }}>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
              {r.items?.map((it: any) => (
                <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
              ))}
            </ul>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography.Text strong>{formatUZS(Number(r.amount))}</Typography.Text>
          <div style={{ marginTop: 4, fontSize: 11, color: '#999' }}>
            {dayjs(r.updatedAt).format('DD.MM.YYYY')}
          </div>
          <div style={{ marginTop: 4 }}>
            <Tag icon={<CheckCircleOutlined />} color="success">Закрыта</Tag>
          </div>
        </div>
      </div>
    </Card>
  );

  /* ---- Desktop columns for queue ---- */
  const queueColumns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    { title: 'Товары', dataIndex: 'items', render: (items: DealItem[] | undefined) => <Badge count={items?.length ?? 0} showZero style={{ backgroundColor: '#52c41a' }} /> },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    { title: 'Дата', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    {
      title: 'Действия', width: 200,
      render: (_: unknown, r: Deal) => (
        <Space size="small">
          <Button type="primary" size="small" icon={<SendOutlined />} onClick={() => { setShipmentModal(r.id); shipmentForm.resetFields(); }}>Отгрузить</Button>
          <Button size="small" icon={<PauseCircleOutlined />} onClick={() => { setHoldModal(r.id); setHoldReason(''); }}>Стоп</Button>
        </Space>
      ),
    },
  ];

  /* ---- Desktop columns for closed deals ---- */
  const closedColumns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Доставка', dataIndex: 'deliveryType', width: 110,
      render: (v: string) => v ? <Tag color={v === 'DELIVERY' ? 'orange' : v === 'YANDEX' ? 'purple' : 'blue'}>{deliveryLabels[v] || v}</Tag> : '—',
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    {
      title: 'Водитель', key: 'driver', width: 140,
      render: (_: unknown, r: Deal) => r.deliveryDriver ? <Tag color="green">{r.deliveryDriver.fullName}</Tag> : '—',
    },
    {
      title: 'Грузил', key: 'loader', width: 140,
      render: (_: unknown, r: Deal) => (r as any).loadingAssignee ? <Tag color="cyan">{(r as any).loadingAssignee.fullName}</Tag> : '—',
    },
    {
      title: 'Товары', key: 'items',
      render: (_: unknown, r: Deal) => <Badge count={r.items?.length ?? 0} showZero style={{ backgroundColor: '#52c41a' }} />,
    },
    { title: 'Закрыта', dataIndex: 'updatedAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
  ];

  return (
    <div style={{ padding: isMobile ? 12 : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0 }}>Накладные</Typography.Title>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'queue',
          label: `Очередь (${list.length})`,
          children: isMobile ? (
            isLoading ? <Card loading /> : list.length === 0
              ? <Card><Typography.Text type="secondary">Нет сделок для отгрузки</Typography.Text></Card>
              : <div>{list.map((d) => <div key={d.id}>{renderQueueCard(d)}</div>)}</div>
          ) : (
            <Table
              dataSource={list}
              columns={queueColumns}
              rowKey="id"
              loading={isLoading}
              pagination={false}
              size="middle"
              scroll={{ x: 600 }}
              locale={{ emptyText: 'Нет сделок для отгрузки' }}
              expandable={{
                expandedRowRender: (record: Deal) => {
                  const items = record.items ?? [];
                  if (items.length === 0) return <Typography.Text type="secondary">Нет позиций</Typography.Text>;
                  return (
                    <Table
                      dataSource={items}
                      rowKey="id"
                      pagination={false}
                      size="small"
                      columns={[
                        { title: 'Товар', dataIndex: ['product', 'name'] },
                        { title: 'Артикул', dataIndex: ['product', 'sku'], render: (v: string) => <Tag>{v}</Tag> },
                        {
                          title: 'Кол-во', dataIndex: 'requestedQty', align: 'right' as const, render: (v: number | null) => {
                            if (v == null) return '—';
                            const n = Number(v);
                            return Number.isInteger(n) ? n.toString() : parseFloat(n.toFixed(3)).toString();
                          }
                        },
                        {
                          title: 'Остаток на складе',
                          dataIndex: ['product', 'stock'],
                          align: 'right' as const,
                          render: (v: number | undefined, r: DealItem) => {
                            const needed = Number(r.requestedQty ?? 0);
                            const stock = v ?? 0;
                            const insufficient = stock < needed;
                            return (
                              <Typography.Text type={insufficient ? 'danger' : undefined} strong={insufficient}>
                                {stock}
                              </Typography.Text>
                            );
                          },
                        },
                      ]}
                    />
                  );
                },
              }}
            />
          ),
        },
        {
          key: 'closed',
          label: `Закрытые (${closedPagination?.total ?? 0})`,
          children: isMobile ? (
            closedLoading ? <Card loading /> : closedDeals.length === 0
              ? <Card><Typography.Text type="secondary">Нет закрытых сделок</Typography.Text></Card>
              : (
                <div>
                  {closedDeals.map((d) => <div key={d.id}>{renderClosedCard(d)}</div>)}
                  {closedPagination && closedPagination.pages > 1 && (
                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                      <Pagination
                        current={closedPage}
                        total={closedPagination.total}
                        pageSize={20}
                        onChange={(p) => setClosedPage(p)}
                        size="small"
                      />
                    </div>
                  )}
                </div>
              )
          ) : (
            <>
              <Table
                dataSource={closedDeals}
                columns={closedColumns}
                rowKey="id"
                loading={closedLoading}
                pagination={false}
                size="middle"
                scroll={{ x: 900 }}
                locale={{ emptyText: 'Нет закрытых сделок' }}
                expandable={{
                  expandedRowRender: (record: Deal) => {
                    const items = record.items ?? [];
                    if (items.length === 0) return <Typography.Text type="secondary">Нет позиций</Typography.Text>;
                    return (
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {items.map((it: any) => (
                          <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
                        ))}
                      </ul>
                    );
                  },
                }}
              />
              {closedPagination && closedPagination.pages > 1 && (
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                  <Pagination
                    current={closedPage}
                    total={closedPagination.total}
                    pageSize={20}
                    onChange={(p) => setClosedPage(p)}
                  />
                </div>
              )}
            </>
          ),
        },
      ]} />

      <Modal
        title="Оформление отгрузки"
        open={!!shipmentModal}
        onCancel={() => setShipmentModal(null)}
        onOk={() => shipmentForm.submit()}
        confirmLoading={shipmentMut.isPending}
        okText="Отгрузить"
        cancelText="Отмена"
        width={isMobile ? '100%' : 500}
      >
        <Form
          form={shipmentForm}
          layout="vertical"
          onFinish={(values) => {
            shipmentMut.mutate({
              dealId: shipmentModal!,
              data: {
                vehicleType: values.vehicleType,
                vehicleNumber: values.vehicleNumber,
                driverName: values.driverName,
                departureTime: values.departureTime.toISOString(),
                deliveryNoteNumber: values.deliveryNoteNumber,
                shipmentComment: values.shipmentComment || undefined,
              },
            });
          }}
        >
          <Form.Item name="vehicleType" label="Тип транспорта" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input placeholder="Газель, Фура..." />
          </Form.Item>
          <Form.Item name="vehicleNumber" label="Номер транспорта" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input placeholder="01 A 123 AA" />
          </Form.Item>
          <Form.Item name="driverName" label="Водитель" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input placeholder="ФИО водителя" />
          </Form.Item>
          <Form.Item name="departureTime" label="Время отправки" rules={[{ required: true, message: 'Обязательно' }]}>
            <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
          </Form.Item>
          <Form.Item name="deliveryNoteNumber" label="Номер накладной" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input placeholder="Номер накладной" />
          </Form.Item>
          <Form.Item name="shipmentComment" label="Комментарий">
            <Input.TextArea rows={2} placeholder="Дополнительная информация..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Приостановить отгрузку"
        open={!!holdModal}
        onCancel={() => setHoldModal(null)}
        onOk={() => {
          if (!holdReason.trim()) {
            message.error('Укажите причину');
            return;
          }
          holdMut.mutate({ dealId: holdModal!, reason: holdReason });
        }}
        confirmLoading={holdMut.isPending}
        okText="Приостановить"
        cancelText="Отмена"
      >
        <Input.TextArea
          rows={3}
          placeholder="Причина приостановки отгрузки..."
          value={holdReason}
          onChange={(e) => setHoldReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
