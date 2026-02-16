import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Descriptions, Card, Table, Typography, Spin, Timeline, Tag, Space, Button,
  Modal, Form, Input, DatePicker, Select, Tabs, Row, Col, Statistic, Segmented,
  message, theme,
} from 'antd';
import {
  PlusOutlined, DollarOutlined, ShoppingCartOutlined,
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined,
} from '@ant-design/icons';
import { Line, Bar } from '@ant-design/charts';
import { clientsApi } from '../api/clients.api';
import { contractsApi } from '../api/contracts.api';
import DealStatusTag, { statusConfig } from '../components/DealStatusTag';
import { formatUZS } from '../utils/currency';
import type { DealStatus, DealShort, PaymentStatus, AuditLog, PaymentRecord } from '../types';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contractModal, setContractModal] = useState(false);
  const [contractForm] = Form.useForm();
  const queryClient = useQueryClient();
  const { token } = theme.useToken();

  // Deal filters
  const [dealStatus, setDealStatus] = useState<DealStatus | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);

  // Analytics period
  const [analyticsPeriod, setAnalyticsPeriod] = useState<number>(30);

  const filterParams = {
    dealStatus: dealStatus,
    from: dateRange[0].format('YYYY-MM-DD'),
    to: dateRange[1].format('YYYY-MM-DD'),
  };

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id, filterParams],
    queryFn: () => clientsApi.getById(id!, filterParams),
    enabled: !!id,
  });

  const { data: history } = useQuery({
    queryKey: ['client-history', id],
    queryFn: () => clientsApi.history(id!),
    enabled: !!id,
  });

  const { data: contracts } = useQuery({
    queryKey: ['contracts', id],
    queryFn: () => contractsApi.list(id!),
    enabled: !!id,
  });

  const { data: payments } = useQuery({
    queryKey: ['client-payments', id],
    queryFn: () => clientsApi.payments(id!),
    enabled: !!id,
  });

  const { data: analytics } = useQuery({
    queryKey: ['client-analytics', id, analyticsPeriod],
    queryFn: () => clientsApi.analytics(id!, analyticsPeriod),
    enabled: !!id,
  });

  const createContractMut = useMutation({
    mutationFn: (data: { clientId: string; contractNumber: string; startDate: string; endDate?: string; notes?: string }) =>
      contractsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts', id] });
      message.success('Договор создан');
      setContractModal(false);
      contractForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка создания договора';
      message.error(msg);
    },
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!client) return <Typography.Text>Клиент не найден</Typography.Text>;

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';

  const contractColumns = [
    { title: 'Номер', dataIndex: 'contractNumber', render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Дата начала', dataIndex: 'startDate', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    { title: 'Дата окончания', dataIndex: 'endDate', render: (v: string | null) => v ? dayjs(v).format('DD.MM.YYYY') : '—' },
    { title: 'Статус', dataIndex: 'isActive', render: (v: boolean) => v ? <Tag color="green">Активен</Tag> : <Tag>Неактивен</Tag> },
    { title: 'Примечание', dataIndex: 'notes', render: (v: string | null) => v || '—' },
  ];

  const dealColumns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: DealShort) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Статус', dataIndex: 'status', render: (s: DealStatus) => <DealStatusTag status={s} /> },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Оплата', dataIndex: 'paymentStatus', render: (s: PaymentStatus | undefined) => {
        if (!s) return '—';
        const cfg = paymentStatusLabels[s];
        return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
      },
    },
    { title: 'Дата', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
  ];

  const paymentColumns = [
    { title: 'Сделка', dataIndex: ['deal', 'title'], render: (v: string, r: PaymentRecord) => r.deal ? <Link to={`/deals/${r.dealId}`}>{v}</Link> : '—' },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    { title: 'Способ', dataIndex: 'method', render: (v: string | null) => v || '—' },
    { title: 'Дата оплаты', dataIndex: 'paidAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm') },
    { title: 'Кем внесено', dataIndex: ['creator', 'fullName'], render: (v: string) => v || '—' },
    { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
  ];

  // ── Analytics chart data ──
  const lineData = (analytics?.revenueByDay ?? []).map((d) => ({
    date: d.date.slice(5),
    amount: d.amount,
  }));

  const barData = (analytics?.topProducts ?? []).map((p) => ({
    name: p.productName,
    value: p.totalQuantity,
  }));

  return (
    <div>
      <Typography.Title level={4}>{client.companyName}</Typography.Title>

      <Tabs
        defaultActiveKey="info"
        items={[
          {
            key: 'info',
            label: 'Информация',
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card bordered={false}>
                  <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                    <Descriptions.Item label="Контакт">{client.contactName}</Descriptions.Item>
                    <Descriptions.Item label="Телефон">{client.phone || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Email">{client.email || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Адрес">{client.address || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Менеджер">{client.manager?.fullName}</Descriptions.Item>
                    <Descriptions.Item label="Заметки">{client.notes || '—'}</Descriptions.Item>
                  </Descriptions>
                </Card>

                <Card title="Договоры" extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setContractModal(true)}>Создать</Button>} bordered={false}>
                  <Table
                    dataSource={contracts ?? []}
                    columns={contractColumns}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    bordered={false}
                    locale={{ emptyText: 'Нет договоров' }}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'deals',
            label: 'Сделки',
            children: (
              <Card
                bordered={false}
                extra={
                  <Space>
                    <Select
                      allowClear
                      placeholder="Все статусы"
                      style={{ width: 180 }}
                      value={dealStatus}
                      onChange={setDealStatus}
                      options={Object.entries(statusConfig).map(([k, v]) => ({ label: v.label, value: k }))}
                    />
                    <RangePicker
                      value={dateRange}
                      onChange={(dates) => {
                        if (dates && dates[0] && dates[1]) {
                          setDateRange([dates[0], dates[1]]);
                        }
                      }}
                      format="DD.MM.YYYY"
                      allowClear={false}
                    />
                  </Space>
                }
              >
                <Table
                  dataSource={client.deals ?? []}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  bordered={false}
                  columns={dealColumns}
                  locale={{ emptyText: 'Нет сделок за период' }}
                  summary={() => {
                    const deals = (client.deals ?? []).filter((d) => d.status !== 'CANCELED');
                    if (deals.length === 0) return null;
                    const totalAmount = deals.reduce((s, d) => s + Number(d.amount), 0);
                    return (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={2}><Typography.Text strong>Итого (без отмен): {deals.length} сделок</Typography.Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right"><Typography.Text strong>{formatUZS(totalAmount)}</Typography.Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={3} colSpan={2} />
                      </Table.Summary.Row>
                    );
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'analytics',
            label: 'Аналитика',
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Segmented
                    value={analyticsPeriod}
                    onChange={(v) => setAnalyticsPeriod(v as number)}
                    options={[
                      { label: '30 дней', value: 30 },
                      { label: '90 дней', value: 90 },
                      { label: 'Год', value: 365 },
                    ]}
                  />
                </div>

                {analytics && (
                  <>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Всего сделок" value={analytics.metrics.totalDeals} prefix={<ShoppingCartOutlined />} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Завершено" value={analytics.metrics.completedDeals} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Отменено" value={analytics.metrics.canceledDeals} prefix={<CloseCircleOutlined />} valueStyle={{ color: '#ff4d4f' }} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Общая сумма" value={analytics.metrics.totalSpent} formatter={(v) => formatUZS(v as number)} prefix={<DollarOutlined />} valueStyle={{ color: '#52c41a' }} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Долг" value={analytics.metrics.currentDebt} formatter={(v) => formatUZS(v as number)} prefix={<WarningOutlined />} valueStyle={{ color: analytics.metrics.currentDebt > 0 ? '#ff4d4f' : undefined }} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Последняя оплата" value={analytics.metrics.lastPaymentDate ? dayjs(analytics.metrics.lastPaymentDate).format('DD.MM.YYYY') : '—'} />
                        </Card>
                      </Col>
                    </Row>

                    <Row gutter={[16, 16]}>
                      <Col xs={24} lg={14}>
                        <Card title="Выручка по дням" bordered={false}>
                          {lineData.length > 0 ? (
                            <Line
                              data={lineData}
                              xField="date"
                              yField="amount"
                              height={280}
                              smooth
                              point={{ size: 3, shape: 'circle' }}
                              yAxis={{ label: { formatter: (v: string) => formatUZS(Number(v)) } }}
                              theme={isDark ? 'classicDark' : 'classic'}
                            />
                          ) : (
                            <Typography.Text type="secondary">Нет данных за период</Typography.Text>
                          )}
                        </Card>
                      </Col>
                      <Col xs={24} lg={10}>
                        <Card title="Топ товаров" bordered={false}>
                          {barData.length > 0 ? (
                            <Bar
                              data={barData}
                              xField="name"
                              yField="value"
                              height={280}
                              theme={isDark ? 'classicDark' : 'classic'}
                            />
                          ) : (
                            <Typography.Text type="secondary">Нет данных</Typography.Text>
                          )}
                        </Card>
                      </Col>
                    </Row>
                  </>
                )}
              </Space>
            ),
          },
          {
            key: 'payments',
            label: 'Платежи',
            children: (
              <Card bordered={false}>
                <Table
                  dataSource={payments ?? []}
                  columns={paymentColumns}
                  rowKey="id"
                  pagination={{ pageSize: 20 }}
                  size="small"
                  bordered={false}
                  locale={{ emptyText: 'Нет платежей' }}
                  summary={() => {
                    const list = payments ?? [];
                    if (list.length === 0) return null;
                    const total = list.reduce((s, p) => s + Number(p.amount), 0);
                    return (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0}><Typography.Text strong>Итого: {list.length}</Typography.Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right"><Typography.Text strong>{formatUZS(total)}</Typography.Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={2} colSpan={4} />
                      </Table.Summary.Row>
                    );
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'history',
            label: 'История',
            children: (
              <Card bordered={false}>
                <Timeline
                  items={(history ?? []).map((log: AuditLog) => ({
                    children: (
                      <div>
                        <Typography.Text strong>{log.user?.fullName}</Typography.Text>{' '}
                        <Tag>{log.action}</Tag>{' '}
                        <Typography.Text type="secondary">{dayjs(log.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text>
                        {log.after && (
                          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>
                            {JSON.stringify(log.after)}
                          </div>
                        )}
                      </div>
                    ),
                  }))}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title="Новый договор"
        open={contractModal}
        onCancel={() => setContractModal(false)}
        onOk={() => contractForm.submit()}
        confirmLoading={createContractMut.isPending}
        okText="Создать"
        cancelText="Отмена"
      >
        <Form form={contractForm} layout="vertical" onFinish={(v) => createContractMut.mutate({ ...v, clientId: id!, startDate: v.startDate.format('YYYY-MM-DD'), endDate: v.endDate ? v.endDate.format('YYYY-MM-DD') : undefined })}>
          <Form.Item name="contractNumber" label="Номер договора" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="startDate" label="Дата начала" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="endDate" label="Дата окончания">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="notes" label="Примечание">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
