import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Select, Typography, Tag, Card } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, EditOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { inventoryApi } from '../api/warehouse.api';
import { useIsMobile } from '../hooks/useIsMobile';
import { smartFilterOption } from '../utils/translit';
import MobileCardList from '../components/MobileCardList';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';

const typeConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  IN: { color: 'green', icon: <ArrowUpOutlined />, label: 'Приход' },
  OUT: { color: 'red', icon: <ArrowDownOutlined />, label: 'Расход' },
  CORRECTION: { color: 'orange', icon: <EditOutlined />, label: 'Коррекция' },
};

export default function MovementsPage() {
  const isMobile = useIsMobile();
  const [productFilter, setProductFilter] = useState<string | undefined>();
  const [selectedMovement, setSelectedMovement] = useState<any>(null);

  const { data: movements, isLoading } = useQuery({
    queryKey: ['movements', productFilter],
    queryFn: () => inventoryApi.listMovements(productFilter),
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const columns = [
    {
      title: 'Тип',
      dataIndex: 'type',
      width: 80,
      render: (v: string) => {
        const cfg = typeConfig[v] || typeConfig.OUT;
        return <Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag>;
      },
    },
    { title: 'Товар', dataIndex: ['product', 'name'] },
    { title: 'Артикул', dataIndex: ['product', 'sku'], render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Кол-во', dataIndex: 'quantity', align: 'right' as const, width: 80 },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, record: any) => {
        const clientName = record.deal?.client?.companyName || record.deal?.title;
        if (!record.deal?.id || !clientName) return clientName || '—';
        return <Link to={`/deals/${record.deal.id}`}>{clientName}</Link>;
      },
    },
    { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
    { title: 'Дата', dataIndex: 'createdAt', width: 140, render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm') },
  ];

  // Mobile: show detail view instead of list when an item is selected
  if (isMobile && selectedMovement) {
    const m = selectedMovement;
    const cfg = typeConfig[m.type] || typeConfig.OUT;
    return (
      <div>
        <div
          onClick={() => setSelectedMovement(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}
        >
          <LeftOutlined />
          <Typography.Text>Назад</Typography.Text>
        </div>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag>
              <Typography.Text type="secondary">{dayjs(m.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Товар</Typography.Text>
              <div><Typography.Text strong>{m.product?.name}</Typography.Text></div>
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Артикул</Typography.Text>
                <div><Tag>{m.product?.sku}</Tag></div>
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Кол-во</Typography.Text>
                <div><Typography.Text strong style={{ fontSize: 16 }}>{m.quantity}</Typography.Text></div>
              </div>
            </div>
            {m.deal && (
              <Link to={`/deals/${m.deal.id}`} style={{ textDecoration: 'none' }}>
                <Card size="small" style={{ background: 'rgba(22, 119, 255, 0.04)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Клиент</Typography.Text>
                      <div><Typography.Text strong>{m.deal.client?.companyName || m.deal.title}</Typography.Text></div>
                      <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>Сделка: {m.deal.title}</Typography.Text></div>
                    </div>
                    <RightOutlined style={{ color: '#999' }} />
                  </div>
                </Card>
              </Link>
            )}
            {m.note && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Примечание</Typography.Text>
                <div style={{ wordBreak: 'break-word' }}><Typography.Text>{m.note}</Typography.Text></div>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', marginBottom: 16, gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Движение склада</Typography.Title>
        <Select
          allowClear
          placeholder="Фильтр по товару"
          style={{ width: isMobile ? '100%' : 250 }}
          value={productFilter}
          onChange={(v) => setProductFilter(v)}
          showSearch
          filterOption={smartFilterOption}
          options={(products ?? []).map((p) => ({ label: `${p.name} (${p.sku})`, value: p.id }))}
        />
      </div>

      {isMobile ? (
        <MobileCardList
          data={movements ?? []}
          rowKey="id"
          loading={isLoading}
          renderCard={(m: any) => {
            const cfg = typeConfig[m.type] || typeConfig.OUT;
            return (
              <Card
                size="small"
                style={{ marginBottom: 0, cursor: 'pointer' }}
                onClick={() => setSelectedMovement(m)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <Tag color={cfg.color} icon={cfg.icon} style={{ margin: 0, flexShrink: 0 }}>{cfg.label}</Tag>
                    <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>{m.product?.name}</Typography.Text>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap', marginLeft: 8, flexShrink: 0 }}>
                    {dayjs(m.createdAt).format('DD.MM HH:mm')}
                  </Typography.Text>
                </div>
              </Card>
            );
          }}
        />
      ) : (
        <Table
          dataSource={movements}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          size="middle"
          bordered={false}
          scroll={{ x: 600 }}
        />
      )}
    </div>
  );
}
