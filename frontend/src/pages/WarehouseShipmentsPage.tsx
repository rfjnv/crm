import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Table, Typography, Tag, Space, Drawer, Descriptions, Badge, Card,
  Button, Input, Tabs, Pagination, Select, DatePicker,
} from 'antd';
import type { Dayjs } from 'dayjs';
import { TruckOutlined, UserOutlined, ClockCircleOutlined, PrinterOutlined } from '@ant-design/icons';
import DealStatusTag from '../components/DealStatusTag';
import { dealsApi } from '../api/deals.api';
import { usersApi } from '../api/users.api';
import { settingsApi } from '../api/settings.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import type { Deal, PaymentStatus } from '../types';
import dayjs from 'dayjs';
import { tashkentYmd, addDaysToTashkentYmd, isoRangeForTashkentYmd } from '../utils/tashkentCalendar';
import { printDealWaybillA5 } from '../utils/waybillPrintA5';

type WarehouseMainTab = 'closedToday' | 'closedYesterday' | 'closedAll';

/** Период закрытия для API «Все закрытые» (границы дня по Ташкенту). */
function closedRangeToApiParams(range: [Dayjs, Dayjs] | null): { closedFrom?: string; closedTo?: string } {
  if (!range?.[0] || !range[1]) return {};
  const pad = (n: number) => String(n).padStart(2, '0');
  const toIsoDay = (ymd: string, endOfDay: boolean) => {
    const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
    const iso = endOfDay
      ? `${y}-${pad(m)}-${pad(d)}T23:59:59.999+05:00`
      : `${y}-${pad(m)}-${pad(d)}T00:00:00.000+05:00`;
    return new Date(iso).toISOString();
  };
  const a = range[0].format('YYYY-MM-DD');
  const b = range[1].format('YYYY-MM-DD');
  return { closedFrom: toIsoDay(a, false), closedTo: toIsoDay(b, true) };
}

function expandedItemsRow(record: Deal) {
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
}

export default function WarehouseShipmentsPage() {
  const isMobile = useIsMobile();
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mainTab, setMainTab] = useState<WarehouseMainTab>('closedToday');
  const [closedPage, setClosedPage] = useState(1);
  const [closedTodayPage, setClosedTodayPage] = useState(1);
  const [closedYesterdayPage, setClosedYesterdayPage] = useState(1);
  const [closedSearch, setClosedSearch] = useState('');
  const [closedAllSearch, setClosedAllSearch] = useState('');
  const [closedAllPayment, setClosedAllPayment] = useState<PaymentStatus | 'all'>('all');
  const [closedAllManagerId, setClosedAllManagerId] = useState<string | undefined>(undefined);
  const [closedAllDateRange, setClosedAllDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  const yesterdayYmd = addDaysToTashkentYmd(tashkentYmd(), -1);
  const yesterdayBounds = isoRangeForTashkentYmd(yesterdayYmd);

  const closedAllApiOpts = useMemo(() => {
    const rangeParams = closedRangeToApiParams(closedAllDateRange);
    const q = closedAllSearch.trim();
    return {
      paymentStatus: closedAllPayment === 'all' ? undefined : closedAllPayment,
      managerId: closedAllManagerId,
      ...rangeParams,
      ...(q ? { q } : {}),
    };
  }, [closedAllPayment, closedAllManagerId, closedAllDateRange, closedAllSearch]);

  useEffect(() => {
    setClosedPage(1);
  }, [closedAllPayment, closedAllManagerId, closedAllDateRange, closedAllSearch]);

  useEffect(() => {
    setClosedTodayPage(1);
    setClosedYesterdayPage(1);
  }, [closedSearch]);

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.getCompanySettings,
  });

  const { data: usersForFilters } = useQuery({
    queryKey: ['users-list-warehouse-closed'],
    queryFn: usersApi.list,
    enabled: mainTab === 'closedAll',
  });

  const warehouseManagers = useMemo(() => {
    if (!usersForFilters) return [];
    return usersForFilters
      .filter((u: { role: string; isActive: boolean }) =>
        ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'].includes(u.role) && u.isActive,
      )
      .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName }));
  }, [usersForFilters]);

  const { data: dealDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['deal-detail', selectedDeal?.id],
    queryFn: () => dealsApi.getById(selectedDeal!.id),
    enabled: !!selectedDeal?.id,
  });

  const { data: closedResult, isLoading: closedLoading } = useQuery({
    queryKey: ['closed-deals', closedPage, closedAllApiOpts],
    queryFn: () => dealsApi.closedDeals(closedPage, 50, closedAllApiOpts),
    enabled: mainTab === 'closedAll',
    refetchInterval: 30_000,
  });

  const { data: closedTodayResult, isLoading: closedTodayLoading } = useQuery({
    queryKey: ['warehouse-closed-today', closedTodayPage],
    queryFn: () => dealsApi.closedDeals(closedTodayPage, 50, { todayOnly: true }),
    enabled: mainTab === 'closedToday',
    refetchInterval: 30_000,
  });

  const { data: closedYesterdayResult, isLoading: closedYesterdayLoading } = useQuery({
    queryKey: ['warehouse-closed-yesterday', closedYesterdayPage, yesterdayYmd],
    queryFn: () => dealsApi.closedDeals(closedYesterdayPage, 50, {
      closedFrom: yesterdayBounds.closedFrom,
      closedTo: yesterdayBounds.closedTo,
    }),
    enabled: mainTab === 'closedYesterday',
    refetchInterval: 30_000,
  });

  const closedDeals = closedResult?.data ?? [];
  const closedPagination = closedResult?.pagination;

  const closedTodayDeals = closedTodayResult?.data ?? [];
  const closedTodayPagination = closedTodayResult?.pagination;

  const closedYesterdayDeals = closedYesterdayResult?.data ?? [];
  const closedYesterdayPagination = closedYesterdayResult?.pagination;

  const filterClosedList = (deals: Deal[]) => {
    if (!closedSearch) return deals;
    const q = closedSearch.toLowerCase();
    return deals.filter((deal) => (
      deal.title.toLowerCase().includes(q) ||
      (deal.client?.companyName ?? '').toLowerCase().includes(q) ||
      (deal.manager?.fullName ?? '').toLowerCase().includes(q)
    ));
  };

  const filteredClosedToday = filterClosedList(closedTodayDeals);
  const filteredClosedYesterday = filterClosedList(closedYesterdayDeals);

  const resetClosedAllFilters = () => {
    setClosedAllSearch('');
    setClosedAllPayment('all');
    setClosedAllManagerId(undefined);
    setClosedAllDateRange(null);
    setClosedPage(1);
  };

  const openDetail = (deal: Deal) => {
    setSelectedDeal(deal);
    setDrawerOpen(true);
  };

  const closedColumns = useMemo(() => {
    const deliveryLabels: Record<string, string> = { SELF_PICKUP: 'Самовывоз', YANDEX: 'Яндекс', DELIVERY: 'Доставка' };
    return [
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
        key: 'closedAt',
        width: 120,
        render: (_: unknown, r: Deal) =>
          r.closedAt ? dayjs(r.closedAt).format('DD.MM.YYYY HH:mm') : '—',
      },
      {
        title: '',
        key: 'print',
        width: 48,
        render: (_: unknown, r: Deal) => (
          <Button
            type="text"
            size="small"
            icon={<PrinterOutlined />}
            aria-label="Распечатать накладную"
            onClick={(e) => {
              e.stopPropagation();
              printDealWaybillA5(r, companySettings ?? null);
            }}
          />
        ),
      },
    ];
  }, [companySettings]);

  const closedTableCommon = {
    columns: closedColumns,
    rowKey: 'id' as const,
    pagination: false as const,
    size: 'middle' as const,
    bordered: false as const,
    expandable: {
      expandedRowRender: (record: Deal) => expandedItemsRow(record),
    },
    onRow: (record: Deal) => ({
      style: { cursor: 'pointer' as const },
      onClick: () => openDetail(record),
    }),
  };

  return (
    <div style={{ padding: isMobile ? 12 : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <BackButton fallback="/dashboard" />
          <Typography.Title level={4} style={{ margin: 0 }}>
            <TruckOutlined style={{ marginRight: 8 }} />
            Накладные: закрытые
          </Typography.Title>
        </Space>
      </div>

      <Tabs
        activeKey={mainTab}
        onChange={(k) => setMainTab(k as WarehouseMainTab)}
        items={[
          {
            key: 'closedToday',
            label: (
              <span>
                Закрыты сегодня
                {closedTodayPagination?.total != null ? (
                  <Tag style={{ marginLeft: 8 }}>{closedTodayPagination.total}</Tag>
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
                  {...closedTableCommon}
                  dataSource={filteredClosedToday}
                  loading={closedTodayLoading}
                  scroll={{ x: 960 }}
                  locale={{ emptyText: 'Нет сделок, закрытых сегодня (Ташкент)' }}
                />
                {closedTodayPagination && closedTodayPagination.pages > 1 && (
                  <div style={{ textAlign: 'center', marginTop: 12 }}>
                    <Pagination
                      current={closedTodayPage}
                      total={closedTodayPagination.total}
                      pageSize={50}
                      onChange={(p) => setClosedTodayPage(p)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </>
            ),
          },
          {
            key: 'closedYesterday',
            label: (
              <span>
                Закрыты вчера
                {closedYesterdayPagination?.total != null ? (
                  <Tag style={{ marginLeft: 8 }}>{closedYesterdayPagination.total}</Tag>
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
                  {...closedTableCommon}
                  dataSource={filteredClosedYesterday}
                  loading={closedYesterdayLoading}
                  scroll={{ x: 960 }}
                  locale={{ emptyText: 'Нет сделок, закрытых вчера (Ташкент)' }}
                />
                {closedYesterdayPagination && closedYesterdayPagination.pages > 1 && (
                  <div style={{ textAlign: 'center', marginTop: 12 }}>
                    <Pagination
                      current={closedYesterdayPage}
                      total={closedYesterdayPagination.total}
                      pageSize={50}
                      onChange={(p) => setClosedYesterdayPage(p)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </>
            ),
          },
          {
            key: 'closedAll',
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
                <Space direction="vertical" size="middle" style={{ width: '100%', marginBottom: 12 }}>
                  <Space wrap style={{ width: '100%' }} align="start">
                    <Select<PaymentStatus | 'all'>
                      value={closedAllPayment}
                      onChange={setClosedAllPayment}
                      style={{ width: isMobile ? '100%' : 200 }}
                      options={[
                        { value: 'all', label: 'Оплата: все' },
                        { value: 'UNPAID', label: 'Не оплачено' },
                        { value: 'PARTIAL', label: 'Частично' },
                        { value: 'PAID', label: 'Оплачено' },
                      ]}
                    />
                    <Select
                      allowClear
                      placeholder="Менеджер"
                      style={{ width: isMobile ? '100%' : 220 }}
                      value={closedAllManagerId}
                      onChange={setClosedAllManagerId}
                      options={warehouseManagers}
                    />
                    <DatePicker.RangePicker
                      value={closedAllDateRange}
                      onChange={(r) => setClosedAllDateRange(r as [Dayjs, Dayjs] | null)}
                      format="DD.MM.YYYY"
                      allowClear
                      placeholder={['Закрыта с', 'по']}
                    />
                    <Button onClick={resetClosedAllFilters}>Сбросить фильтры</Button>
                  </Space>
                  <Input.Search
                    placeholder="Поиск: сделка, клиент, менеджер..."
                    style={{ width: isMobile ? '100%' : 400 }}
                    allowClear
                    value={closedAllSearch}
                    onChange={(e) => setClosedAllSearch(e.target.value)}
                  />
                </Space>
                <Table
                  {...closedTableCommon}
                  dataSource={closedDeals}
                  loading={closedLoading}
                  scroll={{ x: 960 }}
                  locale={{ emptyText: 'Нет закрытых сделок по фильтрам' }}
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

      <Drawer
        title={
          <Space>
            <TruckOutlined />
            {selectedDeal?.shipment?.deliveryNoteNumber ? `Накладная ${selectedDeal.shipment.deliveryNoteNumber}` : 'Детали накладной'}
          </Space>
        }
        extra={
          dealDetail ? (
            <Button
              type="primary"
              icon={<PrinterOutlined />}
              onClick={() => printDealWaybillA5(dealDetail, companySettings ?? null)}
            >
              Распечатать накладную
            </Button>
          ) : undefined
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
                  <ClientCompanyDisplay client={dealDetail.client} link variant="full" />
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
