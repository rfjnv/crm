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

function normalizeQtyExpression(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/,/g, '.')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, '+');

  if (!/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function parseQtyInput(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  const normalized = normalizeQtyExpression(value);
  if (!normalized) return null;

  const total = normalized
    .split('+')
    .reduce((sum, part) => sum + Number(part), 0);

  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(total * 1000) / 1000;
}

function formatQtyValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, '');
}

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
      const hasCatalogPrice = defPrice != null && defPrice > 0;
      return {
        dealItemId: item.id,
        productName: item.product?.name || 'Товар',
        sku: item.product?.sku || '',
        unit: item.product?.unit || 'шт',
        requestComment: item.requestComment || '',
        warehouseComment: '',
        price: hasCatalogPrice ? undefined : null,
        hasCatalogPrice,
        catalogPrice: hasCatalogPrice ? defPrice : null,
      };
    });
    respondForm.setFieldsValue({ items: initialValues });
    setRespondModal(deal);
  };

  const applyParsedQtyValue = (fieldName: number) => {
    const currentValue = respondForm.getFieldValue(['items', fieldName, 'requestedQty']);
    const parsed = parseQtyInput(currentValue);
    if (parsed != null) {
      respondForm.setFieldValue(['items', fieldName, 'requestedQty'], formatQtyValue(parsed));
    }
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
  const modalPendingCount = respondModal ? getPendingItems(respondModal).length : 0;

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
        title={(
          <div className="stock-confirm-modal__title">
            <div className="stock-confirm-modal__title-main">
              <Typography.Text strong className="stock-confirm-modal__title-text">
                Ответ склада
              </Typography.Text>
              {respondModal && (
                <Typography.Text type="secondary" className="stock-confirm-modal__title-subtitle">
                  {respondModal.title}
                </Typography.Text>
              )}
            </div>
            {respondModal && (
              <Space size={6} wrap className="stock-confirm-modal__title-chips">
                <Tag color="green">{modalPendingCount} поз.</Tag>
                {respondModal.client && <Tag>{respondModal.client.companyName || 'Клиент'}</Tag>}
              </Space>
            )}
          </div>
        )}
        open={!!respondModal}
        onCancel={() => { setRespondModal(null); respondForm.resetFields(); }}
        width={isMobile ? '100%' : 700}
        className={isMobile ? 'stock-confirm-modal stock-confirm-modal--mobile' : 'stock-confirm-modal'}
        styles={isMobile ? { body: { paddingTop: 8, paddingBottom: 12 } } : undefined}
        footer={(
          <div className="stock-confirm-modal__footer">
            <div className="stock-confirm-modal__footer-text">
              {respondModal && (
                <Typography.Text type="secondary">
                  Заполните количество для всех {modalPendingCount} поз.
                </Typography.Text>
              )}
            </div>
            <div className="stock-confirm-modal__footer-actions">
              <Button onClick={() => { setRespondModal(null); respondForm.resetFields(); }}>
                Отмена
              </Button>
              <Button type="primary" loading={respondMut.isPending} onClick={() => respondForm.submit()}>
                Ответить
              </Button>
            </div>
          </div>
        )}
      >
        <Form form={respondForm} layout="vertical" className="stock-confirm-form" onFinish={(values) => {
          if (!respondModal) return;
          const items = (values.items as Record<string, unknown>[]).map((item) => {
            const parsedQty = parseQtyInput(item.requestedQty);
            const sourceItem = respondModal.items?.find((row) => row.id === item.dealItemId);
            const catalogPrice = sourceItem?.product?.salePrice != null ? Number(sourceItem.product.salePrice) : 0;
            const hasCatalogPrice = catalogPrice > 0;
            const priceVal = item.price as number | null | undefined;
            const row: { dealItemId: string; warehouseComment: string; requestedQty: number; price?: number } = {
              dealItemId: item.dealItemId as string,
              warehouseComment: String(item.warehouseComment ?? '').trim(),
              requestedQty: parsedQty ?? 0,
            };
            if (!hasCatalogPrice && priceVal != null && priceVal > 0) {
              row.price = priceVal;
            }
            return row;
          });
          respondMut.mutate({ dealId: respondModal.id, items });
        }}>
          <Form.List name="items">
            {(fields) => (
              <div className="stock-confirm-form__list">
                {fields.map((field) => {
                  const itemData = respondForm.getFieldValue(['items', field.name]);
                  return (
                    <Card
                      key={field.key}
                      size="small"
                      className="stock-confirm-form__item-card"
                      title={(
                        <div className="stock-confirm-form__item-title">
                          <Typography.Text strong className="stock-confirm-form__item-name">
                            {itemData?.productName || 'Товар'}
                          </Typography.Text>
                          <Space size={6} wrap className="stock-confirm-form__item-meta">
                            {itemData?.sku && <Tag>{itemData.sku}</Tag>}
                            <Tag color="blue">{itemData?.unit || 'шт'}</Tag>
                          </Space>
                        </div>
                      )}
                      bordered
                    >
                      <Form.Item name={[field.name, 'dealItemId']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'productName']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'sku']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'unit']} hidden><Input /></Form.Item>
                      {itemData?.requestComment && (
                        <div className="stock-confirm-form__request-note">
                          <Typography.Text type="secondary">
                            Запрос менеджера: {itemData.requestComment}
                          </Typography.Text>
                        </div>
                      )}
                      {itemData?.hasCatalogPrice ? (
                        <div className="stock-confirm-form__catalog-note">
                          <Typography.Text type="secondary">
                            Цена возьмется из каталога автоматически.
                          </Typography.Text>
                          <Typography.Text strong>
                            {moneyFormatter(itemData.catalogPrice)}
                          </Typography.Text>
                        </div>
                      ) : (
                        <div className="stock-confirm-form__price-warning">
                          <Typography.Text type="secondary">
                            У товара нет цены в каталоге, поэтому здесь нужно указать цену вручную.
                          </Typography.Text>
                        </div>
                      )}
                      <Form.Item
                        name={[field.name, 'requestedQty']}
                        label={`Количество (${itemData?.unit || 'шт'})`}
                        extra="Можно вводить: 20,2 или 20,2+20,3 или 20,2 20,3"
                        rules={[
                          { required: true, message: 'Укажите количество' },
                          {
                            validator: (_rule, value) => (
                              parseQtyInput(value) != null
                                ? Promise.resolve()
                                : Promise.reject(new Error('Введите число или сумму чисел через +'))
                            ),
                          },
                        ]}
                      >
                        <Input
                          inputMode="decimal"
                          placeholder="Например: 20,2 или 20,2+20,3"
                          onBlur={() => applyParsedQtyValue(field.name)}
                          onPressEnter={() => applyParsedQtyValue(field.name)}
                        />
                      </Form.Item>
                      {!itemData?.hasCatalogPrice && (
                        <Form.Item
                          name={[field.name, 'price']}
                          label="Цена"
                          rules={[{ required: true, message: 'Укажите цену' }]}
                        >
                          <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} placeholder="Цена из каталога не найдена" />
                        </Form.Item>
                      )}
                      <Form.Item
                        name={[field.name, 'warehouseComment']}
                        label="Комментарий склада (необязательно)"
                        className="stock-confirm-form__last-field"
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
