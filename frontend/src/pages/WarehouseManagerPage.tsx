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
    const isPickup = r.deliveryType === 'SELF_PICKUP' || r.deliveryType === 'YANDEX';
    return (
      <Card size="small" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link to={`/deals/${r.id}`}>
              <Typography.Text strong>{r.title}</Typography.Text>
            </Link>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              <ClientCompanyDisplay client={r.client} secondary />
            </div>
            <div style={{ marginTop: 4 }}>
              <Space size={4} wrap>
                <DeliveryTag type={r.deliveryType} />
                {r.vehicleNumber && (
                  <Tag>{r.vehicleType || ''} {r.vehicleNumber}</Tag>
                )}
              </Space>
            </div>
            {r.deliveryComment && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>{r.deliveryComment}</div>
            )}
            <div style={{ marginTop: 4 }}>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                {(r as any).items?.map((it: any) => (
                  <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
                ))}
              </ul>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ marginBottom: 8 }}>
              <Typography.Text strong>{formatUZS(Number(r.amount))}</Typography.Text>
            </div>
            <Popconfirm title={isPickup ? 'Клиент пришёл за товарами?' : 'Машина готова?'} onConfirm={() => confirmMut.mutate(r.id)}>
              <Button type="primary" size="small" icon={isPickup ? <CheckOutlined /> : <CarOutlined />} loading={confirmMut.isPending}>
                {isPickup ? 'Пришли' : 'Готова'}
              </Button>
            </Popconfirm>
          </div>
        </div>
      </Card>
    );
  };

  const renderApprovedCard = (r: Deal) => {
    const isDelivery = r.deliveryType === 'DELIVERY';
    const needsDriver = isDelivery && !r.deliveryDriverId;
    return (
      <Card size="small" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link to={`/deals/${r.id}`}>
              <Typography.Text strong>{r.title}</Typography.Text>
            </Link>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              <ClientCompanyDisplay client={r.client} secondary />
            </div>
            <div style={{ marginTop: 4 }}>
              <Space size={4} wrap>
                <DeliveryTag type={r.deliveryType} />
                {r.deliveryDriver && <Tag color="green">{r.deliveryDriver.fullName}</Tag>}
                {isDelivery && !r.deliveryDriver && <Tag color="red">Водитель не назначен</Tag>}
              </Space>
            </div>
            <div style={{ marginTop: 4 }}>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                {(r as any).items?.map((it: any) => (
                  <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
                ))}
              </ul>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ marginBottom: 8 }}>
              <Typography.Text strong>{formatUZS(Number(r.amount))}</Typography.Text>
            </div>
            <Space direction="vertical" size={4}>
              {needsDriver && (
                <Button size="small" type="primary" icon={<CarOutlined />} onClick={() => { setAssignModal({ dealId: r.id, type: 'driver' }); setSelectedUserId(null); }}>
                  Водитель
                </Button>
              )}
              {!needsDriver && (
                <Button size="small" icon={<UserAddOutlined />} onClick={() => { setAssignModal({ dealId: r.id, type: 'loading' }); setSelectedUserId(null); }}>
                  Отгрузка
                </Button>
              )}
            </Space>
          </div>
        </div>
      </Card>
    );
  };

  const pageTitle = fullWmAccess ? 'Зав. склада' : 'Входящие к админу';

  const incomingTab = {
    key: 'incoming',
    label: `Входящие (${incoming.length})`,
    children: isMobile ? (
      l1 ? <Card loading /> : incoming.length === 0
        ? <Card><Typography.Text type="secondary">Нет входящих сделок</Typography.Text></Card>
        : <div>{incoming.map((d) => <div key={d.id}>{renderIncomingCard(d)}</div>)}</div>
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
      l2 ? <Card loading /> : approved.length === 0
        ? <Card><Typography.Text type="secondary">Нет одобренных сделок</Typography.Text></Card>
        : <div>{approved.map((d) => <div key={d.id}>{renderApprovedCard(d)}</div>)}</div>
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
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={3} style={{ margin: 0 }}>{pageTitle}</Typography.Title>
      </div>
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
