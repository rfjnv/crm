import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Table, Typography, Tag, Space, Drawer, Descriptions, Badge, Card,
  Button, Input, Tabs, Pagination,
} from 'antd';
import { EyeOutlined, TruckOutlined, UserOutlined, ClockCircleOutlined } from '@ant-design/icons';
import DealStatusTag from '../components/DealStatusTag';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import BackButton from '../components/BackButton';
import type { Deal, DealItem } from '../types';
import dayjs from 'dayjs';

export default function WarehouseShipmentsPage() {
  const isMobile = useIsMobile();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState('');
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mainTab, setMainTab] = useState<'shipments' | 'closed'>('shipments');
  const [closedPage, setClosedPage] = useState(1);
  const [closedSearch, setClosedSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['warehouse-shipments', page, limit],
    queryFn: () => dealsApi.getShipments(page, limit),
    refetchInterval: 30_000,
  });

  const { data: dealDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['deal-detail', selectedDeal?.id],
    queryFn: () => dealsApi.getById(selectedDeal!.id),
    enabled: !!selectedDeal?.id,
  });

  const { data: closedResult, isLoading: closedLoading } = useQuery({
    queryKey: ['closed-deals', closedPage],
    queryFn: () => dealsApi.closedDeals(closedPage, 50),
    enabled: mainTab === 'closed',
    refetchInterval: 30_000,
  });

  const shipments = data?.data ?? [];
  const pagination = data?.pagination;

  const closedDeals = closedResult?.data ?? [];
  const closedPagination = closedResult?.pagination;

  const filteredShipments = shipments.filter((deal) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      deal.title.toLowerCase().includes(q) ||
      (deal.client?.companyName ?? '').toLowerCase().includes(q) ||
      (deal.shipment?.deliveryNoteNumber ?? '').toLowerCase().includes(q) ||
      (deal.shipment?.vehicleNumber ?? '').toLowerCase().includes(q) ||
      (deal.manager?.fullName ?? '').toLowerCase().includes(q)
    );
  });

  const deliveryLabels: Record<string, string> = { SELF_PICKUP: 'Самовывоз', YANDEX: 'Яндекс', DELIVERY: 'Доставка' };

  const filteredClosed = closedDeals.filter((deal) => {
    if (!closedSearch) return true;
    const q = closedSearch.toLowerCase();
    return (
      deal.title.toLowerCase().includes(q) ||
      (deal.client?.companyName ?? '').toLowerCase().includes(q) ||
      (deal.manager?.fullName ?? '').toLowerCase().includes(q)
    );
  });

  const openDetail = (deal: Deal) => {
    setSelectedDeal(deal);
    setDrawerOpen(true);
  };

  const columns = [
    {
      title: 'Накладная',
      dataIndex: ['shipment', 'deliveryNoteNumber'],
      width: 120,
      render: (v: string, record: Deal) => (
        <Button
          type="link"
          size="small"
          onClick={() => openDetail(record)}
          style={{ padding: 0, fontWeight: 600 }}
        >
          {v}
        </Button>
      ),
    },
    {
      title: 'Сделка',
      dataIndex: 'title',
      render: (v: string, record: Deal) => (
        <Link to={`/deals/${record.id}`} style={{ fontWeight: 500 }}>
          {v}
        </Link>
      ),
    },
    {
      title: 'Клиент',
      dataIndex: ['client', 'companyName'],
      render: (v: string, record: Deal) => (
        <Link to={`/clients/${record.clientId}`}>
          {v}
        </Link>
      ),
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      width: 120,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Транспорт',
      dataIndex: ['shipment', 'vehicleNumber'],
      width: 100,
      render: (v: string, record: Deal) => (
        <Space direction="vertical" size={0}>
          <Tag icon={<TruckOutlined />} color="blue">
            {v}
          </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {record.shipment?.vehicleType}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Водитель',
      dataIndex: ['shipment', 'driverName'],
      width: 120,
      render: (v: string) => (
        <Space>
          <UserOutlined style={{ color: '#666' }} />
          <span>{v}</span>
        </Space>
      ),
    },
    {
      title: 'Время отправки',
      dataIndex: ['shipment', 'departureTime'],
      width: 140,
      render: (v: string) => (
        <Space direction="vertical" size={0}>
          <span>{dayjs(v).format('DD.MM.YYYY')}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {dayjs(v).format('HH:mm')}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Товаров',
      dataIndex: 'items',
      align: 'center' as const,
      width: 80,
      render: (items: DealItem[] | undefined) => (
        <Badge count={items?.length ?? 0} showZero style={{ backgroundColor: '#52c41a' }} />
      ),
    },
    {
      title: 'Менеджер',
      dataIndex: ['manager', 'fullName'],
      width: 120,
    },
    {
      title: 'Отгружено',
      dataIndex: ['shipment', 'shippedAt'],
      width: 100,
      render: (v: string) => (
        <Typography.Text type="secondary">
          {dayjs(v).format('DD.MM HH:mm')}
        </Typography.Text>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_: unknown, record: Deal) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => openDetail(record)}
        />
      ),
    },
  ];

  const closedColumns = [
    {
      title: 'Сделка',
      dataIndex: 'title',
      render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link>,
    },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Доставка',
      dataIndex: 'deliveryType',
      width: 110,
      render: (v: string | undefined) =>
        v ? <Tag color={v === 'DELIVERY' ? 'orange' : v === 'YANDEX' ? 'purple' : 'blue'}>{deliveryLabels[v] || v}</Tag> : '—',
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    {
      title: 'Водитель',
      key: 'driver',
      width: 140,
      render: (_: unknown, r: Deal) => (r.deliveryDriver ? <Tag color="green">{r.deliveryDriver.fullName}</Tag> : '—'),
    },
    {
      title: 'Грузил',
      key: 'loader',
      width: 140,
      render: (_: unknown, r: Deal) =>
        (r.loadingAssignee?.fullName ? <Tag color="cyan">{r.loadingAssignee.fullName}</Tag> : '—'),
    },
    {
      title: 'Товары',
      key: 'items',
      render: (_: unknown, r: Deal) => <Badge count={r.items?.length ?? 0} showZero style={{ backgroundColor: '#52c41a' }} />,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 100,
      render: (s: Deal['status']) => <DealStatusTag status={s} />,
    },
    {
      title: 'Закрыта',
      dataIndex: 'updatedAt',
      width: 120,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
    },
  ];

  return (
    <div style={{ padding: isMobile ? 12 : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <BackButton fallback="/dashboard" />
          <Typography.Title level={4} style={{ margin: 0 }}>
            <TruckOutlined style={{ marginRight: 8 }} />
            Отгрузки и закрытые
          </Typography.Title>
        </Space>
      </div>

      <Tabs
        activeKey={mainTab}
        onChange={(k) => setMainTab(k as 'shipments' | 'closed')}
        items={[
          {
            key: 'shipments',
            label: (
              <span>
                Накладные
                {pagination?.total != null ? (
                  <Tag style={{ marginLeft: 8 }}>{pagination.total}</Tag>
                ) : null}
              </span>
            ),
            children: (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Input.Search
                    placeholder="Поиск по накладной, клиенту, транспорту..."
                    style={{ width: isMobile ? '100%' : 350 }}
                    allowClear
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Table
                  dataSource={filteredShipments}
                  columns={columns}
                  rowKey="id"
                  loading={isLoading}
                  scroll={{ x: 600 }}
                  pagination={{
                    current: page,
                    pageSize: limit,
                    total: pagination?.total,
                    showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
                    showSizeChanger: true,
                    pageSizeOptions: ['20', '50', '100'],
                    onChange: (newPage, newPageSize) => {
                      setPage(newPage);
                      setLimit(newPageSize || limit);
                    },
                  }}
                  size="middle"
                  bordered={false}
                  locale={{ emptyText: 'Нет накладных' }}
                  onRow={(record) => ({
                    style: { cursor: 'pointer' },
                    onClick: () => openDetail(record),
                  })}
                />
              </>
            ),
          },
          {
            key: 'closed',
            label: (
              <span>
                Все закрытые
                {closedPagination?.total != null ? (
                  <Tag style={{ marginLeft: 8 }}>{closedPagination.total}</Tag>
                ) : null}
              </span>
            ),
            children: (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Input.Search
                    placeholder="Поиск по сделке, клиенту, менеджеру..."
                    style={{ width: isMobile ? '100%' : 350 }}
                    allowClear
                    value={closedSearch}
                    onChange={(e) => setClosedSearch(e.target.value)}
                  />
                </div>
                <Table
                  dataSource={filteredClosed}
                  columns={closedColumns}
                  rowKey="id"
                  loading={closedLoading}
                  scroll={{ x: 900 }}
                  pagination={false}
                  size="middle"
                  bordered={false}
                  locale={{ emptyText: 'Нет закрытых сделок' }}
                  expandable={{
                    expandedRowRender: (record: Deal) => {
                      const items = record.items ?? [];
                      if (items.length === 0) return <Typography.Text type="secondary">Нет позиций</Typography.Text>;
                      return (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {items.map((it) => (
                            <li key={it.id}>
                              {it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}
                            </li>
                          ))}
                        </ul>
                      );
                    },
                  }}
                  onRow={(record) => ({
                    style: { cursor: 'pointer' },
                    onClick: () => openDetail(record),
                  })}
                />
                {closedPagination && closedPagination.pages > 1 && (
                  <div style={{ textAlign: 'center', marginTop: 12 }}>
                    <Pagination
                      current={closedPage}
                      total={closedPagination.total}
                      pageSize={50}
                      onChange={(p) => setClosedPage(p)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </>
            ),
          },
        ]}
      />

      {/* Detail Drawer */}
      <Drawer
        title={
          <Space>
            <TruckOutlined />
            {selectedDeal?.shipment?.deliveryNoteNumber ? `Накладная ${selectedDeal.shipment.deliveryNoteNumber}` : 'Детали накладной'}
          </Space>
        }
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedDeal(null);
        }}
        width={isMobile ? '100%' : 600}
        loading={detailLoading}
      >
        {dealDetail && (
          <div>
            <Card size="small" style={{ marginBottom: 16 }}>
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="Сделка">
                  <Link to={`/deals/${dealDetail.id}`}>{dealDetail.title}</Link>
                </Descriptions.Item>
                <Descriptions.Item label="Клиент">
                  <Link to={`/clients/${dealDetail.clientId}`}>{dealDetail.client?.companyName}</Link>
                </Descriptions.Item>
                <Descriptions.Item label="Сумма">
                  {formatUZS(dealDetail.amount)}
                </Descriptions.Item>
                <Descriptions.Item label="Менеджер">
                  {dealDetail.manager?.fullName}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {dealDetail.shipment && (
              <Card title="Данные накладной" size="small" style={{ marginBottom: 16 }}>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="Номер накладной">
                    <Tag color="blue">{dealDetail.shipment.deliveryNoteNumber}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Транспорт">
                    <Space>
                      <Tag icon={<TruckOutlined />}>{dealDetail.shipment.vehicleNumber}</Tag>
                      <span>({dealDetail.shipment.vehicleType})</span>
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="Водитель">
                    <Space>
                      <UserOutlined />
                      {dealDetail.shipment.driverName}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="Время отправки">
                    <Space>
                      <ClockCircleOutlined />
                      {dayjs(dealDetail.shipment.departureTime).format('DD.MM.YYYY HH:mm')}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="Отгружено">
                    {dayjs(dealDetail.shipment.shippedAt).format('DD.MM.YYYY HH:mm')}
                  </Descriptions.Item>
                  <Descriptions.Item label="Отгрузил">
                    {dealDetail.shipment.user?.fullName}
                  </Descriptions.Item>
                  {dealDetail.shipment.shipmentComment && (
                    <Descriptions.Item label="Комментарий">
                      {dealDetail.shipment.shipmentComment}
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </Card>
            )}

            {dealDetail.items && dealDetail.items.length > 0 && (
              <Card title={`Товары (${dealDetail.items.length})`} size="small">
                <Table
                  dataSource={dealDetail.items}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  columns={[
                    {
                      title: 'Товар',
                      dataIndex: ['product', 'name'],
                    },
                    {
                      title: 'Артикул',
                      dataIndex: ['product', 'sku'],
                      render: (v: string) => <Tag>{v}</Tag>,
                    },
                    {
                      title: 'Количество',
                      dataIndex: 'requestedQty',
                      align: 'right' as const,
                      render: (v: number | null) => {
                        if (v == null) return '—';
                        const n = Number(v);
                        return Number.isInteger(n) ? n.toString() : parseFloat(n.toFixed(3)).toString();
                      },
                    },
                  ]}
                />
              </Card>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}