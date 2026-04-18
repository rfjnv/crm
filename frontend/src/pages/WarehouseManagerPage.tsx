import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography, Button, Card, Tabs, Tag, Space, Modal, Select, message, Popconfirm, Descriptions } from 'antd';
import { CheckOutlined, CarOutlined, UserAddOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import type { Deal, DeliveryType } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { useAuthStore } from '../store/authStore';
import MobileCardList from '../components/MobileCardList';
import './WarehouseManagerPage.css';

const deliveryLabels: Record<string, string> = {
  SELF_PICKUP: 'Самовывоз',
  YANDEX: 'Яндекс',
  DELIVERY: 'Доставка',
};

function DeliveryTag({ type }: { type?: DeliveryType | null }) {
  if (!type) return <Tag>—</Tag>;
  const colors: Record<string, string> = { SELF_PICKUP: 'blue', YANDEX: 'purple', DELIVERY: 'orange' };
  return <Tag color={colors[type] || 'default'}>{deliveryLabels[type] || type}</Tag>;
}

export default function WarehouseManagerPage() {
  const isMobile = useIsMobile();
  const role = useAuthStore((s) => s.user?.role);
  const fullWmAccess = role === 'WAREHOUSE_MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [tab, setTab] = useState('incoming');
  const [assignModal, setAssignModal] = useState<{ dealId: string; type: 'loading' | 'driver' } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const qc = useQueryClient();

  const { data: incoming = [], isLoading: l1 } = useQuery({ queryKey: ['wm-incoming'], queryFn: dealsApi.wmIncoming, refetchInterval: 10_000 });
  const { data: approved = [], isLoading: l2 } = useQuery({
    queryKey: ['wm-approved'],
    queryFn: dealsApi.wmApproved,
    refetchInterval: 10_000,
    enabled: fullWmAccess,
  });
  const { data: staff = [] } = useQuery({ queryKey: ['loading-staff'], queryFn: dealsApi.loadingStaff, enabled: fullWmAccess });
  const { data: drivers = [] } = useQuery({ queryKey: ['drivers-list'], queryFn: dealsApi.driversList, enabled: fullWmAccess });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['wm-incoming'] });
    if (fullWmAccess) qc.invalidateQueries({ queryKey: ['wm-approved'] });
  };

  const confirmMut = useMutation({
    mutationFn: (dealId: string) => dealsApi.wmConfirm(dealId),
    onSuccess: () => { invalidateAll(); message.success('Отправлено на одобрение админу'); },
  });

  const assignLoadingMut = useMutation({
    mutationFn: ({ dealId, assigneeId }: { dealId: string; assigneeId: string }) => dealsApi.assignLoading(dealId, assigneeId),
    onSuccess: () => { invalidateAll(); setAssignModal(null); setSelectedUserId(null); message.success('Сотрудник назначен на отгрузку'); },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Ошибка'),
  });

  const assignDriverMut = useMutation({
    mutationFn: ({ dealId, driverId }: { dealId: string; driverId: string }) => dealsApi.assignDriver(dealId, driverId),
    onSuccess: () => { invalidateAll(); setAssignModal(null); setSelectedUserId(null); message.success('Водитель назначен'); },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Ошибка'),
  });

  const roleLabels: Record<string, string> = { WAREHOUSE: 'Склад', DRIVER: 'Водитель', LOADER: 'Грузчик' };

  const toggleItems = (dealId: string) => {
    setExpandedItems((prev) => ({ ...prev, [dealId]: !prev[dealId] }));
  };

  const getItemsMeta = (deal: Deal) => {
    const items = (deal as any).items ?? [];
    const expanded = !!expandedItems[deal.id];
    const preview = expanded ? items : items.slice(0, 2);
    return {
      expanded,
      items,
      preview,
      hiddenCount: Math.max(items.length - preview.length, 0),
    };
  };

  const isPickupDeal = (deal: Deal) => deal.deliveryType === 'SELF_PICKUP' || deal.deliveryType === 'YANDEX';

  const expandedRow = (r: Deal) => (
    <Descriptions size="small" column={isMobile ? 1 : 3} bordered>
      {r.deliveryType && <Descriptions.Item label="Доставка"><DeliveryTag type={r.deliveryType} /></Descriptions.Item>}
      {r.vehicleNumber && <Descriptions.Item label="Номер машины">{r.vehicleNumber}</Descriptions.Item>}
      {r.vehicleType && <Descriptions.Item label="Тип машины">{r.vehicleType}</Descriptions.Item>}
      {r.deliveryComment && <Descriptions.Item label="Комментарий">{r.deliveryComment}</Descriptions.Item>}
      <Descriptions.Item label="Позиции">
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {(r as any).items?.map((it: any) => (
            <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
          ))}
        </ul>
      </Descriptions.Item>
    </Descriptions>
  );

  /* ---- Mobile cards ---- */

  const renderIncomingCard = (r: Deal) => {
    const isPickup = isPickupDeal(r);
    const { items, preview, expanded, hiddenCount } = getItemsMeta(r);
    const actionText = isPickup ? 'Клиент приехал' : 'Машина готова';
    const metaText = isPickup
      ? 'Сделка ждет подтверждения выдачи клиенту'
      : 'Сделка ждет подтверждения готовности к отправке';
    return (
      <Card size="small" className="wm-mobile-card">
        <div className="wm-mobile-card__header">
          <div className="wm-mobile-card__header-main">
            <Link to={`/deals/${r.id}`} className="wm-mobile-card__title-link">
              <Typography.Text strong className="wm-mobile-card__title">{r.title}</Typography.Text>
            </Link>
            <div className="wm-mobile-card__client">
              <ClientCompanyDisplay client={r.client} secondary />
            </div>
          </div>
          <Typography.Text strong className="wm-mobile-card__amount">
            {formatUZS(Number(r.amount))}
          </Typography.Text>
        </div>

        <Space size={6} wrap className="wm-mobile-card__chips">
          <DeliveryTag type={r.deliveryType} />
          <Tag color={isPickup ? 'geekblue' : 'cyan'}>{isPickup ? 'Ждет клиента' : 'Ждет машину'}</Tag>
          {r.vehicleNumber && <Tag>{`${r.vehicleType || ''} ${r.vehicleNumber}`.trim()}</Tag>}
        </Space>

        <Typography.Text type="secondary" className="wm-mobile-card__meta">
          {metaText}
        </Typography.Text>

        {r.deliveryComment && (
          <div className="wm-mobile-card__note">
            <Typography.Text type="secondary">{r.deliveryComment}</Typography.Text>
          </div>
        )}

        {items.length > 0 && (
          <div className="wm-mobile-card__items">
            <div className="wm-mobile-card__items-header">
              <Typography.Text strong>Состав заказа</Typography.Text>
              <Typography.Text type="secondary">{items.length} поз.</Typography.Text>
            </div>
            <ul className="wm-mobile-card__items-list">
              {preview.map((it: any) => (
                <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
              ))}
            </ul>
            {(hiddenCount > 0 || items.length > 2) && (
              <Button type="link" size="small" className="wm-mobile-card__toggle" onClick={() => toggleItems(r.id)}>
                {expanded ? 'Скрыть состав' : `Показать еще ${hiddenCount} ${hiddenCount === 1 ? 'позицию' : 'позиции'}`}
              </Button>
            )}
          </div>
        )}

        <Popconfirm title={isPickup ? 'Клиент пришёл за товарами?' : 'Машина готова?'} onConfirm={() => confirmMut.mutate(r.id)}>
          <Button type="primary" className="wm-mobile-card__action" icon={isPickup ? <CheckOutlined /> : <CarOutlined />} loading={confirmMut.isPending}>
            {actionText}
          </Button>
        </Popconfirm>
      </Card>
    );
  };

  const renderApprovedCard = (r: Deal) => {
    const isDelivery = r.deliveryType === 'DELIVERY';
    const needsDriver = isDelivery && !r.deliveryDriverId;
    const { items, preview, expanded, hiddenCount } = getItemsMeta(r);
    const summaryStatus = needsDriver
      ? 'Нужно назначить водителя'
      : isDelivery
        ? 'Готово к назначению на отгрузку'
        : 'Можно передавать на отгрузку';
    return (
      <Card size="small" className="wm-mobile-card">
        <div className="wm-mobile-card__header">
          <div className="wm-mobile-card__header-main">
            <Link to={`/deals/${r.id}`} className="wm-mobile-card__title-link">
              <Typography.Text strong className="wm-mobile-card__title">{r.title}</Typography.Text>
            </Link>
            <div className="wm-mobile-card__client">
              <ClientCompanyDisplay client={r.client} secondary />
            </div>
          </div>
          <Typography.Text strong className="wm-mobile-card__amount">
            {formatUZS(Number(r.amount))}
          </Typography.Text>
        </div>

        <Space size={6} wrap className="wm-mobile-card__chips">
          <DeliveryTag type={r.deliveryType} />
          <Tag color={needsDriver ? 'red' : 'green'}>{summaryStatus}</Tag>
          {r.deliveryDriver && <Tag color="green">{r.deliveryDriver.fullName}</Tag>}
        </Space>

        {items.length > 0 && (
          <div className="wm-mobile-card__items">
            <div className="wm-mobile-card__items-header">
              <Typography.Text strong>Состав заказа</Typography.Text>
              <Typography.Text type="secondary">{items.length} поз.</Typography.Text>
            </div>
            <ul className="wm-mobile-card__items-list">
              {preview.map((it: any) => (
                <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
              ))}
            </ul>
            {(hiddenCount > 0 || items.length > 2) && (
              <Button type="link" size="small" className="wm-mobile-card__toggle" onClick={() => toggleItems(r.id)}>
                {expanded ? 'Скрыть состав' : `Показать еще ${hiddenCount} ${hiddenCount === 1 ? 'позицию' : 'позиции'}`}
              </Button>
            )}
          </div>
        )}

        {needsDriver ? (
          <Button
            type="primary"
            className="wm-mobile-card__action"
            icon={<CarOutlined />}
            onClick={() => { setAssignModal({ dealId: r.id, type: 'driver' }); setSelectedUserId(null); }}
          >
            Назначить водителя
          </Button>
        ) : (
          <Button
            className="wm-mobile-card__action"
            icon={<UserAddOutlined />}
            onClick={() => { setAssignModal({ dealId: r.id, type: 'loading' }); setSelectedUserId(null); }}
          >
            Передать на отгрузку
          </Button>
        )}
      </Card>
    );
  };

  const pageTitle = fullWmAccess ? 'Зав. склада' : 'Входящие к админу';
  const incomingPickupCount = incoming.filter((deal) => isPickupDeal(deal)).length;
  const incomingDeliveryCount = incoming.filter((deal) => deal.deliveryType === 'DELIVERY').length;
  const approvedNeedsDriverCount = approved.filter((deal) => deal.deliveryType === 'DELIVERY' && !deal.deliveryDriverId).length;
  const approvedLoadingReadyCount = approved.length - approvedNeedsDriverCount;

  const incomingTab = {
    key: 'incoming',
    label: `Входящие (${incoming.length})`,
    children: isMobile ? (
      <MobileCardList
        data={incoming}
        loading={l1}
        rowKey="id"
        emptyText="Нет входящих сделок"
        renderCard={(deal) => renderIncomingCard(deal)}
      />
    ) : (
      <Card>
        <Table
          dataSource={incoming}
          rowKey="id"
          loading={l1}
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
          expandable={{ expandedRowRender: expandedRow }}
          columns={[
            { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
            {
              title: 'Клиент',
              key: 'client',
              render: (_: unknown, r: Deal) => <ClientCompanyDisplay client={r.client} link />,
            },
            { title: 'Доставка', dataIndex: 'deliveryType', render: (v: DeliveryType) => <DeliveryTag type={v} />, width: 110 },
            { title: 'Машина', key: 'vehicle', render: (_: unknown, r: Deal) => r.vehicleNumber ? `${r.vehicleType || ''} ${r.vehicleNumber}`.trim() : '—', width: 160 },
            { title: 'Сумма', dataIndex: 'amount', render: (v: string) => formatUZS(Number(v)), width: 130 },
            {
              title: '', key: 'actions', width: 200,
              render: (_: unknown, r: Deal) => {
                const isPickup = r.deliveryType === 'SELF_PICKUP' || r.deliveryType === 'YANDEX';
                return (
                  <Popconfirm title={isPickup ? 'Клиент пришёл за товарами?' : 'Машина готова?'} onConfirm={() => confirmMut.mutate(r.id)}>
                    <Button type="primary" size="small" icon={isPickup ? <CheckOutlined /> : <CarOutlined />} loading={confirmMut.isPending}>
                      {isPickup ? 'Пришли за товарами' : 'Машина готова'}
                    </Button>
                  </Popconfirm>
                );
              },
            },
          ]}
        />
      </Card>
    ),
  };

  const approvedTab = {
    key: 'approved',
    label: `Одобренные (${approved.length})`,
    children: isMobile ? (
      <MobileCardList
        data={approved}
        loading={l2}
        rowKey="id"
        emptyText="Нет одобренных сделок"
        renderCard={(deal) => renderApprovedCard(deal)}
      />
    ) : (
      <Card>
        <Table
          dataSource={approved}
          rowKey="id"
          loading={l2}
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
          expandable={{ expandedRowRender: expandedRow }}
          columns={[
            { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
            {
              title: 'Клиент',
              key: 'client',
              render: (_: unknown, r: Deal) => <ClientCompanyDisplay client={r.client} link />,
            },
            { title: 'Доставка', dataIndex: 'deliveryType', render: (v: DeliveryType) => <DeliveryTag type={v} />, width: 110 },
            {
              title: 'Водитель', key: 'driver', width: 140,
              render: (_: unknown, r: Deal) => r.deliveryDriver
                ? <Tag color="green">{r.deliveryDriver.fullName}</Tag>
                : r.deliveryType === 'DELIVERY' ? <Tag color="red">Не назначен</Tag> : '—',
            },
            { title: 'Сумма', dataIndex: 'amount', render: (v: string) => formatUZS(Number(v)), width: 130 },
            {
              title: '', key: 'actions', width: 250,
              render: (_: unknown, r: Deal) => {
                const isDelivery = r.deliveryType === 'DELIVERY';
                const needsDriver = isDelivery && !r.deliveryDriverId;
                return (
                  <Space wrap>
                    {needsDriver && (
                      <Button size="small" type="primary" icon={<CarOutlined />} onClick={() => { setAssignModal({ dealId: r.id, type: 'driver' }); setSelectedUserId(null); }}>
                        Назначить водителя
                      </Button>
                    )}
                    {!needsDriver && (
                      <Button size="small" icon={<UserAddOutlined />} onClick={() => { setAssignModal({ dealId: r.id, type: 'loading' }); setSelectedUserId(null); }}>
                        Назначить на отгрузку
                      </Button>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>
    ),
  };

  return (
    <div style={{ padding: isMobile ? 12 : 24 }} className={isMobile ? 'wm-page wm-page--mobile' : 'wm-page'}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={3} style={{ margin: 0 }}>{pageTitle}</Typography.Title>
      </div>
      {isMobile && (
        <div className="wm-mobile-summary">
          <Card size="small" className="wm-mobile-summary__card">
            <Typography.Text type="secondary">Входящие</Typography.Text>
            <Typography.Title level={4}>{incoming.length}</Typography.Title>
            <Typography.Text type="secondary">
              Самовывоз: {incomingPickupCount} · Доставка: {incomingDeliveryCount}
            </Typography.Text>
          </Card>
          {fullWmAccess && (
            <Card size="small" className="wm-mobile-summary__card">
              <Typography.Text type="secondary">Одобренные</Typography.Text>
              <Typography.Title level={4}>{approved.length}</Typography.Title>
              <Typography.Text type="secondary">
                Без водителя: {approvedNeedsDriverCount} · На отгрузку: {approvedLoadingReadyCount}
              </Typography.Text>
            </Card>
          )}
        </div>
      )}
      <Tabs activeKey={tab} onChange={setTab} items={fullWmAccess ? [incomingTab, approvedTab] : [incomingTab]} />

      <Modal
        title={assignModal?.type === 'loading' ? 'Назначить на отгрузку' : 'Назначить водителя'}
        open={!!assignModal}
        onCancel={() => { setAssignModal(null); setSelectedUserId(null); }}
        onOk={() => {
          if (!assignModal || !selectedUserId) return;
          if (assignModal.type === 'loading') {
            assignLoadingMut.mutate({ dealId: assignModal.dealId, assigneeId: selectedUserId });
          } else {
            assignDriverMut.mutate({ dealId: assignModal.dealId, driverId: selectedUserId });
          }
        }}
        okButtonProps={{ disabled: !selectedUserId }}
        confirmLoading={assignLoadingMut.isPending || assignDriverMut.isPending}
      >
        <Select
          style={{ width: '100%' }}
          placeholder={assignModal?.type === 'loading' ? 'Выберите сотрудника' : 'Выберите водителя'}
          value={selectedUserId}
          onChange={setSelectedUserId}
          options={
            assignModal?.type === 'loading'
              ? staff.map((s) => ({ label: `${s.fullName} (${roleLabels[s.role] || s.role})`, value: s.id }))
              : drivers.map((d) => ({ label: d.fullName, value: d.id }))
          }
        />
      </Modal>
    </div>
  );
}
