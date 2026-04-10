import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography, Button, Card, Checkbox, message, Alert, Space, Tag, Popconfirm, Modal } from 'antd';
import { CarOutlined, CheckCircleOutlined, QrcodeOutlined } from '@ant-design/icons';
import { QRCodeCanvas } from 'qrcode.react';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import type { Deal } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuthStore } from '../store/authStore';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';

export default function MyVehiclePage() {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const user = useAuthStore((s) => s.user);
  const observeOnly = user?.role === 'ADMIN';
  const seeAll = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'WAREHOUSE_MANAGER';

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['my-vehicle'],
    queryFn: dealsApi.myVehicle,
    refetchInterval: 10_000,
  });

  const startMut = useMutation({
    mutationFn: (dealIds: string[]) => dealsApi.startDelivery(dealIds),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['my-vehicle'] });
      setSelected([]);
      message.success(`Выехали! Сделок: ${data.departedCount}`);
    },
  });

  const deliverMut = useMutation({
    mutationFn: (dealId: string) => dealsApi.deliverDeal(dealId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-vehicle'] });
      message.success('Доставлено!');
    },
  });

  const [qrDeal, setQrDeal] = useState<Deal | null>(null);

  const allIds = deals.map((d) => d.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id));

  const getQrUrl = (deal: Deal) => {
    const token = (deal as any).rating?.token;
    if (!token) return null;
    return `${window.location.origin}/rate/${token}`;
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const renderMobileCard = (r: Deal) => {
    const isSelected = selected.includes(r.id);
    return (
      <Card
        size="small"
        style={{
          marginBottom: 8,
          borderLeft: isSelected ? '3px solid #1677ff' : undefined,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {!observeOnly && (
              <Checkbox
                checked={isSelected}
                onChange={() => toggleSelect(r.id)}
                style={{ marginRight: 8 }}
              />
            )}
            <Link to={`/deals/${r.id}`}>
              <Typography.Text strong>{r.title}</Typography.Text>
            </Link>

            {seeAll && r.deliveryDriver && (
              <div style={{ marginTop: 4 }}>
                <Tag color="orange">{r.deliveryDriver.fullName}</Tag>
              </div>
            )}

            <div style={{ marginTop: 4, fontSize: 12 }}>
              <ClientCompanyDisplay client={r.client} secondary />
            </div>
            <div style={{ marginTop: 2 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {(r as any).client?.address || 'Адрес не указан'}
              </Typography.Text>
            </div>
            <div style={{ marginTop: 4 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>{formatUZS(Number(r.amount))}</Typography.Text>
            </div>
            <div style={{ marginTop: 4 }}>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                {(r as any).items?.map((it: any) => (
                  <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
                ))}
              </ul>
            </div>
          </div>
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {getQrUrl(r) && (
              <Button size="small" icon={<QrcodeOutlined />} onClick={() => setQrDeal(r)}>
                QR
              </Button>
            )}
            {observeOnly ? <Tag>Наблюдение</Tag> : (
              <Popconfirm title="Товар доставлен?" onConfirm={() => deliverMut.mutate(r.id)}>
                <Button type="primary" size="small" icon={<CheckCircleOutlined />} loading={deliverMut.isPending}>
                  Доставлено
                </Button>
              </Popconfirm>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={3} style={{ margin: 0 }}>
          <CarOutlined style={{ marginRight: 8 }} />
          Моя машина ({deals.length})
        </Typography.Title>
      </div>

      {deals.length === 0 && !isLoading && (
        <Alert message="Нет товаров для доставки" type="info" showIcon style={{ marginBottom: 16 }} />
      )}

      {deals.length > 0 && !observeOnly && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Checkbox
            checked={allSelected}
            indeterminate={selected.length > 0 && !allSelected}
            onChange={(e) => setSelected(e.target.checked ? allIds : [])}
          >
            Выбрать все
          </Checkbox>
          <Button
            icon={<CarOutlined />}
            disabled={selected.length === 0}
            loading={startMut.isPending}
            onClick={() => startMut.mutate(selected)}
          >
            Поехали! ({selected.length})
          </Button>
        </Space>
      )}

      {isMobile ? (
        isLoading ? (
          <Card loading />
        ) : (
          <div>{deals.map((d) => renderMobileCard(d))}</div>
        )
      ) : (
        <Card>
          <Table
            dataSource={deals}
            rowKey="id"
            loading={isLoading}
            size="small"
            pagination={false}
            scroll={{ x: 600 }}
            rowSelection={observeOnly ? undefined : {
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as string[]),
            }}
            columns={[
              { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
              ...(seeAll ? [{
                title: 'Водитель', key: 'driver', width: 140,
                render: (_: unknown, r: Deal) => r.deliveryDriver ? <Tag color="orange">{r.deliveryDriver.fullName}</Tag> : '—',
              }] : []),
              {
                title: 'Клиент',
                key: 'client',
                render: (_: unknown, r: Deal) => <ClientCompanyDisplay client={r.client} link />,
              },
              { title: 'Адрес', dataIndex: ['client', 'address'], render: (v: string) => v || '—' },
              { title: 'Сумма', dataIndex: 'amount', render: (v: string) => formatUZS(Number(v)), width: 130 },
              {
                title: 'Позиции', key: 'items',
                render: (_: unknown, r: Deal) => (
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {(r as any).items?.map((it: any) => (
                      <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
                    ))}
                  </ul>
                ),
              },
              {
                title: '', key: 'actions', width: 200,
                render: (_: unknown, r: Deal) => (
                  <Space size={4}>
                    {getQrUrl(r) && (
                      <Button size="small" icon={<QrcodeOutlined />} onClick={() => setQrDeal(r)}>QR</Button>
                    )}
                    {observeOnly ? <Tag>Наблюдение</Tag> : (
                      <Popconfirm title="Товар доставлен клиенту?" onConfirm={() => deliverMut.mutate(r.id)}>
                        <Button type="primary" size="small" icon={<CheckCircleOutlined />} loading={deliverMut.isPending}>
                          Доставлено
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        open={!!qrDeal}
        onCancel={() => setQrDeal(null)}
        footer={null}
        centered
        width={340}
      >
        {qrDeal && getQrUrl(qrDeal) && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <Typography.Title level={4} style={{ marginBottom: 16 }}>Покажите клиенту</Typography.Title>
            <QRCodeCanvas value={getQrUrl(qrDeal)!} size={250} level="M" />
            <div style={{ marginTop: 16 }}>
              <Typography.Text type="secondary">{qrDeal.title}</Typography.Text>
            </div>
            <div style={{ marginTop: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Клиент сканирует и оценивает доставку
              </Typography.Text>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
