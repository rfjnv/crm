import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Descriptions, Card, Table, Typography, Spin, Timeline, Tag, Space, Button,
  Modal, Form, Input, DatePicker, Tabs, Row, Col, Statistic, Segmented,
  message, theme, Collapse,
} from 'antd';
import {
  PlusOutlined, DollarOutlined, ShoppingCartOutlined,
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, EditOutlined,
} from '@ant-design/icons';
import { Line, Bar } from '@ant-design/charts';
import { clientsApi } from '../api/clients.api';
import { contractsApi } from '../api/contracts.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import DealStatusTag from '../components/DealStatusTag';
import { formatUZS } from '../utils/currency';
import type { DealStatus, DealShort, PaymentStatus, AuditLog, PaymentRecord } from '../types';
import type { CreateClientData } from '../api/clients.api';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

type PaymentFilter = 'ALL' | 'DEBT' | 'PAID' | 'PARTIAL';

const paymentFilterOptions: { label: string; value: PaymentFilter }[] = [
  { label: 'Все', value: 'ALL' },
  { label: 'Долг', value: 'DEBT' },
  { label: 'Оплачено', value: 'PAID' },
  { label: 'Частично', value: 'PARTIAL' },
];

function getPaymentCategory(deal: DealShort): PaymentFilter {
  const amount = Number(deal.amount);
  const paid = Number(deal.paidAmount ?? 0);
  if (paid >= amount) return 'PAID';
  if (paid > 0) return 'PARTIAL';
  return 'DEBT';
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contractModal, setContractModal] = useState(false);
  const [contractForm] = Form.useForm();
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const queryClient = useQueryClient();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const isMobile = useIsMobile();

  // Client-side payment status filter (no API call on change)
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('ALL');

  // Analytics period
  const [analyticsPeriod, setAnalyticsPeriod] = useState<number>(30);

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsApi.getById(id!),
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

  const updateClientMut = useMutation({
    mutationFn: (data: Partial<CreateClientData>) => clientsApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      message.success('Клиент обновлён');
      setEditOpen(false);
    },
    onError: () => message.error('Ошибка обновления клиента'),
  });

  // Client-side filtering of deals by payment status
  const filteredDeals = useMemo(() => {
    const deals = client?.deals ?? [];
    if (paymentFilter === 'ALL') return deals;
    return deals.filter((d) => getPaymentCategory(d) === paymentFilter);
  }, [client?.deals, paymentFilter]);

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!client) return <Typography.Text>Клиент не найден</Typography.Text>;

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canEdit = isAdmin || user?.permissions?.includes('edit_client');

  const openEdit = () => {
    editForm.setFieldsValue({
      companyName: client.companyName,
      contactName: client.contactName,
      phone: client.phone || '+998',
      email: client.email || '',
      address: client.address || '',
      notes: client.notes || '',
      inn: client.inn || '',
      bankName: client.bankName || '',
      bankAccount: client.bankAccount || '',
      mfo: client.mfo || '',
      vatRegCode: client.vatRegCode || '',
      oked: client.oked || '',
    });
    setEditOpen(true);
  };

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

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
    { title: 'Оплачено', dataIndex: 'paidAmount', align: 'right' as const, render: (v: string | undefined) => formatUZS(v ?? 0) },
    {
      title: 'Остаток', key: 'remaining', align: 'right' as const,
      render: (_: unknown, r: DealShort) => {
        const diff = Number(r.amount) - Number(r.paidAmount ?? 0);
        if (diff > 0) {
          return <Typography.Text type="danger">{formatUZS(diff)}</Typography.Text>;
        }
        if (diff < 0) {
          return <Typography.Text type="success">Переплата: {formatUZS(Math.abs(diff))}</Typography.Text>;
        }
        return <Typography.Text type="success">{formatUZS(0)}</Typography.Text>;
      },
    },
    { title: 'Дата', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    {
      title: 'Оплата', dataIndex: 'paymentStatus', render: (s: PaymentStatus | undefined) => {
        if (!s) return '—';
        const cfg = paymentStatusLabels[s];
        return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
      },
    },
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>{client.companyName}</Typography.Title>
        {canEdit && <Button type="primary" icon={<EditOutlined />} onClick={openEdit}>Редактировать</Button>}
      </div>

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
                  {(client.inn || client.bankName || client.bankAccount || client.mfo || client.vatRegCode || client.oked) && (
                    <Collapse size="small" ghost style={{ marginTop: 12 }} items={[{
                      key: 'requisites',
                      label: 'Реквизиты',
                      children: (
                        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                          <Descriptions.Item label="ИНН">{client.inn || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Банк">{client.bankName || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Р/С">{client.bankAccount || '—'}</Descriptions.Item>
                          <Descriptions.Item label="МФО">{client.mfo || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Рег. код НДС">{client.vatRegCode || '—'}</Descriptions.Item>
                          <Descriptions.Item label="ОКЭД">{client.oked || '—'}</Descriptions.Item>
                        </Descriptions>
                      ),
                    }]} />
                  )}
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
                    scroll={{ x: 500 }}
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
                  <Segmented
                    value={paymentFilter}
                    onChange={(v) => setPaymentFilter(v as PaymentFilter)}
                    options={paymentFilterOptions}
                  />
                }
              >
                <Table
                  dataSource={filteredDeals}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  bordered={false}
                  columns={dealColumns}
                  locale={{ emptyText: 'Нет сделок' }}
                  scroll={{ x: 500 }}
                  summary={() => {
                    const deals = filteredDeals.filter((d) => d.status !== 'CANCELED');
                    if (deals.length === 0) return null;
                    const totalAmount = deals.reduce((s, d) => s + Number(d.amount), 0);
                    const totalPaid = deals.reduce((s, d) => s + Number(d.paidAmount ?? 0), 0);
                    const totalDiff = totalAmount - totalPaid;
                    return (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={2}>
                          <Typography.Text strong>Итого (без отмен): {deals.length} сделок</Typography.Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right">
                          <Typography.Text strong>{formatUZS(totalAmount)}</Typography.Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="right">
                          <Typography.Text strong>{formatUZS(totalPaid)}</Typography.Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="right">
                          <Typography.Text strong type={totalDiff > 0 ? 'danger' : 'success'}>
                            {totalDiff < 0 ? `Переплата: ${formatUZS(Math.abs(totalDiff))}` : formatUZS(Math.max(totalDiff, 0))}
                          </Typography.Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5} colSpan={2} />
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

                    {/* Debt breakdown: total amount, total paid, overpayment info */}
                    {(() => {
                      const allDeals = client?.deals ?? [];
                      const activeDeals = allDeals.filter((d) => d.status !== 'CANCELED' && d.status !== 'REJECTED');
                      const unpaidDeals = activeDeals.filter((d) => (d.paymentStatus === 'UNPAID' || d.paymentStatus === 'PARTIAL'));
                      const debtFromUnpaid = unpaidDeals.reduce((s, d) => s + Math.max(0, Number(d.amount) - Number(d.paidAmount ?? 0)), 0);
                      const overpaid = activeDeals.reduce((s, d) => {
                        const diff = Number(d.paidAmount ?? 0) - Number(d.amount);
                        return diff > 0 ? s + diff : s;
                      }, 0);
                      const netDebt = debtFromUnpaid - overpaid;
                      if (unpaidDeals.length === 0 && overpaid === 0) return null;
                      return (
                        <Card bordered={false} size="small" style={{ marginTop: 8 }}>
                          <Row gutter={[16, 8]}>
                            <Col xs={24} sm={8}>
                              <Typography.Text type="secondary">Общий долг: </Typography.Text>
                              <Typography.Text strong style={{ color: netDebt > 0 ? '#ff4d4f' : netDebt < 0 ? '#52c41a' : undefined }}>
                                {netDebt > 0 ? formatUZS(netDebt) : netDebt < 0 ? `Переплата: ${formatUZS(Math.abs(netDebt))}` : formatUZS(0)}
                              </Typography.Text>
                            </Col>
                            <Col xs={24} sm={8}>
                              <Typography.Text type="secondary">Неопл. сделок: </Typography.Text>
                              <Typography.Text strong>{unpaidDeals.length}</Typography.Text>
                              <Typography.Text type="secondary"> на {formatUZS(debtFromUnpaid)}</Typography.Text>
                            </Col>
                            {overpaid > 0 && (
                              <Col xs={24} sm={8}>
                                <Tag color="green">Переплата: {formatUZS(overpaid)}</Tag>
                              </Col>
                            )}
                          </Row>
                        </Card>
                      );
                    })()}

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
                              theme={chartTheme}
                              axis={{
                                x: { labelFill: token.colorText },
                                y: { labelFill: token.colorText },
                              }}
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
                              theme={chartTheme}
                              axis={{
                                x: { labelFill: token.colorText },
                                y: { labelFill: token.colorText },
                              }}
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
                  scroll={{ x: 500 }}
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

      {/* Edit Modal */}
      <Modal
        title="Редактировать клиента"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={updateClientMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={editForm} layout="vertical" onFinish={(v) => updateClientMut.mutate(v)}>
          <Form.Item name="companyName" label="Компания" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label="Контактное лицо" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
            <Form.Item name="phone" label="Телефон" style={{ flex: 1, width: isMobile ? '100%' : undefined }}>
              <Input placeholder="+998 99 999 99 99" />
            </Form.Item>
            <Form.Item name="email" label="Email" style={{ flex: 1, width: isMobile ? '100%' : undefined }}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="Адрес">
            <Input />
          </Form.Item>
          <Form.Item name="notes" label="Заметки">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Collapse size="small" ghost items={[{
            key: 'requisites',
            label: 'Реквизиты (ИНН, банк, МФО)',
            children: (
              <>
                <Form.Item name="inn" label="ИНН">
                  <Input placeholder="123456789" />
                </Form.Item>
                <Form.Item name="bankName" label="Банк">
                  <Input placeholder="АКБ ..." />
                </Form.Item>
                <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
                  <Form.Item name="bankAccount" label="Расчётный счёт" style={{ flex: 1 }}>
                    <Input placeholder="20208000..." />
                  </Form.Item>
                  <Form.Item name="mfo" label="МФО" style={{ flex: 1 }}>
                    <Input placeholder="00000" />
                  </Form.Item>
                </Space>
                <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
                  <Form.Item name="vatRegCode" label="Рег. код НДС" style={{ flex: 1 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="oked" label="ОКЭД" style={{ flex: 1 }}>
                    <Input />
                  </Form.Item>
                </Space>
              </>
            ),
          }]} />
        </Form>
      </Modal>
    </div>
  );
}
