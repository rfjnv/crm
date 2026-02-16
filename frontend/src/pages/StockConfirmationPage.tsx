import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Typography, Button, Tag, Modal, Form, Input,
  message, Badge, Card,
} from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import type { Deal, DealItem } from '../types';
import dayjs from 'dayjs';

export default function StockConfirmationPage() {
  const queryClient = useQueryClient();
  const [respondModal, setRespondModal] = useState<Deal | null>(null);
  const [respondForm] = Form.useForm();

  const { data: deals, isLoading } = useQuery({
    queryKey: ['stock-confirmation-queue'],
    queryFn: dealsApi.stockConfirmationQueue,
    refetchInterval: 10_000,
  });

  const respondMut = useMutation({
    mutationFn: ({ dealId, items }: { dealId: string; items: { dealItemId: string; warehouseComment: string }[] }) =>
      dealsApi.submitWarehouseResponse(dealId, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-confirmation-queue'] });
      message.success('Ответ отправлен');
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
      dataIndex: ['client', 'companyName'],
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
      width: 160,
      render: (_: unknown, r: Deal) => (
        <Button
          type="primary"
          size="small"
          icon={<CheckCircleOutlined />}
          onClick={() => {
            const initialValues = (r.items ?? []).map((item) => ({
              dealItemId: item.id,
              productName: item.product?.name || 'Товар',
              sku: item.product?.sku || '',
              unit: item.product?.unit || 'шт',
              requestComment: item.requestComment || '',
              warehouseComment: '',
            }));
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
        width={700}
      >
        <Form form={respondForm} layout="vertical" onFinish={(values) => {
          if (!respondModal) return;
          const items = values.items.map((item: Record<string, unknown>) => ({
            dealItemId: item.dealItemId as string,
            warehouseComment: item.warehouseComment as string,
          }));
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
    </div>
  );
}
