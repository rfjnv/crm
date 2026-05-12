import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  InputNumber,
  List,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tabs,
  Typography,
} from 'antd';
import { ReloadOutlined, SoundOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { APP_INPUT } from '../components/ui/AppClassNames';
import { useIsMobile } from '../hooks/useIsMobile';
import { matchesSearch, smartFilterOption } from '../utils/translit';
import type {
  ReanimationClientDetail,
  ReanimationClientProductStat,
  ReanimationClientRow,
  ReanimationProductPreview,
  ReanimationStatus,
} from '../types';

const { Title, Text, Paragraph } = Typography;

const CANDIDATE_STATUSES: ReanimationStatus[] = ['ONE_TIME_LOST', 'SLEEPING', 'CHURNED'];

const STATUS_META: Record<ReanimationStatus, { label: string; color: string }> = {
  ACTIVE: { label: 'Активный', color: 'default' },
  ONE_TIME_LOST: { label: 'Раз купил и пропал', color: 'orange' },
  SLEEPING: { label: 'Повторный, но уснул', color: 'gold' },
  CHURNED: { label: 'Перестал покупать', color: 'red' },
};

function formatMoney(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return dayjs(value).format('DD.MM.YYYY');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return dayjs(value).format('DD.MM.YYYY HH:mm');
}

function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${value} дн.`;
}

function buildSearchHaystack(row: ReanimationClientRow) {
  return [
    row.companyName,
    row.contactName,
    row.phone || '',
    row.email || '',
    row.managerName,
    row.managerDepartment || '',
    row.productNames.join(' '),
    row.lastDeal?.title || '',
    row.lastContactPreview || '',
  ].join(' ');
}

function renderProductButtons(
  items: ReanimationProductPreview[],
  navigate: ReturnType<typeof useNavigate>,
  emptyLabel: string,
) {
  if (items.length === 0) {
    return <Text type="secondary">{emptyLabel}</Text>;
  }
  return (
    <Space size={[4, 4]} wrap>
      {items.map((item) => (
        <Tag
          key={`${item.productId}-${item.productName}`}
          style={{ cursor: 'pointer', marginInlineEnd: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/inventory/products/${item.productId}`);
          }}
        >
          {item.productName}
        </Tag>
      ))}
    </Space>
  );
}

export default function ReanimationPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState<ReanimationStatus[]>(CANDIDATE_STATUSES);
  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [productNames, setProductNames] = useState<string[]>([]);
  const [debtFilter, setDebtFilter] = useState<'all' | 'with_debt' | 'without_debt'>('all');
  const [contactFilter, setContactFilter] = useState<'all' | 'no_contact' | 'stale_7' | 'stale_30'>('all');
  const [sortBy, setSortBy] = useState<
    'inactive_desc' | 'inactive_asc' | 'revenue_desc' | 'deals_desc' | 'debt_desc' | 'contact_oldest'
  >('inactive_desc');
  const [minDays, setMinDays] = useState<number | null>(30);
  const [maxDays, setMaxDays] = useState<number | null>(null);
  const [drawerClientId, setDrawerClientId] = useState<string | null>(null);

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['analytics-reanimation'],
    queryFn: analyticsApi.getReanimationClients,
    staleTime: 120_000,
  });

  const drawerQuery = useQuery({
    queryKey: ['analytics-reanimation-detail', drawerClientId],
    queryFn: () => analyticsApi.getReanimationClientDetail(drawerClientId!),
    enabled: Boolean(drawerClientId),
    staleTime: 60_000,
  });

  const managerOptions = useMemo(
    () =>
      Array.from(
        new Map(
          data.map((row) => [row.managerId, { label: row.managerName, value: row.managerId }]),
        ).values(),
      ).sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    [data],
  );

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(data.map((row) => (row.managerDepartment || '').trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .map((value) => ({ label: value, value })),
    [data],
  );

  const productOptions = useMemo(
    () =>
      Array.from(new Set(data.flatMap((row) => row.productNames).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .map((value) => ({ label: value, value })),
    [data],
  );

  const filteredRows = useMemo(() => {
    let rows = [...data];
    const query = search.trim();

    if (statuses.length > 0) {
      rows = rows.filter((row) => statuses.includes(row.status));
    }
    if (managerIds.length > 0) {
      rows = rows.filter((row) => managerIds.includes(row.managerId));
    }
    if (departments.length > 0) {
      rows = rows.filter((row) => row.managerDepartment && departments.includes(row.managerDepartment));
    }
    if (productNames.length > 0) {
      rows = rows.filter((row) => productNames.every((productName) => row.productNames.includes(productName)));
    }
    if (debtFilter === 'with_debt') {
      rows = rows.filter((row) => row.currentDebt > 0);
    }
    if (debtFilter === 'without_debt') {
      rows = rows.filter((row) => row.currentDebt <= 0);
    }
    if (contactFilter === 'no_contact') {
      rows = rows.filter((row) => !row.lastContactAt);
    }
    if (contactFilter === 'stale_7') {
      rows = rows.filter((row) => (row.daysSinceLastContact ?? Number.POSITIVE_INFINITY) >= 7);
    }
    if (contactFilter === 'stale_30') {
      rows = rows.filter((row) => (row.daysSinceLastContact ?? Number.POSITIVE_INFINITY) >= 30);
    }
    if (minDays !== null) {
      rows = rows.filter((row) => (row.daysSinceLastPurchase ?? 0) >= minDays);
    }
    if (maxDays !== null) {
      rows = rows.filter((row) => (row.daysSinceLastPurchase ?? 0) <= maxDays);
    }
    if (query) {
      rows = rows.filter((row) => matchesSearch(buildSearchHaystack(row), query));
    }

    rows.sort((a, b) => {
      if (sortBy === 'inactive_desc') return (b.daysSinceLastPurchase ?? 0) - (a.daysSinceLastPurchase ?? 0);
      if (sortBy === 'inactive_asc') return (a.daysSinceLastPurchase ?? 0) - (b.daysSinceLastPurchase ?? 0);
      if (sortBy === 'revenue_desc') return b.totalRevenue - a.totalRevenue;
      if (sortBy === 'deals_desc') return b.closedDealsCount - a.closedDealsCount;
      if (sortBy === 'debt_desc') return b.currentDebt - a.currentDebt;
      return (b.daysSinceLastContact ?? Number.POSITIVE_INFINITY) - (a.daysSinceLastContact ?? Number.POSITIVE_INFINITY);
    });

    return rows;
  }, [contactFilter, data, debtFilter, departments, managerIds, maxDays, minDays, productNames, search, sortBy, statuses]);

  const allCandidates = useMemo(
    () => data.filter((row) => CANDIDATE_STATUSES.includes(row.status)),
    [data],
  );

  const summary = useMemo(() => {
    const visible = filteredRows;
    const lostSingle = visible.filter((row) => row.status === 'ONE_TIME_LOST').length;
    const sleeping = visible.filter((row) => row.status === 'SLEEPING').length;
    const churned = visible.filter((row) => row.status === 'CHURNED').length;
    const withDebt = visible.filter((row) => row.currentDebt > 0).length;
    return { visible: visible.length, lostSingle, sleeping, churned, withDebt };
  }, [filteredRows]);

  const resetFilters = () => {
    setSearch('');
    setStatuses(CANDIDATE_STATUSES);
    setManagerIds([]);
    setDepartments([]);
    setProductNames([]);
    setDebtFilter('all');
    setContactFilter('all');
    setSortBy('inactive_desc');
    setMinDays(30);
    setMaxDays(null);
  };

  const columns = [
    {
      title: 'Клиент',
      key: 'client',
      fixed: 'left' as const,
      width: 270,
      render: (_: unknown, row: ReanimationClientRow) => (
        <div>
          <ClientCompanyDisplay
            client={{
              id: row.clientId,
              companyName: row.companyName,
              isSvip: row.isSvip,
              creditStatus: row.creditStatus,
            }}
            variant="full"
          />
          <div style={{ marginTop: 4 }}>
            <Text type="secondary">{row.contactName}</Text>
          </div>
          <div style={{ marginTop: 2 }}>
            <Space size={8} wrap>
              {row.phone ? <Text type="secondary">{row.phone}</Text> : null}
              {row.email ? <Text type="secondary">{row.email}</Text> : null}
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 170,
      render: (value: ReanimationStatus) => (
        <Tag color={STATUS_META[value].color}>{STATUS_META[value].label}</Tag>
      ),
    },
    {
      title: 'Менеджер',
      key: 'manager',
      width: 180,
      render: (_: unknown, row: ReanimationClientRow) => (
        <div>
          <div>{row.managerName}</div>
          <Text type="secondary">{row.managerDepartment || '—'}</Text>
        </div>
      ),
    },
    {
      title: 'Последняя покупка',
      key: 'lastPurchase',
      width: 150,
      render: (_: unknown, row: ReanimationClientRow) => (
        <div>
          <div>{formatDate(row.lastPurchaseAt)}</div>
          <Text type="secondary">{formatDays(row.daysSinceLastPurchase)}</Text>
        </div>
      ),
    },
    {
      title: 'Последний контакт',
      key: 'lastContact',
      width: 190,
      render: (_: unknown, row: ReanimationClientRow) => (
        <div>
          <div>{formatDateTime(row.lastContactAt)}</div>
          <Text type="secondary">
            {row.lastContactByName || 'Без заметок'}
            {row.daysSinceLastContact !== null && row.daysSinceLastContact !== undefined
              ? ` • ${formatDays(row.daysSinceLastContact)}`
              : ''}
          </Text>
        </div>
      ),
    },
    {
      title: 'Сделок',
      dataIndex: 'closedDealsCount',
      width: 90,
      align: 'right' as const,
    },
    {
      title: 'Выручка',
      dataIndex: 'totalRevenue',
      width: 130,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Долг',
      dataIndex: 'currentDebt',
      width: 130,
      align: 'right' as const,
      render: (value: number) => (
        <Text type={value > 0 ? 'danger' : 'secondary'}>{formatMoney(value)}</Text>
      ),
    },
    {
      title: 'Последняя сделка',
      key: 'lastDeal',
      width: 220,
      render: (_: unknown, row: ReanimationClientRow) =>
        row.lastDeal ? (
          <div>
            <Button
              type="link"
              style={{ padding: 0, height: 'auto' }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/deals/${row.lastDeal!.dealId}`);
              }}
            >
              {row.lastDeal.title}
            </Button>
            <div>
              <Text type="secondary">
                {formatDate(row.lastDeal.effectiveAt)} • {formatMoney(row.lastDeal.revenue)}
              </Text>
            </div>
          </div>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Товары',
      key: 'products',
      width: 340,
      render: (_: unknown, row: ReanimationClientRow) => (
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Последний заказ</Text>
            <div style={{ marginTop: 4 }}>
              {renderProductButtons(row.lastDealProducts, navigate, 'Нет данных')}
            </div>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Хит-товары</Text>
            <div style={{ marginTop: 4 }}>
              {renderProductButtons(row.topProducts, navigate, 'Нет данных')}
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: '',
      key: 'actions',
      fixed: 'right' as const,
      width: 150,
      render: (_: unknown, row: ReanimationClientRow) => (
        <Space>
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setDrawerClientId(row.clientId);
            }}
          >
            Внутри страницы
          </Button>
          <Button
            size="small"
            type="link"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/clients/${row.clientId}`);
            }}
          >
            Карточка
          </Button>
        </Space>
      ),
    },
  ];

  const drawerData = drawerQuery.data as ReanimationClientDetail | undefined;

  const productStatColumns = [
    { title: 'Товар', dataIndex: 'productName', key: 'productName', ellipsis: true },
    { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 90, align: 'right' as const },
    { title: 'Кол-во', dataIndex: 'totalQty', key: 'totalQty', width: 110, align: 'right' as const },
    {
      title: 'Выручка',
      dataIndex: 'totalRevenue',
      key: 'totalRevenue',
      width: 130,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Последняя покупка',
      dataIndex: 'lastPurchasedAt',
      key: 'lastPurchasedAt',
      width: 140,
      render: (value: string) => formatDate(value),
    },
  ];

  const recentDealColumns = [
    { title: 'Сделка', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: 'Дата',
      dataIndex: 'effectiveAt',
      key: 'effectiveAt',
      width: 130,
      render: (value: string) => formatDate(value),
    },
    {
      title: 'Выручка',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 120,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Оплачено',
      dataIndex: 'paidAmount',
      key: 'paidAmount',
      width: 120,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    { title: 'Статус оплаты', dataIndex: 'paymentStatus', key: 'paymentStatus', width: 140 },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Title level={4} style={{ margin: 0 }}>
            <SoundOutlined style={{ marginRight: 8 }} />
            Реанимация клиентов
          </Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
            Одна страница для поиска клиентов, которые купили один раз и пропали или перестали покупать. Все ключевые данные, товары и последние сделки доступны без выхода со страницы.
          </Paragraph>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
            Обновить
          </Button>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Кандидаты" value={summary.visible} suffix={`/ ${allCandidates.length}`} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Разовые пропали" value={summary.lostSingle} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Повторные уснули" value={summary.sleeping} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="С долгом" value={summary.withDebt} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Фильтры" style={{ marginBottom: 12 }}>
        <Row gutter={[10, 10]}>
          <Col xs={24} md={12} xl={8}>
            <Input.Search
              className={APP_INPUT}
              allowClear
              placeholder="Клиент, контакт, телефон, товар, сделка..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onSearch={(value) => setSearch(value)}
            />
          </Col>
          <Col xs={24} md={12} xl={8}>
            <Select
              mode="multiple"
              allowClear
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Статус реанимации"
              value={statuses}
              onChange={(value) => setStatuses(value as ReanimationStatus[])}
              options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
              maxTagCount={2}
            />
          </Col>
          <Col xs={24} md={12} xl={8}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={smartFilterOption}
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Менеджеры"
              value={managerIds}
              onChange={(value) => setManagerIds(value)}
              options={managerOptions}
              maxTagCount={2}
            />
          </Col>
          <Col xs={24} md={12} xl={8}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={smartFilterOption}
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Отдел"
              value={departments}
              onChange={(value) => setDepartments(value)}
              options={departmentOptions}
              maxTagCount={2}
            />
          </Col>
          <Col xs={24} md={12} xl={8}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={smartFilterOption}
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Товары"
              value={productNames}
              onChange={(value) => setProductNames(value)}
              options={productOptions}
              maxTagCount={2}
            />
          </Col>
          <Col xs={12} md={6} xl={4}>
            <InputNumber
              className={APP_INPUT}
              style={{ width: '100%' }}
              min={0}
              value={minDays}
              onChange={(value) => setMinDays(typeof value === 'number' ? value : null)}
              placeholder="От, дней"
            />
          </Col>
          <Col xs={12} md={6} xl={4}>
            <InputNumber
              className={APP_INPUT}
              style={{ width: '100%' }}
              min={0}
              value={maxDays}
              onChange={(value) => setMaxDays(typeof value === 'number' ? value : null)}
              placeholder="До, дней"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Select
              className={APP_INPUT}
              style={{ width: '100%' }}
              value={debtFilter}
              onChange={(value) => setDebtFilter(value)}
              options={[
                { value: 'all', label: 'Долг: все' },
                { value: 'with_debt', label: 'Только с долгом' },
                { value: 'without_debt', label: 'Без долга / переплата' },
              ]}
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Select
              className={APP_INPUT}
              style={{ width: '100%' }}
              value={contactFilter}
              onChange={(value) => setContactFilter(value)}
              options={[
                { value: 'all', label: 'Контакты: все' },
                { value: 'no_contact', label: 'Без заметок' },
                { value: 'stale_7', label: 'Контакт не был 7+ дней' },
                { value: 'stale_30', label: 'Контакт не был 30+ дней' },
              ]}
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Select
              className={APP_INPUT}
              style={{ width: '100%' }}
              value={sortBy}
              onChange={(value) => setSortBy(value)}
              options={[
                { value: 'inactive_desc', label: 'Сорт: дольше всего без покупки' },
                { value: 'inactive_asc', label: 'Сорт: ближе к активности' },
                { value: 'revenue_desc', label: 'Сорт: по выручке' },
                { value: 'deals_desc', label: 'Сорт: по числу сделок' },
                { value: 'debt_desc', label: 'Сорт: по долгу' },
                { value: 'contact_oldest', label: 'Сорт: самый старый контакт' },
              ]}
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Button block onClick={resetFilters}>
              Сбросить фильтры
            </Button>
          </Col>
        </Row>
      </Card>

      <Card
        size="small"
        title={`Список клиентов (${filteredRows.length})`}
        extra={<Text type="secondary">По умолчанию показаны только кандидаты на возврат</Text>}
      >
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Text type="secondary">Загрузка данных...</Text>
          </div>
        ) : filteredRows.length === 0 ? (
          <Empty description="По текущим фильтрам клиентов не найдено" />
        ) : (
          <Table
            rowKey="clientId"
            dataSource={filteredRows}
            columns={columns}
            size="small"
            scroll={{ x: 1850 }}
            pagination={{
              defaultPageSize: 25,
              showSizeChanger: true,
              pageSizeOptions: [10, 25, 50, 100],
              showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
            }}
            onRow={(row) => ({
              onClick: () => setDrawerClientId(row.clientId),
              style: { cursor: 'pointer' },
            })}
          />
        )}
      </Card>

      <Drawer
        width={isMobile ? '100%' : 1120}
        open={Boolean(drawerClientId)}
        onClose={() => setDrawerClientId(null)}
        title={drawerData?.client.companyName || 'Карточка клиента'}
      >
        {!drawerClientId || drawerQuery.isLoading || !drawerData ? (
          <div style={{ paddingTop: 24 }}>
            <Text type="secondary">Загрузка деталей...</Text>
          </div>
        ) : (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              <Col xs={24} md={12}>
                <Card size="small">
                  <Descriptions
                    size="small"
                    column={1}
                    items={[
                      {
                        key: 'status',
                        label: 'Статус',
                        children: <Tag color={STATUS_META[drawerData.client.status].color}>{STATUS_META[drawerData.client.status].label}</Tag>,
                      },
                      { key: 'manager', label: 'Менеджер', children: `${drawerData.client.managerName}${drawerData.client.managerDepartment ? ` • ${drawerData.client.managerDepartment}` : ''}` },
                      { key: 'contact', label: 'Контакт', children: drawerData.client.contactName || '—' },
                      { key: 'phone', label: 'Телефон', children: drawerData.client.phone || '—' },
                      { key: 'telegram', label: 'Telegram', children: drawerData.client.email || '—' },
                      { key: 'address', label: 'Адрес', children: drawerData.client.address || '—' },
                      { key: 'purchase', label: 'Последняя покупка', children: `${formatDate(drawerData.client.lastPurchaseAt)} • ${formatDays(drawerData.client.daysSinceLastPurchase)}` },
                      { key: 'contactAt', label: 'Последний контакт', children: `${formatDateTime(drawerData.client.lastContactAt)}${drawerData.client.lastContactByName ? ` • ${drawerData.client.lastContactByName}` : ''}` },
                    ]}
                  />
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Row gutter={[12, 12]}>
                  <Col span={12}>
                    <Card size="small"><Statistic title="Сделок" value={drawerData.client.closedDealsCount} /></Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small"><Statistic title="Активных месяцев" value={drawerData.client.activeMonthsCount} /></Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small"><Statistic title="Выручка" value={drawerData.client.totalRevenue} formatter={(value) => formatMoney(Number(value))} /></Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small"><Statistic title="Средний чек" value={drawerData.client.avgDealAmount} formatter={(value) => formatMoney(Number(value))} /></Card>
                  </Col>
                  <Col span={24}>
                    <Card size="small">
                      <Statistic
                        title="Текущий долг"
                        value={drawerData.client.currentDebt}
                        formatter={(value) => formatMoney(Number(value))}
                        valueStyle={drawerData.client.currentDebt > 0 ? { color: '#cf1322' } : undefined}
                      />
                    </Card>
                  </Col>
                </Row>
              </Col>
            </Row>

            <Card size="small" title="Последний заказ" style={{ marginBottom: 16 }}>
              {drawerData.client.lastDeal ? (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space wrap>
                    <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => navigate(`/deals/${drawerData.client.lastDeal!.dealId}`)}>
                      {drawerData.client.lastDeal.title}
                    </Button>
                    <Text type="secondary">
                      {formatDate(drawerData.client.lastDeal.effectiveAt)} • {formatMoney(drawerData.client.lastDeal.revenue)}
                    </Text>
                  </Space>
                  {renderProductButtons(drawerData.client.lastDealProducts, navigate, 'Товары последней сделки не найдены')}
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Последняя сделка не найдена" />
              )}
            </Card>

            <Tabs
              items={[
                {
                  key: 'products',
                  label: 'Товары',
                  children: (
                    <Table<ReanimationClientProductStat>
                      rowKey="productId"
                      size="small"
                      dataSource={drawerData.productStats}
                      columns={productStatColumns}
                      pagination={{ pageSize: 10, showSizeChanger: false }}
                      onRow={(row) => ({
                        onClick: () => navigate(`/inventory/products/${row.productId}`),
                        style: { cursor: 'pointer' },
                      })}
                    />
                  ),
                },
                {
                  key: 'deals',
                  label: 'Последние сделки',
                  children: (
                    <Table
                      rowKey="dealId"
                      size="small"
                      dataSource={drawerData.recentDeals}
                      columns={recentDealColumns}
                      pagination={{ pageSize: 8, showSizeChanger: false }}
                      onRow={(row) => ({
                        onClick: () => navigate(`/deals/${row.dealId}`),
                        style: { cursor: 'pointer' },
                      })}
                    />
                  ),
                },
                {
                  key: 'notes',
                  label: 'Контакты',
                  children: drawerData.notes.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Заметок по клиенту пока нет" />
                  ) : (
                    <List
                      size="small"
                      dataSource={drawerData.notes}
                      renderItem={(item) => (
                        <List.Item>
                          <div style={{ width: '100%' }}>
                            <Space wrap size={8}>
                              <Text strong>{item.authorName}</Text>
                              <Text type="secondary">{formatDateTime(item.createdAt)}</Text>
                            </Space>
                            <Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
                              {item.preview}
                            </Paragraph>
                          </div>
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
