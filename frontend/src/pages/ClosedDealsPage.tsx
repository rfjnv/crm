import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography, Input, Tag, Space, Select, Button, DatePicker, Segmented } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { dealsApi } from '../api/deals.api';
import { usersApi } from '../api/users.api';
import DealStatusTag from '../components/DealStatusTag';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { formatUZS } from '../utils/currency';
import { dealListTitle } from '../utils/dealListTitle';
import type { Deal, PaymentStatus } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

/** Календарная дата в Ташкенте (YYYY-MM-DD). */
function tashkentYmd(d = new Date()): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
}

function isoRangeForTashkentYmd(ymd: string): { closedFrom: string; closedTo: string } {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00+05:00`).toISOString();
  const to = new Date(`${y}-${pad(m)}-${pad(d)}T23:59:59.999+05:00`).toISOString();
  return { closedFrom: from, closedTo: to };
}

function addDaysToYmd(ymd: string, delta: number): string {
  const { closedFrom } = isoRangeForTashkentYmd(ymd);
  const ms = new Date(closedFrom).getTime() + delta * 24 * 60 * 60 * 1000;
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
}

type PeriodKey = 'all' | 'today' | 'yesterday' | 'custom';

export default function ClosedDealsPage() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | 'all'>('all');
  const [managerId, setManagerId] = useState<string | undefined>(undefined);

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: usersApi.list,
  });

  const managers = useMemo(() => {
    if (!users) return [];
    return users
      .filter((u: { role: string; isActive: boolean }) =>
        ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'].includes(u.role) && u.isActive,
      )
      .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName }));
  }, [users]);

  const listFilters = useMemo(() => {
    let closedFrom: string | undefined;
    let closedTo: string | undefined;
    if (period === 'today') {
      const r = isoRangeForTashkentYmd(tashkentYmd());
      closedFrom = r.closedFrom;
      closedTo = r.closedTo;
    } else if (period === 'yesterday') {
      const r = isoRangeForTashkentYmd(addDaysToYmd(tashkentYmd(), -1));
      closedFrom = r.closedFrom;
      closedTo = r.closedTo;
    } else if (period === 'custom' && customRange?.[0] && customRange[1]) {
      const a = customRange[0].format('YYYY-MM-DD');
      const b = customRange[1].format('YYYY-MM-DD');
      closedFrom = isoRangeForTashkentYmd(a).closedFrom;
      closedTo = isoRangeForTashkentYmd(b).closedTo;
    }
    return {
      paymentStatus: paymentFilter === 'all' ? undefined : paymentFilter,
      managerId,
      closedFrom,
      closedTo,
    };
  }, [period, customRange, paymentFilter, managerId]);

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', 'CLOSED', 'history', listFilters],
    queryFn: () => dealsApi.list('CLOSED', true, listFilters),
  });

  const filtered = (deals ?? []).filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const listTitle = dealListTitle(d).toLowerCase();
    return (
      listTitle.includes(q) ||
      d.title.toLowerCase().includes(q) ||
      (d.client?.companyName ?? '').toLowerCase().includes(q)
    );
  });

  const columns = [
    {
      title: 'Сделка',
      dataIndex: 'title',
      render: (_v: string, r: Deal) => (
        <Link to={`/deals/${r.id}`}>{dealListTitle(r)}</Link>
      ),
    },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, r: Deal) => <ClientCompanyDisplay client={r.client} link />,
    },
    { title: 'Статус', dataIndex: 'status', render: () => <DealStatusTag status="CLOSED" /> },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Оплата',
      dataIndex: 'paymentStatus',
      render: (s: PaymentStatus) => {
        const cfg = paymentStatusLabels[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    {
      title: 'Дата закрытия',
      key: 'closedAt',
      render: (_: unknown, r: Deal) => {
        const d = r.closedAt ?? r.updatedAt;
        return d ? dayjs(d).format('DD.MM.YYYY HH:mm') : '—';
      },
    },
  ];

  const resetFilters = () => {
    setPeriod('all');
    setCustomRange(null);
    setPaymentFilter('all');
    setManagerId(undefined);
    setSearch('');
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0, flex: 1, minWidth: 200 }}>
          История закрытых сделок
        </Typography.Title>
      </div>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 16, maxWidth: 720 }}>
        В колонке «Сделка» в конце указана дата <strong>создания</strong> (Ташкент); «Дата закрытия» — когда сделку
        перевели в «Закрыто».
      </Typography.Paragraph>

      <Space direction="vertical" size="middle" style={{ width: '100%', marginBottom: 16 }}>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
            Период (часовой пояс Ташкент)
          </Typography.Text>
          <Space wrap align="center">
            <Segmented<PeriodKey>
              value={period}
              onChange={(v) => {
                setPeriod(v);
                if (v !== 'custom') setCustomRange(null);
              }}
              options={[
                { label: 'Все', value: 'all' },
                { label: 'Сегодня', value: 'today' },
                { label: 'Вчера', value: 'yesterday' },
                { label: 'Свой период', value: 'custom' },
              ]}
            />
            {period === 'custom' && (
              <DatePicker.RangePicker
                value={customRange}
                onChange={(r) => setCustomRange(r as [Dayjs, Dayjs] | null)}
                format="DD.MM.YYYY"
                allowClear
              />
            )}
          </Space>
        </div>

        <Space wrap style={{ width: '100%' }}>
          <Select<PaymentStatus | 'all'>
            value={paymentFilter}
            onChange={setPaymentFilter}
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
            value={managerId}
            onChange={setManagerId}
            options={managers}
          />
          <Input.Search
            placeholder="Поиск по названию или клиенту..."
            style={{ width: isMobile ? '100%' : 280 }}
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button onClick={resetFilters}>Сбросить фильтры</Button>
        </Space>
      </Space>

      <Table
        dataSource={filtered}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
        size="middle"
        bordered={false}
        locale={{ emptyText: 'Нет закрытых сделок по выбранным условиям' }}
        scroll={{ x: 600 }}
      />
    </div>
  );
}
