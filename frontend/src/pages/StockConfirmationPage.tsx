import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Typography, Button, Tag, Modal, Form, Input,
  message, Badge, Card, InputNumber, Space,
} from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { useIsMobile } from '../hooks/useIsMobile';
import type { Deal, DealItem } from '../types';
import { moneyFormatter, moneyParser } from '../utils/currency';
import { dealItemNeedsWarehouseStock } from '../utils/dealStock';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import MobileCardList from '../components/MobileCardList';
import dayjs from 'dayjs';
import './StockConfirmationPage.css';

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

  const getPendingItems = (deal: Deal) => (deal.items ?? []).filter(dealItemNeedsWarehouseStock);

  const openRespondModal = (deal: Deal) => {
    const initialValues = getPendingItems(deal).map((item) => {
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
    setRespondModal(deal);
  };

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
          onClick={() => openRespondModal(r)}
        >
          Ответить
        </Button>
      ),
    },
  ];

  const list = deals ?? [];
  const pendingItemsTotal = list.reduce((sum, deal) => sum + getPendingItems(deal).length, 0);

  const renderMobileCard = (deal: Deal) => {
    const pendingItems = getPendingItems(deal);
    const preview = pendingItems.slice(0, 2);
    const hiddenCount = Math.max(pendingItems.length - preview.length, 0);

    return (
      <Card size="small" className="stock-confirm-mobile-card">
        <div className="stock-confirm-mobile-card__header">
          <div className="stock-confirm-mobile-card__header-main">
            <Link to={`/deals/${deal.id}`} className="stock-confirm-mobile-card__title-link">
              <Typography.Text strong className="stock-confirm-mobile-card__title">
                {deal.title}
              </Typography.Text>
            </Link>
            <div className="stock-confirm-mobile-card__client">
              <ClientCompanyDisplay client={deal.client} secondary />
            </div>
          </div>
          <Typography.Text type="secondary" className="stock-confirm-mobile-card__date">
            {dayjs(deal.createdAt).format('DD.MM.YYYY')}
          </Typography.Text>
        </div>

        <Space size={6} wrap className="stock-confirm-mobile-card__chips">
          <Tag color="green">{pendingItems.length} поз. к ответу</Tag>
          {deal.manager?.fullName && <Tag>{deal.manager.fullName}</Tag>}
        </Space>

        {preview.length > 0 && (
          <div className="stock-confirm-mobile-card__items">
            <div className="stock-confirm-mobile-card__items-header">
              <Typography.Text strong>Что нужно подтвердить</Typography.Text>
              <Typography.Text type="secondary">{pendingItems.length} поз.</Typography.Text>
            </div>
            <ul className="stock-confirm-mobile-card__items-list">
              {preview.map((item) => (
                <li key={item.id}>
                  <span>{item.product?.name || 'Товар'}</span>
                  {item.requestComment && (
                    <Typography.Text type="secondary" className="stock-confirm-mobile-card__item-comment">
                      {item.requestComment}
                    </Typography.Text>
                  )}
                </li>
              ))}
            </ul>
            {hiddenCount > 0 && (
              <Typography.Text type="secondary" className="stock-confirm-mobile-card__more">
                Еще {hiddenCount} {hiddenCount === 1 ? 'позиция' : hiddenCount < 5 ? 'позиции' : 'позиций'}
              </Typography.Text>
            )}
          </div>
        )}

        <Button
          type="primary"
          className="stock-confirm-mobile-card__action"
          icon={<CheckCircleOutlined />}
          onClick={() => openRespondModal(deal)}
        >
          Ответить по сделке
        </Button>
      </Card>
    );
  };

  return (
    <div className={isMobile ? 'stock-confirm-page stock-confirm-page--mobile' : 'stock-confirm-page'}>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Ответ склада
        {list.length > 0 && <Tag style={{ marginLeft: 8, fontSize: 14 }}>{list.length}</Tag>}
      </Typography.Title>

      {isMobile && (
        <div className="stock-confirm-summary">
          <Card size="small" className="stock-confirm-summary__card">
            <Typography.Text type="secondary">Сделки в очереди</Typography.Text>
            <Typography.Title level={4}>{list.length}</Typography.Title>
            <Typography.Text type="secondary">Позиции к подтверждению: {pendingItemsTotal}</Typography.Text>
          </Card>
        </div>
      )}

      {isMobile ? (
        <MobileCardList
          data={list}
          loading={isLoading}
          rowKey="id"
          emptyText="Нет сделок для ответа"
          renderCard={(deal) => renderMobileCard(deal)}
        />
      ) : (
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
      )}

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
        className={isMobile ? 'stock-confirm-modal stock-confirm-modal--mobile' : 'stock-confirm-modal'}
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
