import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Typography, Button, Tag, Modal, Form, Input,
  message, Badge, Card, InputNumber,
} from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { useIsMobile } from '../hooks/useIsMobile';
import type { Deal, DealItem } from '../types';
import { moneyFormatter, moneyParser } from '../utils/currency';
import { dealItemNeedsWarehouseStock } from '../utils/dealStock';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import dayjs from 'dayjs';

export default function StockConfirmationPage() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [respondModal, setRespondModal] = useState<Deal | null>(null);
  const [respondForm] = Form.useForm();

  const { data: deals, isLoading } = useQuery({
    queryKey: ['stock-confirmation-queue'],
    queryFn: dealsApi.stockConfirmationQueue,
    refetchInterval: 10_000,
  });

  const respondMut = useMutation({
    mutationFn: ({
      dealId,
      items,
    }: {
      dealId: string;
      items: { dealItemId: string; warehouseComment: string; requestedQty: number; price?: number }[];
    }) => dealsApi.submitWarehouseResponse(dealId, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-confirmation-queue'] });
      message.success('Ответ отправлен, сделка в работе');
      setRespondModal(null);
      respondForm.resetFields();
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
      key: 'client',
      render: (_: unknown, r: Deal) => <ClientCompanyDisplay client={r.client} link />,
    },
    {
      title: 'Товары',
      dataIndex: 'items',
      render: (items: DealItem[] | undefined) => (
        <Badge
          count={(items ?? []).filter(dealItemNeedsWarehouseStock).length}
          showZero
          style={{ backgroundColor: '#52c41a' }}
        />
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
      width: 160,
      render: (_: unknown, r: Deal) => (
        <Button
          type="primary"
          size="small"
          icon={<CheckCircleOutlined />}
          onClick={() => {
            const pending = (r.items ?? []).filter(dealItemNeedsWarehouseStock);
            const initialValues = pending.map((item) => {
              const defPrice = item.product?.salePrice ? Number(item.product.salePrice) : undefined;
              return {
                dealItemId: item.id,
                productName: item.product?.name || 'Товар',
                sku: item.product?.sku || '',
                unit: item.product?.unit || 'шт',
                requestComment: item.requestComment || '',
                warehouseComment: '',
                price: defPrice,
              };
            });
            respondForm.setFieldsValue({ items: initialValues });
            setRespondModal(r);
          }}
        >
          Ответить
        </Button>
      ),
    },
  ];

  const list = deals ?? [];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Ответ склада
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
        scroll={{ x: 600 }}
        locale={{ emptyText: 'Нет сделок для ответа' }}
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
                  { title: 'Ед.', dataIndex: ['product', 'unit'], width: 60 },
                  { title: 'Комментарий запроса', dataIndex: 'requestComment', render: (v: string | null) => v || '—' },
                ]}
              />
            );
          },
        }}
      />

      {/* Warehouse Response Modal */}
      <Modal
        title={`Ответ склада — ${respondModal?.title ?? ''}`}
        open={!!respondModal}
        onCancel={() => { setRespondModal(null); respondForm.resetFields(); }}
        onOk={() => respondForm.submit()}
        confirmLoading={respondMut.isPending}
        okText="Ответить"
        cancelText="Отмена"
        width={isMobile ? '100%' : 700}
      >
        <Form form={respondForm} layout="vertical" onFinish={(values) => {
          if (!respondModal) return;
          const items = (values.items as Record<string, unknown>[]).map((item) => {
            const priceVal = item.price as number | null | undefined;
            const row: { dealItemId: string; warehouseComment: string; requestedQty: number; price?: number } = {
              dealItemId: item.dealItemId as string,
              warehouseComment: String(item.warehouseComment ?? '').trim(),
              requestedQty: Number(item.requestedQty),
            };
            if (priceVal != null && priceVal > 0) {
              row.price = priceVal;
            }
            return row;
          });
          respondMut.mutate({ dealId: respondModal.id, items });
        }}>
          <Form.List name="items">
            {(fields) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {fields.map((field) => {
                  const itemData = respondForm.getFieldValue(['items', field.name]);
                  return (
                    <Card key={field.key} size="small" title={`${itemData?.productName || 'Товар'} (${itemData?.sku}) — ${itemData?.unit || 'шт'}`} bordered>
                      <Form.Item name={[field.name, 'dealItemId']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'productName']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'sku']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'unit']} hidden><Input /></Form.Item>
                      {itemData?.requestComment && (
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                          Запрос менеджера: {itemData.requestComment}
                        </Typography.Text>
                      )}
                      <Form.Item
                        name={[field.name, 'requestedQty']}
                        label={`Количество (${itemData?.unit || 'шт'})`}
                        rules={[{ required: true, message: 'Укажите количество' }]}
                      >
                        <InputNumber style={{ width: '100%' }} min={0.001} step={0.001} placeholder="Фактическое количество" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'price']}
                        label="Цена (пусто — из каталога)"
                      >
                        <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} placeholder="По прайсу" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'warehouseComment']}
                        label="Комментарий склада (необязательно)"
                      >
                        <Input.TextArea rows={2} placeholder="По желанию: срок, замечание…" />
                      </Form.Item>
                    </Card>
                  );
                })}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
