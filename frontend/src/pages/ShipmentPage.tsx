import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Typography, Button, Space, Tag, Modal, Form, Input, DatePicker,
  message, Badge,
} from 'antd';
import { SendOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import type { Deal, DealItem } from '../types';
import dayjs from 'dayjs';

export default function ShipmentPage() {
  const queryClient = useQueryClient();

  const [shipmentModal, setShipmentModal] = useState<string | null>(null);
  const [holdModal, setHoldModal] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [shipmentForm] = Form.useForm();

  const { data: deals, isLoading } = useQuery({
    queryKey: ['shipment-queue'],
    queryFn: dealsApi.shipmentQueue,
    refetchInterval: 10_000,
  });

  const shipmentMut = useMutation({
    mutationFn: ({ dealId, data }: { dealId: string; data: Parameters<typeof dealsApi.submitShipment>[1] }) =>
      dealsApi.submitShipment(dealId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment-queue'] });
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

  const columns = [
    {
      title: 'Сделка',
      dataIndex: 'title',
      render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link>,
    },
    {
      title: 'Клиент',
      dataIndex: ['client', 'companyName'],
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Товары',
      dataIndex: 'items',
      render: (items: DealItem[] | undefined) => (
        <Badge count={items?.length ?? 0} showZero style={{ backgroundColor: '#52c41a' }} />
      ),
    },
    {
      title: 'Менеджер',
      dataIndex: ['manager', 'fullName'],
    },
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Действия',
      width: 200,
      render: (_: unknown, r: Deal) => (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            onClick={() => { setShipmentModal(r.id); shipmentForm.resetFields(); }}
          >
            Отгрузить
          </Button>
          <Button
            size="small"
            icon={<PauseCircleOutlined />}
            onClick={() => { setHoldModal(r.id); setHoldReason(''); }}
          >
            Стоп
          </Button>
        </Space>
      ),
    },
  ];

  const list = deals ?? [];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Отгрузка
        {list.length > 0 && <Tag style={{ marginLeft: 8, fontSize: 14 }}>{list.length}</Tag>}
      </Typography.Title>

      <Table
        dataSource={list}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="middle"
        bordered={false}
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
                  { title: 'Кол-во', dataIndex: 'requestedQty', align: 'right' as const, render: (v: number | null) => v != null ? Number(v) : '—' },
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

      {/* Shipment Modal */}
      <Modal
        title="Оформление отгрузки"
        open={!!shipmentModal}
        onCancel={() => setShipmentModal(null)}
        onOk={() => shipmentForm.submit()}
        confirmLoading={shipmentMut.isPending}
        okText="Отгрузить"
        cancelText="Отмена"
        width={500}
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

      {/* Hold Modal */}
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
