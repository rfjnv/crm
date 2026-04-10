import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Typography, Input, Tag, Select, Space, InputNumber, Card } from 'antd';
import { financeApi } from '../api/finance.api';
import { usersApi } from '../api/users.api';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { formatUZS } from '../utils/currency';
import type { ClientDebtRow } from '../types';
import dayjs from 'dayjs';

type DebtRange = 'all' | '1m' | '5m' | '10m' | 'custom';
type DebtStatus = 'all' | 'PARTIAL' | 'UNPAID';
type SortOption = 'debt_desc' | 'newest' | 'oldest_unpaid';

export default function DebtsPage() {
  const [search, setSearch] = useState('');
  const [debtRange, setDebtRange] = useState<DebtRange>('all');
  const [customMin, setCustomMin] = useState<number | null>(null);
  const [debtStatus, setDebtStatus] = useState<DebtStatus>('all');
  const [managerId, setManagerId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortOption>('debt_desc');
  const isMobile = useIsMobile();

  const params = useMemo(() => {
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

  const { data, isLoading } = useQuery({
    queryKey: ['finance-debts', params],
    queryFn: () => financeApi.getDebts(params),
  });

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: usersApi.list,
  });

  const clients: ClientDebtRow[] = data?.clients ?? [];
  const totals = data?.totals;

  const managers = useMemo(() => {
    if (!users) return [];
    return users
      .filter((u: { role: string; isActive: boolean }) =>
        ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'].includes(u.role) && u.isActive,
      )
      .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName }));
  }, [users]);

  const filtered = useMemo(() => {
    let result = clients;

    if (search) {
      const q = search.toLowerCase();
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
  }, [clients, search, sortBy]);

  const columns = [
    {
      title: 'Клиент',
      key: 'clientName',
      render: (_: unknown, r: ClientDebtRow) => (
        <ClientCompanyDisplay
          client={{ id: r.clientId, companyName: r.clientName, isSvip: r.isSvip }}
          link
        />
      ),
    },
    {
      title: 'Общий долг',
      dataIndex: 'totalDebt',
      key: 'totalDebt',
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v < 0 ? '#52c41a' : '#ff4d4f' }}>
          {v < 0 ? `−${formatUZS(Math.abs(v))} (переплата)` : formatUZS(v)}
        </span>
      ),
    },
    {
      title: 'Сумма сделок',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      align: 'right' as const,
      render: (v: number) => (
        <Typography.Text type="secondary">{formatUZS(v)}</Typography.Text>
      ),
    },
    {
      title: 'Оплачено',
      dataIndex: 'totalPaid',
      key: 'totalPaid',
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
      key: 'dealsCount',
      align: 'center' as const,
    },
    {
      title: 'Последний платёж',
      dataIndex: 'lastPaymentDate',
      key: 'lastPaymentDate',
      render: (v: string | null) => (v ? dayjs(v).format('DD.MM.YYYY') : '\u2014'),
    },
    {
      title: 'Менеджер',
      dataIndex: ['manager', 'fullName'],
      key: 'manager',
      render: (v: string | null) => v || '\u2014',
    },
    {
      title: 'Статус',
      dataIndex: 'paymentStatus',
      key: 'paymentStatus',
      render: (s: string) => {
        if (s === 'PARTIAL') return <Tag color="orange">Частично</Tag>;
        return <Tag color="default">Не оплачено</Tag>;
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <BackButton fallback="/dashboard" />
          <Typography.Title level={4} style={{ margin: 0 }}>Долги</Typography.Title>
        </div>
        <Input.Search
          placeholder="Поиск по клиенту или менеджеру..."
          style={{ width: isMobile ? '100%' : 300 }}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          value={debtRange}
          onChange={(v) => setDebtRange(v)}
          style={{ width: isMobile ? '100%' : 180 }}
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
            style={{ width: isMobile ? '100%' : 160 }}
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
          style={{ width: isMobile ? '100%' : 180 }}
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

      {totals && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Typography.Text type="secondary">
            Клиентов: {totals.clientCount}
          </Typography.Text>
          <Typography.Text type="secondary">
            Сделок: {totals.dealsCount}
          </Typography.Text>
          <Typography.Text type="secondary">
            Передоплаты: <span style={{ color: '#52c41a', fontWeight: 600 }}>{formatUZS(Math.abs(totals.prepayments ?? 0))}</span>
          </Typography.Text>
          <Typography.Text type="secondary">
            Общий долг: <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{formatUZS(totals.totalDebtGiven ?? 0)}</span>
          </Typography.Text>
        </div>
      )}

      {isMobile ? (
        <MobileCardList<ClientDebtRow>
          data={filtered}
          loading={isLoading}
          rowKey="clientId"
          emptyText="Нет задолженностей"
          renderCard={(record) => (
            <Card size="small">
              <div style={{ marginBottom: 8, fontSize: 15 }}>
                <ClientCompanyDisplay
                  client={{ id: record.clientId, companyName: record.clientName, isSvip: record.isSvip }}
                  link
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Typography.Text type="secondary">Общий долг</Typography.Text>
                <span style={{ color: record.totalDebt < 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
                  {record.totalDebt < 0 ? `−${formatUZS(Math.abs(record.totalDebt))}` : formatUZS(record.totalDebt)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Typography.Text type="secondary">Сделок</Typography.Text>
                <Typography.Text>{record.dealsCount}</Typography.Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Typography.Text type="secondary">Последний платёж</Typography.Text>
                <Typography.Text>{record.lastPaymentDate ? dayjs(record.lastPaymentDate).format('DD.MM.YYYY') : '\u2014'}</Typography.Text>
              </div>
              <div style={{ marginTop: 4 }}>
                {record.paymentStatus === 'PARTIAL' ? <Tag color="orange">Частично</Tag> : <Tag color="default">Не оплачено</Tag>}
              </div>
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="clientId"
          loading={isLoading}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          size="middle"
          bordered={false}
          locale={{ emptyText: 'Нет задолженностей' }}
          onRow={(_record) => ({
            style: { cursor: 'pointer' },
          })}
        />
      )}
    </div>
  );
}
