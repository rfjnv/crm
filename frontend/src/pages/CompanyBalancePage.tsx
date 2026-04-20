import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Typography,
  Space,
  Segmented,
  Select,
  Row,
  Col,
  Spin,
  Form,
  InputNumber,
  DatePicker,
  Button,
  Tag,
  Table,
  Empty,
} from 'antd';
import { Line, Column } from '@ant-design/charts';
import { theme } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { financeApi } from '../api/finance.api';
import { settingsApi } from '../api/settings.api';
import { usersApi } from '../api/users.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import BackButton from '../components/BackButton';

function chartAxisLabelUZS(value: unknown): string {
  return formatUZS(Number(value));
}

const METHOD_ORDER: { key: string; label: string; color: string }[] = [
  { key: 'CASH', label: 'Наличные', color: '#52c41a' },
  { key: 'TRANSFER', label: 'Перечисление', color: '#1677ff' },
  { key: 'PAYME', label: 'Payme', color: '#00c4ff' },
  { key: 'QR', label: 'QR', color: '#722ed1' },
  { key: 'CLICK', label: 'Click', color: '#13c2c2' },
  { key: 'TERMINAL', label: 'Терминал', color: '#fa8c16' },
  { key: 'INSTALLMENT', label: 'Рассрочка', color: '#eb2f96' },
  { key: 'UNKNOWN', label: 'Не указано', color: '#8c8c8c' },
];

function methodLabel(key: string | null | undefined): string {
  if (!key) return 'Не указано';
  return METHOD_ORDER.find((m) => m.key === key)?.label || key;
}

function methodColor(key: string | null | undefined): string {
  if (!key) return '#8c8c8c';
  return METHOD_ORDER.find((m) => m.key === key)?.color || '#8c8c8c';
}

export default function CompanyBalancePage() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { token: tk } = theme.useToken();
  const [setupForm] = Form.useForm();
  const [balancePeriod, setBalancePeriod] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [balanceMethod, setBalanceMethod] = useState<string | undefined>(undefined);
  const [balanceManagerId, setBalanceManagerId] = useState<string | undefined>(undefined);

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list(),
  });

  const managers = (users ?? [])
    .filter((u: { role: string; isActive: boolean }) =>
      ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'].includes(u.role) && u.isActive,
    )
    .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName }));

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.getCompanySettings,
  });

  const {
    data: balanceData,
    isLoading: balanceLoading,
    isFetching: balanceFetching,
    refetch: refetchBalance,
  } = useQuery({
    queryKey: ['company-balance', balancePeriod, balanceMethod, balanceManagerId],
    queryFn: () =>
      financeApi.companyBalance({
        period: balancePeriod,
        method: balanceMethod,
        managerId: balanceManagerId,
      }),
    refetchInterval: 10_000,
  });

  const setupBalanceMut = useMutation({
    mutationFn: (vals: { initialBalance: number; balanceStartDate: string }) =>
      settingsApi.updateCompanySettings({
        initialBalance: vals.initialBalance,
        balanceStartDate: vals.balanceStartDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      queryClient.invalidateQueries({ queryKey: ['company-balance'] });
    },
  });

  const methodCards = useMemo(() => {
    const by = balanceData?.byMethod || {};
    return METHOD_ORDER
      .map((m) => ({
        ...m,
        agg: by[m.key] || { incoming: 0, outgoing: 0, net: 0, incomingInRange: 0, outgoingInRange: 0 },
      }))
      .filter((m) => m.agg.incoming > 0 || m.agg.outgoing > 0 || m.key === 'CASH' || m.key === 'TRANSFER');
  }, [balanceData]);

  const incomeVsExpenseData = useMemo(() => {
    const rows = balanceData?.charts?.incomeVsExpense ?? [];
    const bars = rows.flatMap((r) => ([
      { day: r.day, type: 'Приход', value: r.incoming },
      { day: r.day, type: 'Расход', value: r.outgoing },
    ]));
    const line = rows.map((r) => ({ day: r.day, net: r.net }));
    return { bars, line };
  }, [balanceData]);

  const expenseByMethodData = useMemo(
    () => balanceData?.charts?.expenseByDayMethod ?? [],
    [balanceData],
  );

  const recentIncoming = balanceData?.recentIncoming ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0 }}>Баланс компании</Typography.Title>
      </div>

      {!companySettings?.balanceStartDate || balanceData?.setupRequired ? (
        <Card>
          <Typography.Title level={5} style={{ marginTop: 0 }}>Первичная настройка баланса</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            Исторические данные до выбранной даты не учитываются. Баланс считается только от начальной точки.
          </Typography.Paragraph>
          <Form
            form={setupForm}
            layout="vertical"
            initialValues={{
              initialBalance: Number(companySettings?.initialBalance || 0),
              balanceStartDate: dayjs(),
            }}
            onFinish={(vals) =>
              setupBalanceMut.mutate({
                initialBalance: Number(vals.initialBalance || 0),
                balanceStartDate: dayjs(vals.balanceStartDate).format('YYYY-MM-DD'),
              })
            }
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="initialBalance"
                  label="Начальный баланс"
                  rules={[{ required: true, message: 'Укажите начальный баланс' }]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    formatter={moneyFormatter}
                    parser={moneyParser}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="balanceStartDate"
                  label="Дата начала учета"
                  rules={[{ required: true, message: 'Укажите дату начала' }]}
                >
                  <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
                </Form.Item>
              </Col>
            </Row>
            <Button type="primary" htmlType="submit" loading={setupBalanceMut.isPending}>
              Подтвердить и запустить учет
            </Button>
          </Form>
        </Card>
      ) : (
        <>
          <Space wrap style={{ marginBottom: 16 }}>
            <Segmented
              value={balancePeriod}
              onChange={(v) => setBalancePeriod(v as 'day' | 'week' | 'month' | 'year')}
              options={[
                { label: 'День', value: 'day' },
                { label: 'Неделя', value: 'week' },
                { label: 'Месяц', value: 'month' },
                { label: 'Год', value: 'year' },
              ]}
            />
            <Select
              allowClear
              placeholder="Способ оплаты"
              style={{ width: isMobile ? '100%' : 200 }}
              value={balanceMethod}
              onChange={setBalanceMethod}
              options={METHOD_ORDER.filter((m) => m.key !== 'UNKNOWN').map((m) => ({
                label: m.label,
                value: m.key,
              }))}
            />
            <Select
              allowClear
              placeholder="Менеджер"
              style={{ width: isMobile ? '100%' : 200 }}
              value={balanceManagerId}
              onChange={setBalanceManagerId}
              options={managers}
            />
            <Button onClick={() => void refetchBalance()} loading={balanceFetching}>
              Обновить
            </Button>
          </Space>

          {balanceLoading ? (
            <Spin />
          ) : (
            <>
              {/* KPI card */}
              <Card style={{ marginBottom: 16, borderRadius: 12 }} bodyStyle={{ padding: isMobile ? 16 : 24 }}>
                <Typography.Text type="secondary">Баланс компании</Typography.Text>
                <div style={{ fontSize: isMobile ? 34 : 46, fontWeight: 700, lineHeight: 1.1, marginTop: 8 }}>
                  {formatUZS(balanceData?.kpi?.balance ?? 0)}
                </div>
                <Space size="large" wrap style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary">
                    Наличные (нетто): <b style={{ color: tk.colorSuccess }}>{formatUZS(balanceData?.kpi?.cash ?? 0)}</b>
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    Безналичные (нетто): <b style={{ color: tk.colorPrimary }}>{formatUZS(balanceData?.kpi?.bank ?? 0)}</b>
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    Обновлено: {dayjs(balanceData?.updatedAt).format('DD.MM.YYYY HH:mm')}
                  </Typography.Text>
                </Space>
                <div style={{ marginTop: 12 }}>
                  <Space size="large" wrap>
                    <Typography.Text type="secondary">
                      Приход за период: <b style={{ color: tk.colorSuccess }}>+{formatUZS(balanceData?.kpi?.incomingInRange ?? 0)}</b>
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      Расход за период: <b style={{ color: tk.colorError }}>−{formatUZS(balanceData?.kpi?.outgoingInRange ?? 0)}</b>
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      Чистое за период:{' '}
                      <b style={{ color: (balanceData?.kpi?.netInRange ?? 0) >= 0 ? tk.colorSuccess : tk.colorError }}>
                        {formatUZS(balanceData?.kpi?.netInRange ?? 0)}
                      </b>
                    </Typography.Text>
                  </Space>
                </div>
              </Card>

              {/* Breakdown totals (real / expected / debts) */}
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} md={8}>
                  <Card style={{ borderRadius: 12 }}>
                    <Typography.Text type="secondary">Реальные деньги</Typography.Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: tk.colorSuccess }}>{formatUZS(balanceData?.breakdown?.real ?? 0)}</div>
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card style={{ borderRadius: 12 }}>
                    <Typography.Text type="secondary">Ожидается</Typography.Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#faad14' }}>{formatUZS(balanceData?.breakdown?.expected ?? 0)}</div>
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card style={{ borderRadius: 12 }}>
                    <Typography.Text type="secondary">Долги</Typography.Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: tk.colorError }}>{formatUZS(balanceData?.breakdown?.debts ?? 0)}</div>
                  </Card>
                </Col>
              </Row>

              {/* Breakdown by payment method */}
              <Card title="Разрез по способам оплаты" style={{ borderRadius: 12, marginBottom: 16 }}>
                <Row gutter={[12, 12]}>
                  {methodCards.map((m) => (
                    <Col key={m.key} xs={12} sm={8} md={6} lg={6} xl={3}>
                      <Card
                        size="small"
                        style={{
                          borderRadius: 12,
                          borderTop: `3px solid ${m.color}`,
                          height: '100%',
                        }}
                        bodyStyle={{ padding: 12 }}
                      >
                        <Typography.Text strong style={{ color: m.color }}>{m.label}</Typography.Text>
                        <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>
                          {formatUZS(m.agg.net)}
                        </div>
                        <div style={{ fontSize: 11, color: tk.colorTextSecondary, marginTop: 4 }}>
                          <span style={{ color: tk.colorSuccess }}>+{formatUZS(m.agg.incoming)}</span>
                          {'  '}
                          <span style={{ color: tk.colorError }}>−{formatUZS(m.agg.outgoing)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: tk.colorTextTertiary, marginTop: 2 }}>
                          За период: +{formatUZS(m.agg.incomingInRange)} / −{formatUZS(m.agg.outgoingInRange)}
                        </div>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Card>

              {/* Dynamic income vs expense + net line */}
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} xl={12}>
                  <Card title="Приход vs Расход" style={{ borderRadius: 12 }}>
                    {incomeVsExpenseData.bars.length === 0 ? (
                      <Empty description="Нет данных за период" />
                    ) : (
                      <Column
                        data={incomeVsExpenseData.bars}
                        xField="day"
                        yField="value"
                        seriesField="type"
                        group
                        height={isMobile ? 260 : 320}
                        color={[tk.colorSuccess, tk.colorError]}
                        legend={{ position: 'top' }}
                        axis={{ y: { labelFormatter: chartAxisLabelUZS } }}
                      />
                    )}
                  </Card>
                </Col>

                <Col xs={24} xl={12}>
                  <Card title="Чистый денежный поток по дням" style={{ borderRadius: 12 }}>
                    {incomeVsExpenseData.line.length === 0 ? (
                      <Empty description="Нет данных за период" />
                    ) : (
                      <Line
                        data={incomeVsExpenseData.line}
                        xField="day"
                        yField="net"
                        smooth
                        height={isMobile ? 260 : 320}
                        color={tk.colorPrimary}
                        axis={{ y: { labelFormatter: chartAxisLabelUZS } }}
                      />
                    )}
                  </Card>
                </Col>
              </Row>

              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col span={24}>
                  <Card title="Баланс во времени" style={{ borderRadius: 12 }}>
                    <Line
                      data={balanceData?.charts?.balanceLine ?? []}
                      xField="day"
                      yField="balance"
                      smooth
                      height={isMobile ? 260 : 320}
                      axis={{ y: { labelFormatter: chartAxisLabelUZS } }}
                    />
                  </Card>
                </Col>
              </Row>

              {/* Expense by method stacked */}
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col span={24}>
                  <Card title="Расходы по типам оплаты (по дням)" style={{ borderRadius: 12 }}>
                    {expenseByMethodData.length === 0 ? (
                      <Empty description="Нет расходов за период" />
                    ) : (
                      <Column
                        data={expenseByMethodData.map((d) => ({
                          day: d.day,
                          method: methodLabel(d.method),
                          amount: d.amount,
                        }))}
                        xField="day"
                        yField="amount"
                        seriesField="method"
                        stack
                        height={isMobile ? 260 : 320}
                        legend={{ position: 'top' }}
                        axis={{ y: { labelFormatter: chartAxisLabelUZS } }}
                      />
                    )}
                  </Card>
                </Col>
              </Row>

              {/* Recent incoming payments table */}
              <Card title="Последние поступления" style={{ borderRadius: 12, marginBottom: 16 }}>
                <Table
                  rowKey="id"
                  dataSource={recentIncoming}
                  size="middle"
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  scroll={{ x: true }}
                  locale={{ emptyText: <Empty description="Нет поступлений за период" /> }}
                  columns={[
                    {
                      title: 'Дата',
                      dataIndex: 'paidAt',
                      width: 140,
                      render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
                    },
                    {
                      title: 'Клиент',
                      dataIndex: 'client',
                      render: (client: { id: string; name: string } | null) =>
                        client ? <Link to={`/clients/${client.id}`}>{client.name}</Link> : '—',
                    },
                    {
                      title: 'Сделка',
                      dataIndex: 'deal',
                      render: (deal: { id: string; title: string } | null) =>
                        deal ? <Link to={`/deals/${deal.id}`}>{deal.title || deal.id.slice(0, 8)}</Link> : '—',
                    },
                    {
                      title: 'Способ',
                      dataIndex: 'method',
                      width: 140,
                      render: (m: string | null) => (
                        <Tag color={methodColor(m)} style={{ margin: 0 }}>{methodLabel(m)}</Tag>
                      ),
                    },
                    {
                      title: 'Сумма',
                      dataIndex: 'amount',
                      align: 'right' as const,
                      width: 160,
                      render: (v: number) => <b style={{ color: tk.colorSuccess }}>+{formatUZS(v)}</b>,
                    },
                    {
                      title: 'Принял',
                      dataIndex: 'receivedBy',
                      width: 160,
                      render: (u: { fullName: string } | null) => u?.fullName || '—',
                    },
                    {
                      title: 'Примечание',
                      dataIndex: 'note',
                      render: (v: string | null) => v || '—',
                    },
                  ]}
                />
              </Card>

              {/* Cash flow + payments per day kept for reference */}
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
                  <Card title="Денежный поток (вход/исход)" style={{ borderRadius: 12 }}>
                    <Column
                      data={
                        (balanceData?.charts?.cashFlow ?? []).flatMap((d) => ([
                          { day: d.day, type: 'Входящий', value: d.incoming ?? 0 },
                          { day: d.day, type: 'Исходящий', value: d.outgoing ?? 0 },
                        ]))
                      }
                      xField="day"
                      yField="value"
                      seriesField="type"
                      group
                      height={isMobile ? 240 : 280}
                      color={[tk.colorSuccess, tk.colorError]}
                      axis={{ y: { labelFormatter: chartAxisLabelUZS } }}
                    />
                  </Card>
                </Col>
                <Col xs={24} xl={12}>
                  <Card title="Поступления по дням" style={{ borderRadius: 12 }}>
                    <Column
                      data={(balanceData?.charts?.paymentsPerDay ?? []).map((d) => ({ day: d.day, total: d.total ?? 0 }))}
                      xField="day"
                      yField="total"
                      height={isMobile ? 240 : 280}
                      color={tk.colorSuccess}
                      axis={{ y: { labelFormatter: chartAxisLabelUZS } }}
                    />
                  </Card>
                </Col>
              </Row>
            </>
          )}
        </>
      )}
    </div>
  );
}
