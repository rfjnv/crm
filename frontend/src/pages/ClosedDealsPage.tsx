import { useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Table, Typography, Input, Tag, Space, Select, Button, DatePicker, Segmented } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { dealsApi } from '../api/deals.api';
import { usersApi } from '../api/users.api';
import DealStatusTag from '../components/DealStatusTag';
import ReceiptPunchedTag from '../components/ReceiptPunchedTag';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { formatUZS } from '../utils/currency';
import type { Deal, PaymentStatus } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import { getFirstName } from '../lib/name-utils';

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
  const [params, setParams] = useSearchParams();

  const period = (params.get('period') as PeriodKey) || 'all';
  const customFrom = params.get('customFrom');
  const customTo = params.get('customTo');
  const paymentFilter = (params.get('payment') as PaymentStatus | 'all') || 'all';
  const managerId = params.get('manager') || undefined;
  const search = params.get('q') || '';

  const customRange: [Dayjs, Dayjs] | null =
    customFrom && customTo ? [dayjs(customFrom), dayjs(customTo)] : null;

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
      .map((u: { id: string; fullName: string }) => ({ value: u.id, label: getFirstName(u.fullName) }));
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

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Поиск уходит на сервер, поэтому не на каждое нажатие клавиши.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  // Сменились условия — список другой, и текущая страница к нему не относится.
  // Правка прямо в рендере, а не в эффекте: иначе первый запрос уйдёт со старым
  // номером страницы и вернёт данные, которые тут же будут выброшены.
  const filtersKey = JSON.stringify([listFilters, debouncedSearch]);
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['deals', 'CLOSED', 'history', listFilters, debouncedSearch, page, pageSize],
    queryFn: () =>
      dealsApi.listPaged(page, pageSize, 'CLOSED', true, {
        ...listFilters,
        search: debouncedSearch || undefined,
      }),
    // Без этого таблица моргает пустотой при каждом переходе по страницам.
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;

  const columns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, r: Deal) => <ClientCompanyDisplay client={r.client} link />,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      render: (_: unknown, r: Deal) => (
        <Space size={4} wrap>
          <DealStatusTag status="CLOSED" />
          <ReceiptPunchedTag isReceiptPunched={r.isReceiptPunched} />
        </Space>
      ),
    },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Оплата',
      dataIndex: 'paymentStatus',
      render: (s: PaymentStatus) => {
        const cfg = paymentStatusLabels[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'], render: (v: string) => getFirstName(v) || v },
    {
      title: 'Дата закрытия',
      key: 'closedAt',
      render: (_: unknown, r: Deal) =>
        r.closedAt ? dayjs(r.closedAt).format('DD.MM.YYYY HH:mm') : '—',
    },
  ];

  const resetFilters = () => setParams(new URLSearchParams());

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0, flex: 1, minWidth: 200 }}>
          История закрытых сделок
        </Typography.Title>
      </div>

      <Space direction="vertical" size="middle" style={{ width: '100%', marginBottom: 16 }}>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
            Период (часовой пояс Ташкент)
          </Typography.Text>
          <Space wrap align="center">
            <Segmented<PeriodKey>
              value={period}
              onChange={(v) => {
                setParams((prev) => {
                  const next = new URLSearchParams(prev);
                  if (v === 'all') next.delete('period');
                  else next.set('period', v);
                  if (v !== 'custom') {
                    next.delete('customFrom');
                    next.delete('customTo');
                  }
                  return next;
                });
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
                onChange={(r) => {
                  setParams((prev) => {
                    const next = new URLSearchParams(prev);
                    if (r?.[0] && r[1]) {
                      next.set('customFrom', r[0].format('YYYY-MM-DD'));
                      next.set('customTo', r[1].format('YYYY-MM-DD'));
                    } else {
                      next.delete('customFrom');
                      next.delete('customTo');
                    }
                    return next;
                  });
                }}
                format="DD.MM.YYYY"
                allowClear
              />
            )}
          </Space>
        </div>

        <Space wrap style={{ width: '100%' }}>
          <Select<PaymentStatus | 'all'>
            value={paymentFilter}
            onChange={(v) => {
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (v === 'all') next.delete('payment');
                else next.set('payment', v);
                return next;
              });
            }}
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
            onChange={(v) => {
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (!v) next.delete('manager');
                else next.set('manager', v);
                return next;
              });
            }}
            options={managers}
          />
          <Input.Search
            placeholder="Поиск по названию или клиенту..."
            style={{ width: isMobile ? '100%' : 280 }}
            allowClear
            value={search}
            onChange={(e) => {
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (!e.target.value) next.delete('q');
                else next.set('q', e.target.value);
                return next;
              });
            }}
          />
          <Button onClick={resetFilters}>Сбросить фильтры</Button>
        </Space>
      </Space>

      <Table
        dataSource={rows}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
          },
        }}
        size="middle"
        bordered={false}
        locale={{ emptyText: 'Нет закрытых сделок по выбранным условиям' }}
        scroll={{ x: 600 }}
      />
    </div>
  );
}
