import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Table, Typography, Select, Card, Statistic, Row, Col, Tag, Space, Segmented,
  Tabs, Input, Button, Modal, Form, InputNumber, message, Spin, DatePicker,
} from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import dayjs from 'dayjs';
import { financeApi, type CashboxPayment, type ActiveDealRow } from '../api/finance.api';
import DealStatusTag from '../components/DealStatusTag';
import { dealsApi } from '../api/deals.api';
import { clientsApi } from '../api/clients.api';
import { usersApi } from '../api/users.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { ClientDebtRow, DealStatus } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import BackButton from '../components/BackButton';

type DebtRange = 'all' | '1m' | '5m' | '10m' | 'custom';
type DebtStatus = 'all' | 'PARTIAL' | 'UNPAID';
type SortOption = 'debt_desc' | 'newest' | 'oldest_unpaid';

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
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('payments');
  const [period, setPeriod] = useState<string>('day');
  const [clientId, setClientId] = useState<string>();
  const [method, setMethod] = useState<string>();
  const [paymentStatus, setPaymentStatus] = useState<string>();
  const [entryType, setEntryType] = useState<'DEBT_COLLECTION' | 'SALE_PAYMENT'>();
  const { token: tk } = theme.useToken();

  // Debtors tab state
  const [debtSearch, setDebtSearch] = useState('');
  const [debtRange, setDebtRange] = useState<DebtRange>('all');
  const [customMin, setCustomMin] = useState<number | null>(null);
  const [debtStatus, setDebtStatus] = useState<DebtStatus>('all');
  const [managerId, setManagerId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortOption>('debt_desc');
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<{ clientId: string; clientName: string } | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [payForm] = Form.useForm();
  const [activePayModalOpen, setActivePayModalOpen] = useState(false);
  const [activePayDeal, setActivePayDeal] = useState<ActiveDealRow | null>(null);
  const [activePayMode, setActivePayMode] = useState<'cash' | 'credit'>('cash');
  const [activePayForm] = Form.useForm();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['cashbox', period, clientId, method, paymentStatus, entryType],
    queryFn: () => financeApi.cashbox({ period, clientId, method, paymentStatus, entryType }),
    refetchInterval: 15_000,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: usersApi.list,
  });

  const debtParams = useMemo(() => {
    const p: { minDebt?: number; managerId?: string; paymentStatus?: string } = {};
    if (managerId) p.managerId = managerId;
    if (debtStatus !== 'all') p.paymentStatus = debtStatus;

    let minDebt = 0;
    if (debtRange === '1m') minDebt = 1_000_000;
    else if (debtRange === '5m') minDebt = 5_000_000;
    else if (debtRange === '10m') minDebt = 10_000_000;
    else if (debtRange === 'custom' && customMin) minDebt = customMin;
    if (minDebt > 0) p.minDebt = minDebt;

    return p;
  }, [managerId, debtStatus, debtRange, customMin]);

  const { data: debtsData, isLoading: debtsLoading } = useQuery({
    queryKey: ['finance-debts', debtParams],
    queryFn: () => financeApi.getDebts(debtParams),
    enabled: activeTab === 'debtors',
  });

  const activeDealsParams = useMemo(
    () => (managerId ? { managerId } : undefined),
    [managerId],
  );

  const { data: activeDealsData, isLoading: activeDealsLoading } = useQuery({
    queryKey: ['finance-active-deals', activeDealsParams],
    queryFn: () => financeApi.getActiveDeals(activeDealsParams),
    enabled: activeTab === 'active',
    refetchInterval: 15_000,
  });

  const { data: activePayContext, isLoading: activePayContextLoading } = useQuery({
    queryKey: ['deal-payment-context', activePayDeal?.dealId],
    queryFn: () => financeApi.getDealPaymentContext(activePayDeal!.dealId),
    enabled: !!activePayDeal?.dealId && activePayModalOpen,
  });

  const activePayAmountWatch = Form.useWatch('amount', activePayForm);

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
      queryClient.invalidateQueries({ queryKey: ['finance-active-deals'] });
      queryClient.invalidateQueries({ queryKey: ['client-debt-detail'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Ошибка при добавлении платежа');
    },
  });

  const invalidateAfterActivePayment = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['cashbox'] });
    queryClient.invalidateQueries({ queryKey: ['finance-debts'] });
    queryClient.invalidateQueries({ queryKey: ['finance-active-deals'] });
    queryClient.invalidateQueries({ queryKey: ['deal-payment-context'] });
    queryClient.invalidateQueries({ queryKey: ['client-debt-detail'] });
  }, [queryClient]);

  const activeCashPaymentMut = useMutation({
    mutationFn: (vals: { dealId: string; amount: number; method?: string; note?: string; paidAt?: string }) =>
      dealsApi.createPayment(vals.dealId, {
        amount: vals.amount,
        method: vals.method,
        note: vals.note,
        paidAt: vals.paidAt,
      }),
    onSuccess: () => {
      message.success('Платёж добавлен');
      activePayForm.resetFields();
      setActivePayModalOpen(false);
      setActivePayDeal(null);
      setActivePayMode('cash');
      invalidateAfterActivePayment();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Ошибка при добавлении платежа');
    },
  });

  const applyCreditMut = useMutation({
    mutationFn: (vals: { dealId: string; amount: number; note?: string; paidAt?: string }) =>
      financeApi.applyClientCreditToDeal(vals.dealId, {
        amount: vals.amount,
        note: vals.note,
        paidAt: vals.paidAt,
      }),
    onSuccess: () => {
      message.success('Переплата зачтена');
      activePayForm.resetFields();
      setActivePayModalOpen(false);
      setActivePayDeal(null);
      setActivePayMode('cash');
      invalidateAfterActivePayment();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Не удалось зачесть переплату');
    },
  });

  const openActivePayModal = useCallback(
    (row: ActiveDealRow) => {
      setActivePayDeal(row);
      setActivePayMode('cash');
      activePayForm.resetFields();
      activePayForm.setFieldsValue({
        paidAt: dayjs(),
        amount: undefined,
        method: undefined,
        note: undefined,
      });
      setActivePayModalOpen(true);
    },
    [activePayForm],
  );

  const activePayPreview = useMemo(() => {
    if (!activePayContext?.deal || activePayAmountWatch == null || Number.isNaN(Number(activePayAmountWatch))) {
      return null;
    }
    const pay = Number(activePayAmountWatch);
    if (pay <= 0) return null;
    const { amount: dealAmt, paidAmount } = activePayContext.deal;
    const creditCap = activePayContext.creditFromOtherDeals;

    if (activePayMode === 'credit') {
      const applied = Math.min(pay, creditCap);
      const newPaid = paidAmount + applied;
      const newRemaining = dealAmt - newPaid;
      const dealOverAfter = newRemaining < 0 ? -newRemaining : 0;
      return {
        applied,
        newRemaining: Math.max(0, newRemaining),
        dealOverAfter,
        label: 'Зачёт переплаты',
      };
    }

    const newPaid = paidAmount + pay;
    const newRemaining = dealAmt - newPaid;
    const dealOverAfter = newRemaining < 0 ? -newRemaining : 0;
    return {
      applied: pay,
      newRemaining: Math.max(0, newRemaining),
      dealOverAfter,
      label: 'Внесение средств',
    };
  }, [activePayContext, activePayAmountWatch, activePayMode]);

  const submitActivePay = async () => {
    if (!activePayDeal) return;
    const vals = await activePayForm.validateFields();
    const paidAtStr = vals.paidAt ? dayjs(vals.paidAt).toISOString() : undefined;
    const amt = Number(vals.amount);
    if (activePayMode === 'credit') {
      await applyCreditMut.mutateAsync({
        dealId: activePayDeal.dealId,
        amount: amt,
        note: vals.note,
        paidAt: paidAtStr,
      });
    } else {
      await activeCashPaymentMut.mutateAsync({
        dealId: activePayDeal.dealId,
        amount: amt,
        method: vals.method,
        note: vals.note,
        paidAt: paidAtStr,
      });
    }
  };

  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ label: c.companyName, value: c.id })),
    [clients],
  );

  const managers = useMemo(() => {
    if (!users) return [];
    return users
      .filter((u: { role: string; isActive: boolean }) =>
        ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'].includes(u.role) && u.isActive,
      )
      .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName }));
  }, [users]);

  const debtorClients: ClientDebtRow[] = debtsData?.clients ?? [];

  const filteredDebtors = useMemo(() => {
    let result = debtorClients;

    if (debtSearch) {
      const q = debtSearch.toLowerCase();
      result = result.filter(
        (c) =>
          c.clientName.toLowerCase().includes(q) ||
          c.manager?.fullName.toLowerCase().includes(q),
      );
    }

    result = [...result].sort((a, b) => {
      if (sortBy === 'debt_desc') return b.totalDebt - a.totalDebt;
      if (sortBy === 'newest') return (b.newestDealDate || '').localeCompare(a.newestDealDate || '');
      if (sortBy === 'oldest_unpaid') {
        const aDate = a.oldestUnpaidDueDate || '9999';
        const bDate = b.oldestUnpaidDueDate || '9999';
        return aDate.localeCompare(bDate);
      }
      return 0;
    });

    return result;
  }, [debtorClients, debtSearch, sortBy]);

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
      render: (v: number) => formatUZS(v),
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

  const paymentColumnsWithEntryType = [
    ...paymentColumns.slice(0, 5),
    {
      title: 'Тип прихода',
      dataIndex: 'entryType',
      width: 150,
      render: (v: CashboxPayment['entryType']) => (
        v === 'DEBT_COLLECTION'
          ? <Tag color="gold">Приход долга</Tag>
          : <Tag color="blue">Оплата продажи</Tag>
      ),
    },
    ...paymentColumns.slice(5),
  ];

  const activeDealColumns = [
    {
      title: 'Сделка',
      dataIndex: 'title',
      render: (v: string, r: ActiveDealRow) => (
        <Link to={`/deals/${r.dealId}`}>{v || r.dealId.slice(0, 8)}</Link>
      ),
    },
    {
      title: 'Клиент',
      dataIndex: 'clientName',
      render: (v: string, r: ActiveDealRow) => (
        <Link to={`/clients/${r.clientId}`}>{v}</Link>
      ),
    },
    {
      title: 'Сумма сделки',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: number) => formatUZS(v),
    },
    {
      title: 'Оплачено',
      dataIndex: 'paidAmount',
      align: 'right' as const,
      render: (v: number) => formatUZS(v),
    },
    {
      title: 'Остаток',
      dataIndex: 'remaining',
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#fa8c16' : tk.colorTextSecondary }}>{formatUZS(v)}</span>
      ),
    },
    {
      title: 'Менеджер',
      dataIndex: ['manager', 'fullName'],
      render: (_: unknown, r: ActiveDealRow) => r.manager?.fullName ?? '—',
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 160,
      render: (s: string) => <DealStatusTag status={s as DealStatus} />,
    },
    {
      title: '',
      key: 'pay',
      width: 130,
      fixed: 'right' as const,
      render: (_: unknown, r: ActiveDealRow) => (
        <Button type="link" size="small" onClick={() => openActivePayModal(r)}>
          Внести платёж
        </Button>
      ),
    },
  ];

  const debtorColumns = [
    {
      title: 'Клиент',
      dataIndex: 'clientName',
      render: (v: string, r: ClientDebtRow) => (
        <Link to={`/clients/${r.clientId}`}>{v}</Link>
      ),
    },
    {
      title: 'Общий долг',
      dataIndex: 'totalDebt',
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v < 0 ? '#52c41a' : '#ff4d4f' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0 }}>Касса</Typography.Title>
      </div>

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
                    { label: 'Вчера', value: 'yesterday' },
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
                  style={{ width: isMobile ? '100%' : 200 }}
                  value={clientId}
                  onChange={setClientId}
                  options={clientOptions}
                />
                <Select
                  allowClear
                  placeholder="Способ оплаты"
                  style={{ width: isMobile ? '100%' : 160 }}
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
                  style={{ width: isMobile ? '100%' : 160 }}
                  value={paymentStatus}
                  onChange={setPaymentStatus}
                  options={[
                    { label: 'Полностью', value: 'PAID' },
                    { label: 'Частично', value: 'PARTIAL' },
                  ]}
                />
                <Select
                  allowClear
                  placeholder="Тип прихода"
                  style={{ width: isMobile ? '100%' : 180 }}
                  value={entryType}
                  onChange={setEntryType}
                  options={[
                    { label: 'Приход долга', value: 'DEBT_COLLECTION' },
                    { label: 'Оплата продажи', value: 'SALE_PAYMENT' },
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
                        <span>{formatUZS(m.total)}</span>
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
                columns={paymentColumnsWithEntryType}
                rowKey="id"
                loading={isLoading}
                pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
                size="middle"
                bordered={false}
                scroll={{ x: 600 }}
                summary={() => data?.payments && data.payments.length > 0 ? (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}>Итого</Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      {formatUZS(data.totals.totalAmount)}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} colSpan={6} />
                  </Table.Summary.Row>
                ) : undefined}
              />
            </>
          ),
        },
        {
          key: 'active',
          label: `Активные${activeDealsData !== undefined ? ` (${activeDealsData.count})` : ''}`,
          children: (
            <>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                Сделки не в статусе «Закрыта»: сумма, оплаты и остаток по каждой сделке.
              </Typography.Paragraph>
              <Space wrap style={{ marginBottom: 16 }}>
                <Select
                  value={managerId}
                  onChange={(v) => setManagerId(v)}
                  allowClear
                  placeholder="Менеджер"
                  style={{ width: isMobile ? '100%' : 200 }}
                  options={managers}
                />
              </Space>
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={8}>
                  <Card size="small">
                    <Statistic
                      title="Сумма сделок"
                      value={activeDealsData?.totals.totalAmount ?? 0}
                      formatter={(v) => formatUZS(Number(v))}
                    />
                  </Card>
                </Col>
                <Col xs={24} sm={8}>
                  <Card size="small">
                    <Statistic
                      title="Оплачено"
                      value={activeDealsData?.totals.totalPaid ?? 0}
                      formatter={(v) => formatUZS(Number(v))}
                      valueStyle={{ color: '#52c41a' }}
                    />
                  </Card>
                </Col>
                <Col xs={24} sm={8}>
                  <Card size="small">
                    <Statistic
                      title="Остаток к оплате"
                      value={activeDealsData?.totals.totalRemaining ?? 0}
                      formatter={(v) => formatUZS(Number(v))}
                      valueStyle={{ color: '#fa8c16' }}
                    />
                  </Card>
                </Col>
              </Row>
              <Table
                dataSource={activeDealsData?.deals}
                columns={activeDealColumns}
                rowKey="dealId"
                loading={activeDealsLoading}
                pagination={{ defaultPageSize: 30, showSizeChanger: true, pageSizeOptions: ['20', '30', '50', '100'] }}
                size="middle"
                bordered={false}
                scroll={{ x: 860 }}
                locale={{ emptyText: 'Нет активных сделок' }}
              />
            </>
          ),
        },
        {
          key: 'debtors',
          label: `Долги${debtorClients.length > 0 ? ` (${debtorClients.length})` : ''}`,
          children: (
            <>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Input.Search
                  placeholder="Поиск по клиенту или менеджеру..."
                  style={{ width: isMobile ? '100%' : 300 }}
                  allowClear
                  value={debtSearch}
                  onChange={(e) => setDebtSearch(e.target.value)}
                />
                {debtsData?.totals && (
                  <Space size="large">
                    <Typography.Text type="secondary">
                      Клиентов: {debtsData.totals.clientCount}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      Общий долг: <span style={{ color: '#ff4d4f' }}>{formatUZS(debtsData.totals.totalDebtOwed)}</span>
                    </Typography.Text>
                  </Space>
                )}
              </div>

              <Space wrap style={{ marginBottom: 16 }}>
                <Select
                  value={debtRange}
                  onChange={(v) => setDebtRange(v)}
                  style={{ width: 180 }}
                  options={[
                    { value: 'all', label: 'Сумма долга: все' },
                    { value: '1m', label: '> 1 000 000' },
                    { value: '5m', label: '> 5 000 000' },
                    { value: '10m', label: '> 10 000 000' },
                    { value: 'custom', label: 'Свой диапазон' },
                  ]}
                />
                {debtRange === 'custom' && (
                  <InputNumber
                    placeholder="Мин. сумма"
                    style={{ width: 160 }}
                    min={0}
                    step={100000}
                    value={customMin}
                    onChange={(v) => setCustomMin(v)}
                    formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : ''}
                    parser={(v) => Number((v || '').replace(/\s/g, ''))}
                  />
                )}
                <Select
                  value={debtStatus}
                  onChange={(v) => setDebtStatus(v)}
                  style={{ width: 180 }}
                  options={[
                    { value: 'all', label: 'Статус: все' },
                    { value: 'PARTIAL', label: 'Частичная оплата' },
                    { value: 'UNPAID', label: 'Без оплаты' },
                  ]}
                />
                <Select
                  value={managerId}
                  onChange={(v) => setManagerId(v)}
                  allowClear
                  placeholder="Менеджер"
                  style={{ width: isMobile ? '100%' : 200 }}
                  options={managers}
                />
                <Select
                  value={sortBy}
                  onChange={(v) => setSortBy(v)}
                  style={{ width: isMobile ? '100%' : 220 }}
                  options={[
                    { value: 'debt_desc', label: 'Сортировка: наибольший долг' },
                    { value: 'newest', label: 'Сортировка: новые сделки' },
                    { value: 'oldest_unpaid', label: 'Сортировка: старые неоплаты' },
                  ]}
                />
              </Space>

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
        width={isMobile ? '100%' : 600}
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
                      border: `1px solid ${isSelected ? tk.colorPrimary : tk.colorBorderSecondary}`,
                      borderRadius: 6,
                      marginBottom: 8,
                      cursor: 'pointer',
                      background: isSelected ? tk.colorPrimaryBg : tk.colorBgContainer,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{deal.title || deal.id.slice(0, 8)}</span>
                      <span style={{ color: '#ff4d4f' }}>
                        Долг: {formatUZS(debt)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: tk.colorTextSecondary }}>
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

      {/* Платёж по активной сделке (касса) */}
      <Modal
        title={activePayDeal ? `Платёж — ${activePayDeal.title || activePayDeal.dealId.slice(0, 8)}` : 'Платёж'}
        open={activePayModalOpen}
        onCancel={() => {
          setActivePayModalOpen(false);
          setActivePayDeal(null);
          setActivePayMode('cash');
          activePayForm.resetFields();
        }}
        onOk={submitActivePay}
        okText={activePayMode === 'credit' ? 'Зачесть переплату' : 'Сохранить платёж'}
        confirmLoading={activeCashPaymentMut.isPending || applyCreditMut.isPending}
        width={isMobile ? '100%' : 520}
        destroyOnClose
      >
        {activePayContextLoading || !activePayContext ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <>
            <Typography.Paragraph style={{ marginBottom: 8 }} type="secondary">
              <Link to={`/clients/${activePayContext.deal.clientId}`}>{activePayContext.deal.clientName}</Link>
              {' · '}
              <Link to={`/deals/${activePayContext.deal.dealId}`}>открыть сделку</Link>
            </Typography.Paragraph>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: tk.colorTextSecondary }}>Сумма сделки</span>
              <span style={{ textAlign: 'right' }}>{formatUZS(activePayContext.deal.amount)}</span>
              <span style={{ color: tk.colorTextSecondary }}>Уже оплачено</span>
              <span style={{ textAlign: 'right' }}>{formatUZS(activePayContext.deal.paidAmount)}</span>
              <span style={{ color: tk.colorTextSecondary }}>Остаток по сделке</span>
              <span style={{ textAlign: 'right', color: activePayContext.deal.remaining > 0 ? '#fa8c16' : undefined }}>
                {formatUZS(activePayContext.deal.remaining)}
              </span>
              {activePayContext.deal.overpaymentOnThisDeal > 0 && (
                <>
                  <span style={{ color: tk.colorTextSecondary }}>Переплата на этой сделке</span>
                  <span style={{ textAlign: 'right', color: '#52c41a' }}>
                    {formatUZS(activePayContext.deal.overpaymentOnThisDeal)}
                  </span>
                </>
              )}
              <span style={{ color: tk.colorTextSecondary }}>Переплата на других сделках</span>
              <span style={{ textAlign: 'right', color: activePayContext.creditFromOtherDeals > 0 ? '#52c41a' : undefined }}>
                {activePayContext.creditFromOtherDeals > 0 ? formatUZS(activePayContext.creditFromOtherDeals) : '—'}
              </span>
            </div>

            <Space wrap size="small" style={{ marginBottom: 12 }}>
              <Button
                size="small"
                type={activePayMode === 'cash' && activePayContext.deal.remaining > 0 ? 'primary' : 'default'}
                onClick={() => {
                  setActivePayMode('cash');
                  activePayForm.setFieldsValue({
                    amount: Math.max(0, activePayContext.deal.remaining),
                  });
                }}
                disabled={activePayContext.deal.remaining <= 0}
              >
                Погасить весь остаток
              </Button>
              <Button
                size="small"
                type={activePayMode === 'credit' ? 'primary' : 'default'}
                onClick={() => {
                  const credit = activePayContext.creditFromOtherDeals;
                  if (credit <= 0) {
                    message.info('Нет переплаты на других сделках клиента (в вашей зоне видимости)');
                    return;
                  }
                  setActivePayMode('credit');
                  const rem = activePayContext.deal.remaining;
                  const amt = rem > 0 ? Math.min(rem, credit) : credit;
                  activePayForm.setFieldsValue({ amount: amt });
                }}
                disabled={activePayContext.creditFromOtherDeals <= 0}
              >
                Использовать переплату
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setActivePayMode('cash');
                  activePayForm.setFieldsValue({ amount: undefined });
                }}
              >
                Частичная оплата
              </Button>
            </Space>

            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              {activePayMode === 'credit'
                ? 'Сумма спишется с переплаты на других сделках (проводка «Перечисление» в истории).'
                : 'Сумма выше остатка не блокируется — лишнее останется как переплата на этой сделке.'}
            </Typography.Text>

            <Form form={activePayForm} layout="vertical" size="small">
              <Form.Item
                name="amount"
                label="Сумма"
                rules={[{ required: true, message: 'Введите сумму' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  formatter={moneyFormatter}
                  parser={(v) => Number(moneyParser(v))}
                />
              </Form.Item>
              <Form.Item name="paidAt" label="Дата оплаты" initialValue={dayjs()}>
                <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" disabledDate={(d) => !!d && d.isAfter(dayjs().endOf('day'))} />
              </Form.Item>
              {activePayMode === 'cash' && (
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
                      { label: 'Рассрочка', value: 'INSTALLMENT' },
                    ]}
                  />
                </Form.Item>
              )}
              <Form.Item name="note" label="Комментарий">
                <Input.TextArea rows={2} placeholder="Необязательно" />
              </Form.Item>
            </Form>

            {activePayPreview && (
              <Card size="small" style={{ marginTop: 8, background: tk.colorFillAlter }}>
                <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                  Итого до сохранения
                </Typography.Text>
                <div style={{ fontSize: 13 }}>
                  <div>{activePayPreview.label}: <strong>{formatUZS(activePayPreview.applied)}</strong></div>
                  <div>Остаток по сделке после: <strong>{formatUZS(activePayPreview.newRemaining)}</strong></div>
                  {activePayPreview.dealOverAfter > 0 && (
                    <div style={{ color: '#52c41a' }}>
                      Переплата на сделке: <strong>{formatUZS(activePayPreview.dealOverAfter)}</strong>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
