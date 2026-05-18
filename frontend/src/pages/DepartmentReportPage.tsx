import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Card,
  Col,
  Row,
  Statistic,
  Table,
  Typography,
  Spin,
  Tag,
  Space,
  DatePicker,
  Select,
  Button,
  Progress,
  Tooltip,
  Badge,
  Drawer,
  Descriptions,
  Empty,
  theme,
  Segmented,
} from 'antd';
import {
  ArrowLeftOutlined,
  DollarOutlined,
  RiseOutlined,
  FallOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  UserOutlined,
  FilterOutlined,
  BarChartOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import { analyticsApi, type DepartmentReportClient, type DepartmentReportDeal } from '../api/analytics.api';
import { usersApi } from '../api/users.api';
import { formatUZS } from '../utils/currency';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { matchesSearch } from '../utils/translit';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

type PeriodPreset = 'week' | 'month' | 'quarter' | 'year' | 'custom';
type DebtFilter = 'all' | 'has_debt' | 'fully_paid' | 'no_debt';
type SortOption = 'revenue_desc' | 'debt_desc' | 'client_asc' | 'days_asc';

const PRESET_LABELS: Record<PeriodPreset, string> = {
  week: 'Неделя',
  month: 'Месяц',
  quarter: 'Квартал',
  year: 'Год',
  custom: 'Период',
};

function getPresetRange(preset: PeriodPreset): [string, string] {
  const now = dayjs();
  switch (preset) {
    case 'week':
      return [now.subtract(6, 'day').format('YYYY-MM-DD'), now.format('YYYY-MM-DD')];
    case 'month':
      return [now.subtract(29, 'day').format('YYYY-MM-DD'), now.format('YYYY-MM-DD')];
    case 'quarter':
      return [now.subtract(89, 'day').format('YYYY-MM-DD'), now.format('YYYY-MM-DD')];
    case 'year':
      return [now.subtract(364, 'day').format('YYYY-MM-DD'), now.format('YYYY-MM-DD')];
    default:
      return [now.subtract(29, 'day').format('YYYY-MM-DD'), now.format('YYYY-MM-DD')];
  }
}

function PaymentStatusTag({ status }: { status: string }) {
  if (status === 'PAID') return <Tag color="green" icon={<CheckCircleOutlined />}>Оплачено</Tag>;
  if (status === 'PARTIAL') return <Tag color="orange" icon={<ClockCircleOutlined />}>Частично</Tag>;
  return <Tag color="red" icon={<ExclamationCircleOutlined />}>Не оплачено</Tag>;
}

function CreditStatusTag({ status }: { status: string }) {
  if (status === 'NEGATIVE') return <Tag color="red">Негативный</Tag>;
  if (status === 'SATISFACTORY') return <Tag color="orange">Удовл.</Tag>;
  return <Tag color="green">Нормальный</Tag>;
}

function PaymentMethodTag({ method }: { method: string | null }) {
  const map: Record<string, { color: string; label: string }> = {
    CASH: { color: 'green', label: 'Нал' },
    TRANSFER: { color: 'blue', label: 'Перевод' },
    PAYME: { color: 'cyan', label: 'Payme' },
    QR: { color: 'purple', label: 'QR' },
    CLICK: { color: 'geekblue', label: 'Click' },
    TERMINAL: { color: 'magenta', label: 'Терминал' },
    INSTALLMENT: { color: 'gold', label: 'Рассрочка' },
  };
  if (!method) return <Text type="secondary">—</Text>;
  const cfg = map[method] ?? { color: 'default', label: method };
  return <Tag color={cfg.color}>{cfg.label}</Tag>;
}

export default function DepartmentReportPage() {
  const navigate = useNavigate();
  const { token } = theme.useToken();

  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [managerId, setManagerId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [debtFilter, setDebtFilter] = useState<DebtFilter>('all');
  const [creditFilter, setCreditFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('revenue_desc');
  const [drawerClient, setDrawerClient] = useState<DepartmentReportClient | null>(null);

  const [from, to] = useMemo((): [string, string] => {
    if (preset === 'custom' && customRange) {
      return [customRange[0].format('YYYY-MM-DD'), customRange[1].format('YYYY-MM-DD')];
    }
    return getPresetRange(preset);
  }, [preset, customRange]);

  const { data, isLoading } = useQuery({
    queryKey: ['department-report', from, to, managerId],
    queryFn: () => analyticsApi.getDepartmentReport({ from, to, managerId }),
    enabled: !!from && !!to,
  });

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list(),
  });

  const managers = useMemo(() => {
    if (!users) return [];
    return users
      .filter((u: { role: string; isActive: boolean }) =>
        ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'].includes(u.role) && u.isActive,
      )
      .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName }));
  }, [users]);

  const filteredClients = useMemo(() => {
    if (!data) return [];
    let result = data.clients;

    if (search.trim()) {
      result = result.filter(
        (c) => matchesSearch(c.clientName, search) || matchesSearch(c.managerName, search),
      );
    }

    if (debtFilter === 'has_debt') result = result.filter((c) => c.totalDebt > 0);
    else if (debtFilter === 'fully_paid') result = result.filter((c) => c.totalDebt === 0 && c.dealsWithDebt > 0);
    else if (debtFilter === 'no_debt') result = result.filter((c) => c.dealsWithDebt === 0);

    if (creditFilter.length > 0) {
      result = result.filter((c) => creditFilter.includes(c.creditStatus));
    }

    result = [...result].sort((a, b) => {
      if (sortBy === 'revenue_desc') return b.totalRevenue - a.totalRevenue;
      if (sortBy === 'debt_desc') return b.totalDebt - a.totalDebt;
      if (sortBy === 'client_asc') return a.clientName.localeCompare(b.clientName);
      if (sortBy === 'days_asc') {
        const aD = a.avgDaysToSettle ?? 9999;
        const bD = b.avgDaysToSettle ?? 9999;
        return aD - bD;
      }
      return 0;
    });

    return result;
  }, [data, search, debtFilter, creditFilter, sortBy]);

  const totals = data?.totals;
  const debtRatio = totals && totals.totalRevenue > 0
    ? Math.round((totals.totalDebtIssued / totals.totalRevenue) * 100)
    : 0;
  const returnRatio = totals && totals.totalDebtIssued > 0
    ? Math.round((totals.totalDebtRepaid / totals.totalDebtIssued) * 100)
    : 0;

  const expandedDealColumns = [
    {
      title: 'Сделка',
      key: 'title',
      render: (_: unknown, d: DepartmentReportDeal) => (
        <Button
          type="link"
          style={{ padding: 0, fontWeight: 500 }}
          onClick={() => navigate(`/deals/${d.dealId}`)}
        >
          {d.title}
        </Button>
      ),
    },
    {
      title: 'Сумма',
      key: 'amount',
      width: 140,
      render: (_: unknown, d: DepartmentReportDeal) => (
        <Text strong>{formatUZS(d.amount)}</Text>
      ),
    },
    {
      title: 'Оплачено',
      key: 'paid',
      width: 140,
      render: (_: unknown, d: DepartmentReportDeal) => (
        <Text style={{ color: token.colorSuccess }}>{formatUZS(d.paid)}</Text>
      ),
    },
    {
      title: 'Остаток долга',
      key: 'remaining',
      width: 140,
      render: (_: unknown, d: DepartmentReportDeal) => (
        d.remaining > 0
          ? <Text style={{ color: token.colorError }}>{formatUZS(d.remaining)}</Text>
          : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Статус',
      key: 'status',
      width: 120,
      render: (_: unknown, d: DepartmentReportDeal) => <PaymentStatusTag status={d.paymentStatus} />,
    },
    {
      title: 'Закрыта',
      key: 'closedAt',
      width: 110,
      render: (_: unknown, d: DepartmentReportDeal) =>
        d.closedAt ? dayjs(d.closedAt).format('DD.MM.YYYY') : '—',
    },
    {
      title: 'Долг погашен',
      key: 'settledAt',
      width: 120,
      render: (_: unknown, d: DepartmentReportDeal) =>
        d.debtSettledAt ? (
          <Space size={4}>
            <CheckCircleOutlined style={{ color: token.colorSuccess }} />
            <Text>{dayjs(d.debtSettledAt).format('DD.MM.YYYY')}</Text>
          </Space>
        ) : d.remaining > 0 ? (
          <Tag color="red">Висит</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Дней возврата',
      key: 'days',
      width: 120,
      render: (_: unknown, d: DepartmentReportDeal) =>
        d.daysToSettle !== null ? (
          <Tag color={d.daysToSettle <= 7 ? 'green' : d.daysToSettle <= 30 ? 'orange' : 'red'}>
            {d.daysToSettle} дн.
          </Tag>
        ) : d.remaining > 0 ? (
          <Tag color="red">Не вернул</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  const clientColumns = [
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, c: DepartmentReportClient) => (
        <Space direction="vertical" size={2}>
          <ClientCompanyDisplay
            client={{ id: c.clientId, companyName: c.clientName, isSvip: c.isSvip }}
            link
          />
          <Space size={4}>
            <CreditStatusTag status={c.creditStatus} />
            {c.totalDebt > 0 && (
              <Tag color="red" icon={<ExclamationCircleOutlined />}>Долг</Tag>
            )}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Менеджер',
      key: 'manager',
      width: 150,
      render: (_: unknown, c: DepartmentReportClient) => (
        <Space size={4}>
          <UserOutlined style={{ color: token.colorTextSecondary }} />
          <Text>{c.managerName || '—'}</Text>
        </Space>
      ),
    },
    {
      title: 'Выручка',
      key: 'revenue',
      width: 150,
      sorter: (a: DepartmentReportClient, b: DepartmentReportClient) => a.totalRevenue - b.totalRevenue,
      render: (_: unknown, c: DepartmentReportClient) => (
        <Text strong style={{ color: token.colorPrimary }}>
          {formatUZS(c.totalRevenue)}
        </Text>
      ),
    },
    {
      title: 'Выдано в долг',
      key: 'debt_issued',
      width: 150,
      sorter: (a: DepartmentReportClient, b: DepartmentReportClient) => a.totalDebt - b.totalDebt,
      render: (_: unknown, c: DepartmentReportClient) => (
        c.dealsWithDebt > 0
          ? <Text style={{ color: token.colorWarning }}>{formatUZS(c.totalRevenue - c.totalPaid + c.totalDebt)}</Text>
          : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Остаток долга',
      key: 'remaining',
      width: 150,
      sorter: (a: DepartmentReportClient, b: DepartmentReportClient) => a.totalDebt - b.totalDebt,
      render: (_: unknown, c: DepartmentReportClient) => (
        c.totalDebt > 0
          ? <Text strong style={{ color: token.colorError }}>{formatUZS(c.totalDebt)}</Text>
          : c.dealsFullyPaid > 0
            ? <Tag color="green" icon={<CheckCircleOutlined />}>Погашен</Tag>
            : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Сделки',
      key: 'deals',
      width: 100,
      render: (_: unknown, c: DepartmentReportClient) => (
        <Space direction="vertical" size={0} style={{ textAlign: 'center' }}>
          <Text strong>{c.dealsCount}</Text>
          {c.dealsWithDebt > 0 && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {c.dealsWithDebt} с долгом
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Ср. срок возврата',
      key: 'avg_days',
      width: 140,
      sorter: (a: DepartmentReportClient, b: DepartmentReportClient) =>
        (a.avgDaysToSettle ?? 9999) - (b.avgDaysToSettle ?? 9999),
      render: (_: unknown, c: DepartmentReportClient) =>
        c.avgDaysToSettle !== null ? (
          <Tooltip title="Среднее кол-во дней до полного погашения долга">
            <Tag color={c.avgDaysToSettle <= 7 ? 'green' : c.avgDaysToSettle <= 30 ? 'orange' : 'red'}>
              {c.avgDaysToSettle} дн.
            </Tag>
          </Tooltip>
        ) : c.totalDebt > 0 ? (
          <Tag color="red">Не вернул</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Последний платёж',
      key: 'lastPayment',
      width: 130,
      render: (_: unknown, c: DepartmentReportClient) =>
        c.lastPaymentDate
          ? dayjs(c.lastPaymentDate).format('DD.MM.YYYY')
          : '—',
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, c: DepartmentReportClient) => (
        <Button
          size="small"
          icon={<FileSearchOutlined />}
          onClick={() => setDrawerClient(c)}
        >
          Детали
        </Button>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 0 60px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/analytics')} />
        <div style={{ flex: 1 }}>
          <Title level={4} style={{ margin: 0 }}>
            <BarChartOutlined style={{ marginRight: 8 }} />
            Отчёт отдела
          </Title>
          <Text type="secondary">
            Выручка, долги, возврат — по клиентам за период
          </Text>
        </div>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: 16 }} size="small">
        <Space wrap size={12}>
          <Segmented
            options={Object.entries(PRESET_LABELS).map(([k, v]) => ({ label: v, value: k }))}
            value={preset}
            onChange={(v) => setPreset(v as PeriodPreset)}
          />
          {preset === 'custom' && (
            <RangePicker
              value={customRange}
              onChange={(v) => setCustomRange(v as [Dayjs, Dayjs] | null)}
              format="DD.MM.YYYY"
              allowClear={false}
            />
          )}
          <Select
            placeholder="Менеджер"
            allowClear
            style={{ minWidth: 180 }}
            options={managers}
            value={managerId}
            onChange={setManagerId}
          />
          <Select
            placeholder="Статус долга"
            allowClear
            style={{ minWidth: 160 }}
            value={debtFilter === 'all' ? undefined : debtFilter}
            onChange={(v) => setDebtFilter(v ?? 'all')}
            options={[
              { value: 'has_debt', label: 'Есть долг' },
              { value: 'fully_paid', label: 'Погашен' },
              { value: 'no_debt', label: 'Без долга' },
            ]}
          />
          <Select
            mode="multiple"
            placeholder={<><FilterOutlined /> Кредит. статус</>}
            style={{ minWidth: 180 }}
            value={creditFilter}
            onChange={setCreditFilter}
            options={[
              { value: 'NORMAL', label: 'Нормальный' },
              { value: 'SATISFACTORY', label: 'Удовлетворительный' },
              { value: 'NEGATIVE', label: 'Негативный' },
            ]}
          />
          <Select
            placeholder="Сортировка"
            style={{ minWidth: 180 }}
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: 'revenue_desc', label: 'По выручке ↓' },
              { value: 'debt_desc', label: 'По долгу ↓' },
              { value: 'client_asc', label: 'По клиенту А→Я' },
              { value: 'days_asc', label: 'По сроку возврата ↑' },
            ]}
          />
        </Space>
      </Card>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data ? null : (
        <>
          {/* KPI Cards */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="Выручка за период"
                  value={totals?.totalRevenue ?? 0}
                  formatter={(v) => formatUZS(Number(v))}
                  prefix={<RiseOutlined />}
                  valueStyle={{ color: token.colorPrimary, fontSize: 18 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {totals?.dealsCount} сделок · {totals?.clientCount} клиентов
                </Text>
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="Оплачено (факт)"
                  value={totals?.totalPaid ?? 0}
                  formatter={(v) => formatUZS(Number(v))}
                  prefix={<DollarOutlined />}
                  valueStyle={{ color: token.colorSuccess, fontSize: 18 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {totals && totals.totalRevenue > 0
                    ? Math.round((totals.totalPaid / totals.totalRevenue) * 100)
                    : 0}% от выручки
                </Text>
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="Выдано в долг"
                  value={totals?.totalDebtIssued ?? 0}
                  formatter={(v) => formatUZS(Number(v))}
                  prefix={<FallOutlined />}
                  valueStyle={{ color: token.colorWarning, fontSize: 18 }}
                />
                <div style={{ marginTop: 4 }}>
                  <Progress
                    percent={debtRatio}
                    size="small"
                    strokeColor={token.colorWarning}
                    format={(p) => `${p}% от выр.`}
                  />
                </div>
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="Остаток долга"
                  value={totals?.totalDebtRemaining ?? 0}
                  formatter={(v) => formatUZS(Number(v))}
                  prefix={<ExclamationCircleOutlined />}
                  valueStyle={{
                    color: (totals?.totalDebtRemaining ?? 0) > 0 ? token.colorError : token.colorSuccess,
                    fontSize: 18,
                  }}
                />
                <div style={{ marginTop: 4 }}>
                  <Progress
                    percent={returnRatio}
                    size="small"
                    strokeColor={token.colorSuccess}
                    format={(p) => `${p}% возврат`}
                  />
                </div>
              </Card>
            </Col>
          </Row>

          {/* Summary bar */}
          {totals && totals.totalDebtIssued > 0 && (
            <Card style={{ marginBottom: 16 }} size="small">
              <Space wrap size={16} style={{ width: '100%' }}>
                <Text type="secondary">Возврат долгов:</Text>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Progress
                    percent={returnRatio}
                    strokeColor={token.colorSuccess}
                    trailColor={token.colorErrorBg}
                    format={() =>
                      `${formatUZS(totals.totalDebtRepaid)} из ${formatUZS(totals.totalDebtIssued)}`
                    }
                  />
                </div>
                <Badge
                  count={totals.dealsWithDebt}
                  style={{ backgroundColor: token.colorError }}
                  overflowCount={999}
                />
                <Text type="secondary">сделок с непогашенным долгом</Text>
              </Space>
            </Card>
          )}

          {/* Search */}
          <Card
            size="small"
            style={{ marginBottom: 12 }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <input
              placeholder="Поиск по клиенту или менеджеру..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: 14,
                color: token.colorText,
              }}
            />
          </Card>

          {/* Main Table */}
          {filteredClients.length === 0 ? (
            <Empty description="Нет данных за выбранный период" />
          ) : (
            <Table
              dataSource={filteredClients}
              columns={clientColumns}
              rowKey="clientId"
              size="small"
              pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['15', '25', '50'] }}
              scroll={{ x: 1200 }}
              expandable={{
                expandedRowRender: (c: DepartmentReportClient) => (
                  <div style={{ padding: '12px 0' }}>
                    <Table
                      dataSource={c.deals}
                      columns={expandedDealColumns}
                      rowKey="dealId"
                      size="small"
                      pagination={false}
                      scroll={{ x: 900 }}
                      rowClassName={(d: DepartmentReportDeal) =>
                        d.remaining > 0 ? 'ant-table-row-selected' : ''
                      }
                    />
                  </div>
                ),
                rowExpandable: (c: DepartmentReportClient) => c.deals.length > 0,
              }}
              summary={() =>
                filteredClients.length > 0 ? (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2}>
                      <Text strong>Итого ({filteredClients.length} клиентов)</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2}>
                      <Text strong style={{ color: token.colorPrimary }}>
                        {formatUZS(filteredClients.reduce((s, c) => s + c.totalRevenue, 0))}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3}>
                      <Text strong style={{ color: token.colorWarning }}>
                        {formatUZS(filteredClients.reduce((s, c) => s + (c.totalRevenue - c.totalPaid + c.totalDebt), 0))}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4}>
                      <Text strong style={{ color: token.colorError }}>
                        {formatUZS(filteredClients.reduce((s, c) => s + c.totalDebt, 0))}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} colSpan={3} />
                  </Table.Summary.Row>
                ) : null
              }
            />
          )}
        </>
      )}

      {/* Client Detail Drawer */}
      <Drawer
        open={!!drawerClient}
        onClose={() => setDrawerClient(null)}
        title={
          drawerClient ? (
            <Space>
              <span>{drawerClient.clientName}</span>
              {drawerClient.isSvip && <Tag color="gold">SVIP</Tag>}
            </Space>
          ) : null
        }
        width={760}
        styles={{ body: { padding: 16 } }}
      >
        {drawerClient && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Менеджер">{drawerClient.managerName || '—'}</Descriptions.Item>
              <Descriptions.Item label="Кредит. статус">
                <CreditStatusTag status={drawerClient.creditStatus} />
              </Descriptions.Item>
              <Descriptions.Item label="Выручка">
                <Text strong style={{ color: token.colorPrimary }}>
                  {formatUZS(drawerClient.totalRevenue)}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Оплачено">
                <Text style={{ color: token.colorSuccess }}>{formatUZS(drawerClient.totalPaid)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Остаток долга">
                {drawerClient.totalDebt > 0
                  ? <Text strong style={{ color: token.colorError }}>{formatUZS(drawerClient.totalDebt)}</Text>
                  : <Tag color="green">Погашен</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Ср. срок возврата">
                {drawerClient.avgDaysToSettle !== null
                  ? <Tag color={drawerClient.avgDaysToSettle <= 7 ? 'green' : drawerClient.avgDaysToSettle <= 30 ? 'orange' : 'red'}>
                      {drawerClient.avgDaysToSettle} дн.
                    </Tag>
                  : drawerClient.totalDebt > 0
                    ? <Tag color="red">Не вернул</Tag>
                    : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Сделок" span={2}>
                {drawerClient.dealsCount} ({drawerClient.dealsWithDebt} с долгом, {drawerClient.dealsFullyPaid} погашено)
              </Descriptions.Item>
            </Descriptions>

            <div>
              <Space style={{ marginBottom: 8 }}>
                <Text strong>Сделки клиента</Text>
                <Button
                  size="small"
                  type="link"
                  onClick={() => navigate(`/clients/${drawerClient.clientId}`)}
                >
                  Открыть клиента →
                </Button>
              </Space>
              {drawerClient.deals.map((deal) => (
                <Card
                  key={deal.dealId}
                  size="small"
                  style={{
                    marginBottom: 8,
                    borderLeft: `3px solid ${
                      deal.remaining > 0 ? token.colorError : token.colorSuccess
                    }`,
                  }}
                >
                  <Row gutter={8} align="middle">
                    <Col flex={1}>
                      <Button
                        type="link"
                        style={{ padding: 0, fontWeight: 600 }}
                        onClick={() => navigate(`/deals/${deal.dealId}`)}
                      >
                        {deal.title}
                      </Button>
                    </Col>
                    <Col>
                      <PaymentStatusTag status={deal.paymentStatus} />
                    </Col>
                  </Row>
                  <Row gutter={[16, 4]} style={{ marginTop: 8 }}>
                    <Col span={8}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Сумма</Text>
                      <div><Text strong>{formatUZS(deal.amount)}</Text></div>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Оплачено</Text>
                      <div><Text style={{ color: token.colorSuccess }}>{formatUZS(deal.paid)}</Text></div>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Долг</Text>
                      <div>
                        {deal.remaining > 0
                          ? <Text strong style={{ color: token.colorError }}>{formatUZS(deal.remaining)}</Text>
                          : <Text type="secondary">—</Text>}
                      </div>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Закрыта</Text>
                      <div>{deal.closedAt ? dayjs(deal.closedAt).format('DD.MM.YYYY') : '—'}</div>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Долг погашен</Text>
                      <div>
                        {deal.debtSettledAt
                          ? dayjs(deal.debtSettledAt).format('DD.MM.YYYY')
                          : deal.remaining > 0
                            ? <Text type="danger">Висит</Text>
                            : '—'}
                      </div>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Дней возврата</Text>
                      <div>
                        {deal.daysToSettle !== null
                          ? <Tag color={deal.daysToSettle <= 7 ? 'green' : deal.daysToSettle <= 30 ? 'orange' : 'red'}>
                              {deal.daysToSettle} дн.
                            </Tag>
                          : deal.remaining > 0
                            ? <Tag color="red">Не вернул</Tag>
                            : '—'}
                      </div>
                    </Col>
                  </Row>
                  {deal.payments.length > 0 && (
                    <div style={{ marginTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 8 }}>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                        Платежи:
                      </Text>
                      <Space wrap size={4}>
                        {deal.payments.map((p) => (
                          <Tooltip
                            key={p.id}
                            title={`${dayjs(p.paidAt).format('DD.MM.YYYY')}${p.note ? ` · ${p.note}` : ''}`}
                          >
                            <Tag color="blue" style={{ cursor: 'default' }}>
                              {formatUZS(p.amount)} · <PaymentMethodTag method={p.method} />
                            </Tag>
                          </Tooltip>
                        ))}
                      </Space>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
