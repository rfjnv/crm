import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Table, Typography, Select, Card, Statistic, Row, Col, Tag, Space, Segmented,
  Tabs, Input, Button, Modal, Form, InputNumber, message, Spin,
} from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { financeApi, type CashboxPayment } from '../api/finance.api';
import { dealsApi } from '../api/deals.api';
import { clientsApi } from '../api/clients.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { ClientDebtRow } from '../types';

const methodLabels: Record<string, string> = {
  CASH: 'Наличные',
  TRANSFER: 'Перечисление',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка',
};

const paymentStatusLabels: Record<string, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Полностью' },
};

export default function CashboxPage() {
  const [activeTab, setActiveTab] = useState('payments');
  const [period, setPeriod] = useState<string>('day');
  const [clientId, setClientId] = useState<string>();
  const [method, setMethod] = useState<string>();
  const [paymentStatus, setPaymentStatus] = useState<string>();

  // Debtors tab state
  const [debtSearch, setDebtSearch] = useState('');
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<{ clientId: string; clientName: string } | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [payForm] = Form.useForm();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['cashbox', period, clientId, method, paymentStatus],
    queryFn: () => financeApi.cashbox({ period, clientId, method, paymentStatus }),
    refetchInterval: 15_000,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  const { data: debtsData, isLoading: debtsLoading } = useQuery({
    queryKey: ['finance-debts'],
    queryFn: () => financeApi.getDebts(),
    enabled: activeTab === 'debtors',
  });

  const { data: clientDetail, isLoading: clientDetailLoading } = useQuery({
    queryKey: ['client-debt-detail', selectedClient?.clientId],
    queryFn: () => financeApi.clientDebtDetail(selectedClient!.clientId),
    enabled: !!selectedClient?.clientId && payModalOpen,
  });

  const paymentMut = useMutation({
    mutationFn: (vals: { dealId: string; amount: number; method?: string; note?: string }) =>
      dealsApi.createPayment(vals.dealId, { amount: vals.amount, method: vals.method, note: vals.note }),
    onSuccess: () => {
      message.success('Платёж добавлен');
      payForm.resetFields();
      setSelectedDealId(null);
      setPayModalOpen(false);
      setSelectedClient(null);
      queryClient.invalidateQueries({ queryKey: ['cashbox'] });
      queryClient.invalidateQueries({ queryKey: ['finance-debts'] });
      queryClient.invalidateQueries({ queryKey: ['client-debt-detail'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Ошибка при добавлении платежа');
    },
  });

  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ label: c.companyName, value: c.id })),
    [clients],
  );

  const debtorClients: ClientDebtRow[] = debtsData?.clients ?? [];

  const filteredDebtors = useMemo(() => {
    if (!debtSearch) return debtorClients;
    const q = debtSearch.toLowerCase();
    return debtorClients.filter(
      (c) =>
        c.clientName.toLowerCase().includes(q) ||
        c.manager?.fullName.toLowerCase().includes(q),
    );
  }, [debtorClients, debtSearch]);

  const openPayModal = (row: ClientDebtRow) => {
    setSelectedClient({ clientId: row.clientId, clientName: row.clientName });
    setSelectedDealId(null);
    payForm.resetFields();
    setPayModalOpen(true);
  };

  const handlePay = () => {
    if (!selectedDealId) {
      message.warning('Выберите сделку');
      return;
    }
    payForm.validateFields().then((vals) => {
      paymentMut.mutate({ dealId: selectedDealId, amount: vals.amount, method: vals.method, note: vals.note });
    });
  };

  // ──── Columns ────

  const paymentColumns = [
    {
      title: 'Время',
      dataIndex: 'paidAt',
      width: 140,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: 'Сделка',
      dataIndex: 'dealTitle',
      render: (v: string, r: CashboxPayment) => (
        <Link to={`/deals/${r.dealId}`}>{v || r.dealId.slice(0, 8)}</Link>
      ),
    },
    {
      title: 'Клиент',
      dataIndex: 'clientName',
      render: (v: string, r: CashboxPayment) => (
        <Link to={`/clients/${r.clientId}`}>{v}</Link>
      ),
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: number) => <strong>{formatUZS(v)}</strong>,
    },
    {
      title: 'Метод',
      dataIndex: 'method',
      width: 120,
      render: (v: string | null) => v ? (
        <Tag>{methodLabels[v] || v}</Tag>
      ) : '—',
    },
    {
      title: 'Статус сделки',
      dataIndex: 'dealPaymentStatus',
      width: 120,
      render: (v: string) => {
        const cfg = paymentStatusLabels[v] || { color: 'default', label: v };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Менеджер',
      dataIndex: 'manager',
    },
    {
      title: 'Принял',
      dataIndex: 'receivedBy',
    },
    {
      title: 'Примечание',
      dataIndex: 'note',
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
  ];

  const debtorColumns = [
    {
      title: 'Клиент',
      dataIndex: 'clientName',
      render: (v: string, r: ClientDebtRow) => (
        <Link to={`/clients/${r.clientId}`} style={{ fontWeight: 500 }}>{v}</Link>
      ),
    },
    {
      title: 'Общий долг',
      dataIndex: 'totalDebt',
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v < 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {v < 0 ? `−${formatUZS(Math.abs(v))} (переплата)` : formatUZS(v)}
        </span>
      ),
    },
    {
      title: 'Оплачено',
      dataIndex: 'totalPaid',
      align: 'right' as const,
      render: (v: number, r: ClientDebtRow) => {
        const pct = r.totalAmount > 0 ? Math.round((v / r.totalAmount) * 100) : 0;
        return (
          <span>
            <Typography.Text type="secondary">{formatUZS(v)}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>({pct}%)</Typography.Text>
          </span>
        );
      },
    },
    {
      title: 'Сделок',
      dataIndex: 'dealsCount',
      align: 'center' as const,
    },
    {
      title: 'Последний платёж',
      dataIndex: 'lastPaymentDate',
      render: (v: string | null) => (v ? dayjs(v).format('DD.MM.YYYY') : '—'),
    },
    {
      title: 'Менеджер',
      dataIndex: ['manager', 'fullName'],
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Статус',
      dataIndex: 'paymentStatus',
      render: (s: string) => {
        if (s === 'PARTIAL') return <Tag color="orange">Частично</Tag>;
        return <Tag color="default">Не оплачено</Tag>;
      },
    },
    {
      title: '',
      key: 'action',
      width: 120,
      render: (_: unknown, r: ClientDebtRow) => r.totalDebt > 0 ? (
        <Button type="primary" size="small" icon={<DollarOutlined />} onClick={() => openPayModal(r)}>
          Оплатить
        </Button>
      ) : null,
    },
  ];

  // ──── Deal selection for payment modal ────

  const clientDeals = clientDetail?.deals ?? [];
  const selectedDeal = clientDeals.find((d: any) => d.id === selectedDealId);

  return (
    <div>
      <Typography.Title level={4} style={{ margin: '0 0 16px' }}>Касса</Typography.Title>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'payments',
          label: 'Платежи',
          children: (
            <>
              <Space wrap style={{ marginBottom: 16 }}>
                <Segmented
                  value={period}
                  onChange={(v) => setPeriod(v as string)}
                  options={[
                    { label: 'День', value: 'day' },
                    { label: 'Неделя', value: 'week' },
                    { label: 'Месяц', value: 'month' },
                  ]}
                />
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Клиент"
                  style={{ width: 200 }}
                  value={clientId}
                  onChange={setClientId}
                  options={clientOptions}
                />
                <Select
                  allowClear
                  placeholder="Способ оплаты"
                  style={{ width: 160 }}
                  value={method}
                  onChange={setMethod}
                  options={[
                    { label: 'Наличные', value: 'CASH' },
                    { label: 'Перечисление', value: 'TRANSFER' },
                    { label: 'Payme', value: 'PAYME' },
                    { label: 'QR', value: 'QR' },
                    { label: 'Click', value: 'CLICK' },
                    { label: 'Терминал', value: 'TERMINAL' },
                    { label: 'Рассрочка', value: 'INSTALLMENT' },
                  ]}
                />
                <Select
                  allowClear
                  placeholder="Статус оплаты"
                  style={{ width: 160 }}
                  value={paymentStatus}
                  onChange={setPaymentStatus}
                  options={[
                    { label: 'Полностью', value: 'PAID' },
                    { label: 'Частично', value: 'PARTIAL' },
                  ]}
                />
              </Space>

              {/* Summary cards */}
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col span={6}>
                  <Card size="small">
                    <Statistic title="Итого за период" value={data?.totals.totalAmount ?? 0} formatter={(v) => formatUZS(Number(v))} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small">
                    <Statistic title="Итого за сегодня" value={data?.totals.todayTotal ?? 0} formatter={(v) => formatUZS(Number(v))} valueStyle={{ color: '#52c41a' }} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small">
                    <Statistic title="Количество оплат" value={data?.totals.count ?? 0} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small">
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>По методам</Typography.Text>
                    {data?.byMethod.map((m) => (
                      <div key={m.method} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span>{methodLabels[m.method] || m.method}</span>
                        <strong>{formatUZS(m.total)}</strong>
                      </div>
                    ))}
                    {(!data?.byMethod || data.byMethod.length === 0) && (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </Card>
                </Col>
              </Row>

              <Table
                dataSource={data?.payments}
                columns={paymentColumns}
                rowKey="id"
                loading={isLoading}
                pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
                size="middle"
                bordered={false}
                summary={() => data?.payments && data.payments.length > 0 ? (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}><strong>Итого</strong></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <strong>{formatUZS(data.totals.totalAmount)}</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} colSpan={5} />
                  </Table.Summary.Row>
                ) : undefined}
              />
            </>
          ),
        },
        {
          key: 'debtors',
          label: `Должники${debtorClients.length > 0 ? ` (${debtorClients.length})` : ''}`,
          children: (
            <>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Input.Search
                  placeholder="Поиск по клиенту или менеджеру..."
                  style={{ width: 300 }}
                  allowClear
                  value={debtSearch}
                  onChange={(e) => setDebtSearch(e.target.value)}
                />
                {debtsData?.totals && (
                  <Space size="large">
                    <Typography.Text type="secondary">
                      Клиентов: <strong>{debtsData.totals.clientCount}</strong>
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      Общий долг: <strong style={{ color: '#ff4d4f' }}>{formatUZS(debtsData.totals.totalDebt)}</strong>
                    </Typography.Text>
                  </Space>
                )}
              </div>

              <Table
                dataSource={filteredDebtors}
                columns={debtorColumns}
                rowKey="clientId"
                loading={debtsLoading}
                pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
                size="middle"
                bordered={false}
                locale={{ emptyText: 'Нет задолженностей' }}
              />
            </>
          ),
        },
      ]} />

      {/* Quick payment modal */}
      <Modal
        title={`Оплата — ${selectedClient?.clientName ?? ''}`}
        open={payModalOpen}
        onCancel={() => { setPayModalOpen(false); setSelectedClient(null); setSelectedDealId(null); payForm.resetFields(); }}
        onOk={handlePay}
        okText="Оплатить"
        confirmLoading={paymentMut.isPending}
        width={600}
        okButtonProps={{ disabled: !selectedDealId }}
      >
        {clientDetailLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              Выберите сделку для оплаты:
            </Typography.Text>

            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 16 }}>
              {clientDeals.length === 0 && (
                <Typography.Text type="secondary">Нет неоплаченных сделок</Typography.Text>
              )}
              {clientDeals.map((deal: any) => {
                const debt = Number(deal.amount) - Number(deal.paidAmount);
                const isSelected = selectedDealId === deal.id;
                return (
                  <div
                    key={deal.id}
                    onClick={() => setSelectedDealId(deal.id)}
                    style={{
                      padding: '8px 12px',
                      border: `1px solid ${isSelected ? '#1890ff' : '#f0f0f0'}`,
                      borderRadius: 6,
                      marginBottom: 8,
                      cursor: 'pointer',
                      background: isSelected ? '#e6f7ff' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{deal.title || deal.id.slice(0, 8)}</strong>
                      <span style={{ color: '#ff4d4f', fontWeight: 600 }}>
                        Долг: {formatUZS(debt)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      Сумма: {formatUZS(Number(deal.amount))} · Оплачено: {formatUZS(Number(deal.paidAmount))}
                      {deal.manager?.fullName && ` · ${deal.manager.fullName}`}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedDealId && selectedDeal && (
              <Form form={payForm} layout="vertical">
                <Form.Item
                  name="amount"
                  label="Сумма"
                  rules={[{ required: true, message: 'Введите сумму' }]}
                  initialValue={Number(selectedDeal.amount) - Number(selectedDeal.paidAmount)}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={1}
                    formatter={moneyFormatter}
                    parser={(v) => Number(moneyParser(v))}
                  />
                </Form.Item>
                <Form.Item name="method" label="Способ оплаты">
                  <Select
                    allowClear
                    placeholder="Выберите способ"
                    options={[
                      { label: 'Наличные', value: 'CASH' },
                      { label: 'Перечисление', value: 'TRANSFER' },
                      { label: 'Payme', value: 'PAYME' },
                      { label: 'QR', value: 'QR' },
                      { label: 'Click', value: 'CLICK' },
                      { label: 'Терминал', value: 'TERMINAL' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="note" label="Примечание">
                  <Input.TextArea rows={2} />
                </Form.Item>
              </Form>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
