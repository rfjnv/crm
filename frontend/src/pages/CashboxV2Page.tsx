import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Table, Typography, Select, Card, Tag, Space, Segmented, Tabs, Input, Button, InputNumber,
  message, Spin, DatePicker, List, Empty, Drawer, Badge, Alert, Checkbox, Radio, Popover, Modal, theme,
  notification,
} from 'antd';
import { SearchOutlined, FilterOutlined, DownloadOutlined, PrinterOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { cashboxV2Api, type ToPayDeal, type PaymentMethodCode, type ReceiptDeal } from '../api/cashboxV2.api';
import { useAuthStore } from '../store/authStore';
import { financeApi, type CashboxPayment } from '../api/finance.api';
import { dealsApi } from '../api/deals.api';
import { usersApi } from '../api/users.api';
import DealStatusTag from '../components/DealStatusTag';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { matchesSearch } from '../utils/translit';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { downloadCsv } from '../utils/csv';
import { UsdPaymentTag } from '../components/UsdPaymentFields';
import { useIsMobile } from '../hooks/useIsMobile';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { getFirstName } from '../lib/name-utils';
import type { DealStatus } from '../types';

/**
 * «Касса 2.0».
 *
 * Старая касса: три вкладки, где «Активные» и «Долги» показывали одно и то же с разной
 * группировкой, а приём денег шёл через цепочку из двух-трёх модалок и по одной сделке
 * за раз. Здесь поиск всегда на виду, один список «К оплате» и боковая панель, которая
 * раскладывает одну сумму на несколько сделок клиента.
 */

const METHODS: { value: PaymentMethodCode; label: string }[] = [
  { value: 'CASH', label: 'Наличные' },
  { value: 'TRANSFER', label: 'Перечисление' },
  { value: 'CLICK', label: 'Click' },
  { value: 'PAYME', label: 'Payme' },
  { value: 'TERMINAL', label: 'Терминал' },
  { value: 'QR', label: 'QR' },
  { value: 'INSTALLMENT', label: 'Рассрочка' },
];
const methodLabel = (m: string | null | undefined) =>
  METHODS.find((x) => x.value === m)?.label ?? (m || '—');

const nonCashTag: Record<string, { color: string; label: string }> = {
  CREDIT_TRANSFER: { color: 'purple', label: 'Зачёт переплаты' },
  ADJUSTMENT: { color: 'default', label: 'Выравнивание' },
};

const LAST_METHOD_KEY = 'cashbox2.lastMethod';

function readLastMethod(): PaymentMethodCode | undefined {
  try {
    const v = localStorage.getItem(LAST_METHOD_KEY);
    return METHODS.some((m) => m.value === v) ? (v as PaymentMethodCode) : undefined;
  } catch {
    return undefined;
  }
}

function saveLastMethod(m: PaymentMethodCode) {
  try { localStorage.setItem(LAST_METHOD_KEY, m); } catch { /* приватный режим — не страшно */ }
}

/** Курс меняется раз в день — кассиру незачем вбивать его заново на каждой оплате. */
const LAST_USD_RATE_KEY = 'cashbox2.lastUsdRate';

function readLastUsdRate(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_USD_RATE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveLastUsdRate(rate: number) {
  try { localStorage.setItem(LAST_USD_RATE_KEY, String(rate)); } catch { /* не страшно */ }
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const daysAgo = (iso: string) => Math.max(0, dayjs().startOf('day').diff(dayjs(iso).startOf('day'), 'day'));

/** Начало сегодняшних суток по Ташкенту (UTC+5) — независимо от пояса браузера. */
function tashkentStartOfToday(): number {
  const OFFSET = 5 * 3600_000;
  const DAY = 86_400_000;
  return Math.floor((Date.now() + OFFSET) / DAY) * DAY - OFFSET;
}

type JournalPeriod = 'day' | 'yesterday' | '7d' | '30d' | 'custom';

/** Границы журнала. «7 дней» — это сегодня и шесть предыдущих, а не восемь календарных дней. */
function periodRange(period: JournalPeriod, custom: [Dayjs, Dayjs] | null): { from: string; to?: string } | null {
  const DAY = 86_400_000;
  const today = tashkentStartOfToday();
  if (period === 'day') return { from: new Date(today).toISOString() };
  if (period === 'yesterday') return { from: new Date(today - DAY).toISOString(), to: new Date(today).toISOString() };
  if (period === '7d') return { from: new Date(today - 6 * DAY).toISOString() };
  if (period === '30d') return { from: new Date(today - 29 * DAY).toISOString() };
  if (!custom) return null;
  return { from: custom[0].startOf('day').toISOString(), to: custom[1].endOf('day').toISOString() };
}

/**
 * Отметка «чек пробит». По закрытой сделке бэкенд разрешает её только админам, зав. складом
 * и тем, у кого есть edit_closed_deal, — кнопку гасим заранее, а не ловим 403 после нажатия.
 */
function useReceiptPunch() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const mayPunchClosed = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
    || user?.role === 'WAREHOUSE_MANAGER' || !!user?.permissions?.includes('edit_closed_deal');
  const canPunch = (status: string) => status !== 'CLOSED' || mayPunchClosed;

  const mut = useMutation({
    mutationFn: ({ dealIds, value }: { dealIds: string[]; value: boolean }) =>
      Promise.all(dealIds.map((id) => dealsApi.update(id, { isReceiptPunched: value }))),
    onSuccess: (_res, { dealIds }) => {
      queryClient.invalidateQueries({ queryKey: ['cashbox2-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['finance-active-deals'] });
      for (const id of dealIds) queryClient.invalidateQueries({ queryKey: ['deal', id] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.error || 'Не удалось изменить отметку чека');
    },
  });

  return { canPunch, mut };
}

interface ClientRow {
  clientId: string;
  clientName: string;
  clientIsSvip: boolean;
  debt: number;
  dealsCount: number;
  oldestCreatedAt: string;
  managers: string[];
}

export default function CashboxV2Page() {
  const isMobile = useIsMobile();
  const { token: tk } = theme.useToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab = tabParam === 'journal' || tabParam === 'receipts' ? tabParam : 'topay';
  const setTab = useCallback((key: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key === 'topay') next.delete('tab'); else next.set('tab', key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ?q= — поиск с дашборда бухгалтера
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [view, setView] = useState<'clients' | 'deals'>('clients');
  const [managerId, setManagerId] = useState<string>();
  const [panel, setPanel] = useState<{ clientId: string; dealId?: string } | null>(null);

  const { data: toPay, isLoading: toPayLoading, error: toPayError } = useQuery({
    queryKey: ['cashbox2-to-pay', managerId],
    queryFn: () => cashboxV2Api.toPay(managerId ? { managerId } : undefined),
    refetchInterval: 60_000,
  });

  const { data: users } = useQuery({ queryKey: ['users-list'], queryFn: () => usersApi.list() });

  const { data: receipts, isLoading: receiptsLoading } = useQuery({
    queryKey: ['cashbox2-receipts'],
    queryFn: cashboxV2Api.receipts,
    refetchInterval: 60_000,
  });

  const managers = useMemo(() => (users ?? [])
    .filter((u: { role: string; isActive: boolean }) =>
      ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'].includes(u.role) && u.isActive)
    .map((u: { id: string; fullName: string }) => ({ value: u.id, label: getFirstName(u.fullName) })), [users]);

  const staff = useMemo(() => (users ?? [])
    .filter((u: { isActive: boolean }) => u.isActive)
    .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName })), [users]);

  const filteredDeals = useMemo(() => {
    const deals = toPay?.deals ?? [];
    const q = search.trim();
    if (!q) return deals;
    return deals.filter((d) =>
      matchesSearch(d.clientName, q)
      || matchesSearch(d.title, q)
      || matchesSearch(d.contractNumber, q)
      || matchesSearch(d.manager?.fullName, q));
  }, [toPay, search]);

  const clientRows = useMemo<ClientRow[]>(() => {
    const map = new Map<string, ClientRow>();
    for (const d of filteredDeals) {
      let row = map.get(d.clientId);
      if (!row) {
        row = {
          clientId: d.clientId,
          clientName: d.clientName,
          clientIsSvip: d.clientIsSvip,
          debt: 0,
          dealsCount: 0,
          oldestCreatedAt: d.createdAt,
          managers: [],
        };
        map.set(d.clientId, row);
      }
      row.debt += d.remaining;
      row.dealsCount += 1;
      if (d.createdAt < row.oldestCreatedAt) row.oldestCreatedAt = d.createdAt;
      const m = getFirstName(d.manager?.fullName);
      if (m && !row.managers.includes(m)) row.managers.push(m);
    }
    return [...map.values()].sort((a, b) => b.debt - a.debt);
  }, [filteredDeals]);

  // «По сделкам» кассир ищет только что оформленный заказ — новые сверху.
  // (filteredDeals остаётся от старых к новым: в этом порядке раскладывается оплата.)
  const dealsNewestFirst = useMemo(
    () => [...filteredDeals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [filteredDeals],
  );

  // В «К оплате» только должники; клиента без долга (пришёл с предоплатой) ищем на сервере.
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const { data: searchHits } = useQuery({
    queryKey: ['cashbox2-client-search', debouncedSearch],
    queryFn: () => cashboxV2Api.searchClients(debouncedSearch),
    enabled: debouncedSearch.length >= 2,
    staleTime: 30_000,
  });
  const noDebtClients = useMemo(() => {
    if (!search.trim() || !searchHits) return [];
    const debtors = new Set((toPay?.deals ?? []).map((d) => d.clientId));
    return searchHits.filter((c) => !debtors.has(c.clientId));
  }, [searchHits, toPay, search]);

  const emptyToPay = !search ? 'Долгов нет' : noDebtClients.length > 0 ? 'Должников не найдено' : 'Ничего не найдено';

  const openClient = (clientId: string, dealId?: string) => setPanel({ clientId, dealId });

  // Enter в поиске при единственном совпадении сразу открывает оплату.
  const onSearchEnter = () => {
    if (clientRows.length === 1) openClient(clientRows[0].clientId);
    else if (clientRows.length === 0 && noDebtClients.length === 1) openClient(noDebtClients[0].clientId);
  };

  const clientColumns = [
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, r: ClientRow) => (
        <ClientCompanyDisplay client={{ id: r.clientId, companyName: r.clientName, isSvip: r.clientIsSvip }} />
      ),
    },
    {
      title: 'Долг',
      dataIndex: 'debt',
      align: 'right' as const,
      sorter: (a: ClientRow, b: ClientRow) => a.debt - b.debt,
      render: (v: number) => <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{formatUZS(v)}</Typography.Text>,
    },
    {
      title: 'Сделок',
      dataIndex: 'dealsCount',
      align: 'center' as const,
      width: 80,
    },
    {
      title: 'Самый старый долг',
      dataIndex: 'oldestCreatedAt',
      width: 170,
      sorter: (a: ClientRow, b: ClientRow) => a.oldestCreatedAt.localeCompare(b.oldestCreatedAt),
      render: (v: string) => {
        const days = daysAgo(v);
        return (
          <span>
            {dayjs(v).format('DD.MM.YYYY')}
            <Typography.Text type={days > 30 ? 'danger' : 'secondary'} style={{ fontSize: 12, marginLeft: 6 }}>
              {days} дн.
            </Typography.Text>
          </span>
        );
      },
    },
    {
      title: 'Менеджер',
      dataIndex: 'managers',
      width: 160,
      render: (v: string[]) => v.join(', ') || '—',
    },
    {
      title: '',
      key: 'pay',
      width: 110,
      render: (_: unknown, r: ClientRow) => (
        <Button type="primary" size="small" onClick={(e) => { e.stopPropagation(); openClient(r.clientId); }}>
          Принять
        </Button>
      ),
    },
  ];

  const dealColumns = [
    {
      title: 'Сделка',
      dataIndex: 'title',
      render: (v: string | null, r: ToPayDeal) => (
        <div style={{ lineHeight: 1.3 }}>
          <div>{v || r.dealId.slice(0, 8)}</div>
          {r.contractNumber && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>договор №{r.contractNumber}</Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, r: ToPayDeal) => (
        <ClientCompanyDisplay client={{ id: r.clientId, companyName: r.clientName, isSvip: r.clientIsSvip }} />
      ),
    },
    {
      title: 'Остаток',
      dataIndex: 'remaining',
      align: 'right' as const,
      sorter: (a: ToPayDeal, b: ToPayDeal) => a.remaining - b.remaining,
      render: (v: number, r: ToPayDeal) => (
        <div style={{ lineHeight: 1.3, whiteSpace: 'nowrap' }}>
          <Typography.Text strong>{formatUZS(v)}</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>из {formatUZS(r.amount)}</Typography.Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Создана',
      dataIndex: 'createdAt',
      width: 120,
      sorter: (a: ToPayDeal, b: ToPayDeal) => a.createdAt.localeCompare(b.createdAt),
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 150,
      render: (s: string) => <DealStatusTag status={s as DealStatus} />,
    },
    {
      title: 'Менеджер',
      key: 'manager',
      width: 120,
      render: (_: unknown, r: ToPayDeal) => getFirstName(r.manager?.fullName) || '—',
    },
    {
      title: '',
      key: 'pay',
      width: 110,
      render: (_: unknown, r: ToPayDeal) => (
        <Button type="primary" size="small" onClick={(e) => { e.stopPropagation(); openClient(r.clientId, r.dealId); }}>
          Принять
        </Button>
      ),
    },
  ];

  const toPayTab = (
    <>
      <Space wrap style={{ marginBottom: 16, width: isMobile ? '100%' : undefined }}>
        <Segmented
          value={view}
          onChange={(v) => setView(v as 'clients' | 'deals')}
          options={[
            { label: `По клиентам${toPay ? ` · ${clientRows.length}` : ''}`, value: 'clients' },
            { label: `По сделкам${toPay ? ` · ${filteredDeals.length}` : ''}`, value: 'deals' },
          ]}
        />
        <Select
          allowClear
          placeholder="Менеджер"
          style={{ width: isMobile ? 160 : 200 }}
          value={managerId}
          onChange={setManagerId}
          options={managers}
        />
      </Space>

      {toPayError && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} title="Не удалось загрузить список к оплате" />
      )}

      {isMobile ? (
        view === 'clients' ? (
          <List
            loading={toPayLoading}
            dataSource={clientRows}
            locale={{ emptyText: <Empty description={emptyToPay} /> }}
            pagination={{ pageSize: 20, size: 'small' }}
            renderItem={(r) => (
              <Card
                size="small"
                hoverable
                style={{ marginBottom: 8 }}
                styles={{ body: { padding: 12 } }}
                onClick={() => openClient(r.clientId)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <ClientCompanyDisplay client={{ id: r.clientId, companyName: r.clientName, isSvip: r.clientIsSvip }} />
                  <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{formatUZS(r.debt)}</Typography.Text>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.dealsCount} {plural(r.dealsCount, 'сделка', 'сделки', 'сделок')}
                  {' · '}старейшая {daysAgo(r.oldestCreatedAt)} дн.
                  {r.managers.length > 0 && ` · ${r.managers.join(', ')}`}
                </Typography.Text>
              </Card>
            )}
          />
        ) : (
          <List
            loading={toPayLoading}
            dataSource={dealsNewestFirst}
            locale={{ emptyText: <Empty description={emptyToPay} /> }}
            pagination={{ pageSize: 20, size: 'small' }}
            renderItem={(r) => (
              <Card
                size="small"
                hoverable
                style={{ marginBottom: 8 }}
                styles={{ body: { padding: 12 } }}
                onClick={() => openClient(r.clientId, r.dealId)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{r.title || r.dealId.slice(0, 8)}</span>
                  <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{formatUZS(r.remaining)}</Typography.Text>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.clientName} · {dayjs(r.createdAt).format('DD.MM.YYYY')}
                </Typography.Text>
              </Card>
            )}
          />
        )
      ) : view === 'clients' ? (
        <Table
          dataSource={clientRows}
          columns={clientColumns}
          rowKey="clientId"
          loading={toPayLoading}
          size="middle"
          pagination={{ defaultPageSize: 30, showSizeChanger: true, pageSizeOptions: ['30', '50', '100'] }}
          onRow={(r) => ({ onClick: () => openClient(r.clientId), style: { cursor: 'pointer' } })}
          locale={{ emptyText: emptyToPay }}
        />
      ) : (
        <Table
          dataSource={dealsNewestFirst}
          columns={dealColumns}
          rowKey="dealId"
          loading={toPayLoading}
          size="middle"
          pagination={{ defaultPageSize: 30, showSizeChanger: true, pageSizeOptions: ['30', '50', '100'] }}
          onRow={(r) => ({ onClick: () => openClient(r.clientId, r.dealId), style: { cursor: 'pointer' } })}
          locale={{ emptyText: emptyToPay }}
        />
      )}

      {noDebtClients.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>
            Без долга — можно внести предоплату
          </Typography.Text>
          {noDebtClients.map((c) => (
            <Card
              key={c.clientId}
              size="small"
              hoverable
              style={{ marginBottom: 6 }}
              styles={{ body: { padding: '8px 12px' } }}
              onClick={() => openClient(c.clientId)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <ClientCompanyDisplay client={{ id: c.clientId, companyName: c.clientName, isSvip: c.clientIsSvip }} />
                <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {c.activeDeals} {plural(c.activeDeals, 'сделка в работе', 'сделки в работе', 'сделок в работе')}
                </Typography.Text>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0 }}>Касса 2.0</Typography.Title>
        <Tag color="blue">бета</Tag>
        <Link to="/finance/cashbox" style={{ marginLeft: 'auto', fontSize: 13 }}>Старая касса</Link>
      </div>

      {/* Поиск всегда на виду: «пришёл человек с деньгами» начинается отсюда. */}
      <Input
        size="large"
        allowClear
        autoFocus={!isMobile}
        prefix={<SearchOutlined style={{ color: tk.colorTextTertiary }} />}
        placeholder="Клиент, сделка или № договора"
        value={search}
        onChange={(e) => { setSearch(e.target.value); if (tab === 'journal') setTab('topay'); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSearchEnter(); }}
        style={{ marginBottom: 12 }}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', marginBottom: 8, fontSize: 13, color: tk.colorTextSecondary }}>
        <span>
          Сегодня принято:{' '}
          <Typography.Text strong style={{ color: tk.colorSuccess }}>{formatUZS(toPay?.totals.todayReceived ?? 0)}</Typography.Text>
          {toPay ? ` · ${toPay.totals.todayCount} ${plural(toPay.totals.todayCount, 'оплата', 'оплаты', 'оплат')}` : ''}
        </span>
        <span>
          К оплате:{' '}
          <Typography.Text strong>{formatUZS(toPay?.totals.remaining ?? 0)}</Typography.Text>
          {toPay ? ` · ${toPay.totals.clientCount} ${plural(toPay.totals.clientCount, 'клиент', 'клиента', 'клиентов')}` : ''}
        </span>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'topay', label: 'К оплате', children: toPayTab },
          {
            key: 'receipts',
            label: <Badge count={receipts?.deals.length ?? 0} size="small" offset={[8, -2]}>Чеки</Badge>,
            children: (
              <ReceiptsTab
                deals={receipts?.deals ?? []}
                windowDays={receipts?.windowDays ?? 7}
                loading={receiptsLoading}
                search={search}
              />
            ),
          },
          { key: 'journal', label: 'Журнал', children: <JournalTab staff={staff} /> },
        ]}
      />

      <PaymentPanel
        target={panel}
        staff={staff}
        onClose={() => setPanel(null)}
      />
    </div>
  );
}

// ─────────────────────────── Панель оплаты ───────────────────────────

/** Экспортируется для дашборда бухгалтера — принять оплату, не уходя в кассу. */
export function PaymentPanel({
  target,
  staff,
  onClose,
}: {
  target: { clientId: string; dealId?: string } | null;
  staff: { value: string; label: string }[];
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const { token: tk } = theme.useToken();
  const queryClient = useQueryClient();
  const open = !!target;
  const receipt = useReceiptPunch();

  const { data: card, isLoading } = useQuery({
    queryKey: ['cashbox2-client', target?.clientId],
    queryFn: () => cashboxV2Api.clientCard(target!.clientId),
    enabled: open,
  });

  const [mode, setMode] = useState<'cash' | 'credit'>('cash');
  const [selected, setSelected] = useState<string[]>([]);
  const [amount, setAmount] = useState<number | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<PaymentMethodCode | undefined>(readLastMethod);
  const [moreOpen, setMoreOpen] = useState(false);
  const [paidAt, setPaidAt] = useState<Dayjs>(dayjs());
  const [receivedById, setReceivedById] = useState<string>();
  const [note, setNote] = useState('');
  const [usdOn, setUsdOn] = useState(false);
  const [usdAmount, setUsdAmount] = useState<number | null>(null);
  const [usdRate, setUsdRate] = useState<number | null>(readLastUsdRate);

  // Новый клиент в панели — сбрасываем форму и по умолчанию берём все его долги
  // (или одну сделку, если панель открыли из списка сделок).
  useEffect(() => {
    if (!card || !target || card.client.id !== target.clientId) return;
    const preselect = target.dealId && card.deals.some((d) => d.dealId === target.dealId)
      ? [target.dealId]
      : card.deals.length > 0
        ? card.deals.map((d) => d.dealId)
        // Долга нет — предоплата ложится на одну сделку, по умолчанию на самую новую.
        : card.prepayDeals.slice(0, 1).map((d) => d.dealId);
    setSelected(preselect);
    setMode('cash');
    setAmountTouched(false);
    setPaidAt(dayjs());
    setReceivedById(undefined);
    setNote('');
    setMoreOpen(false);
    setUsdOn(false);
    setUsdAmount(null);
  }, [card, target]);

  /**
   * Долгов нет, но есть оплаченные сделки в работе — клиент вносит деньги вперёд.
   * Старая касса позволяла это на вкладке «Активные»; здесь та же оплата, просто сумма
   * целиком ложится переплатой на выбранную сделку, и её потом можно зачесть.
   */
  const isPrepay = !!card && card.deals.length === 0 && card.prepayDeals.length > 0;
  const listDeals = useMemo(() => (card ? (isPrepay ? card.prepayDeals : card.deals) : []), [card, isPrepay]);

  const selectedDebt = useMemo(
    () => (card?.deals ?? []).filter((d) => selected.includes(d.dealId)).reduce((s, d) => s + d.remaining, 0),
    [card, selected],
  );

  const isCredit = mode === 'credit';
  /** Больше, чем есть переплаты и чем долг по выбранным сделкам, зачесть нельзя. */
  const creditMax = Math.min(card?.prepayment ?? 0, selectedDebt);
  const fullAmount = isCredit ? creditMax : selectedDebt;

  // Пока кассир сам не трогал сумму, она равна долгу по выбранным сделкам (при зачёте —
  // сколько хватит переплаты).
  useEffect(() => {
    if (!amountTouched) setAmount(fullAmount > 0 ? Math.round(fullAmount * 100) / 100 : null);
  }, [fullAmount, amountTouched]);

  const effectiveAmount = isCredit && amount ? Math.min(amount, creditMax) : amount;

  // Долларовая часть: amount — по-прежнему полный эквивалент в сумах, который ложится на
  // сделки; здесь — сколько из него пришло в $ и по какому курсу (как в кассовой книге).
  const usdActive = !isCredit && usdOn && !!usdAmount && !!usdRate;
  const usdUzs = usdActive ? Math.round(usdAmount! * usdRate! * 100) / 100 : 0;
  const uzsPart = (amount ?? 0) - usdUzs;
  // Те же проверки, что на сервере: оба поля и сдача сумами не больше половины долларов.
  const usdError = !isCredit && usdOn
    ? (!usdAmount || !usdRate
      ? 'Укажите сумму в $ и курс'
      : usdUzs - (amount ?? 0) > usdUzs / 2
        ? 'Доллары по этому курсу намного больше суммы — проверьте $ и курс'
        : '')
    : '';
  const usdInvalid = !!usdError;

  /** Повторяет раскладку бэкенда: от старой сделки к новой, остаток — переплатой на последней. */
  const allocation = useMemo(() => {
    const result = new Map<string, number>();
    if (!card || !effectiveAmount || effectiveAmount <= 0) return { byDeal: result, overpayment: 0, lastTitle: undefined };
    let left = Math.round(effectiveAmount * 100);
    const chosen = listDeals.filter((d) => selected.includes(d.dealId));
    for (const d of chosen) {
      if (left <= 0) break;
      const take = Math.min(Math.round(d.remaining * 100), left);
      result.set(d.dealId, take / 100);
      left -= take;
    }
    const last = chosen[chosen.length - 1];
    if (left > 0 && last) result.set(last.dealId, (result.get(last.dealId) ?? 0) + left / 100);
    return { byDeal: result, overpayment: left / 100, lastTitle: last?.title || last?.dealId.slice(0, 8) };
  }, [card, listDeals, effectiveAmount, selected]);

  /** С каких сделок спишется переплата — тот же порядок, что на бэкенде (от большей). */
  const creditDrain = useMemo(() => {
    if (!isCredit || !card || !effectiveAmount) return [];
    let left = Math.round(effectiveAmount * 100);
    const out: { dealId: string; title: string | null; amount: number }[] = [];
    for (const src of card.creditSources) {
      if (left <= 0) break;
      const take = Math.min(Math.round(src.surplus * 100), left);
      out.push({ dealId: src.dealId, title: src.title, amount: take / 100 });
      left -= take;
    }
    return out;
  }, [isCredit, card, effectiveAmount]);

  const invalidateAll = () => {
    for (const key of ['cashbox2-to-pay', 'cashbox2-client', 'cashbox', 'finance-debts', 'finance-active-deals']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const creditMut = useMutation({
    mutationFn: () => cashboxV2Api.applyCredit(target!.clientId, {
      amount: effectiveAmount!,
      dealIds: selected,
      paidAt: paidAt.isSame(dayjs(), 'day') ? undefined : paidAt.toISOString(),
      note: note.trim() || undefined,
    }),
    onSuccess: (res) => {
      const debtLeft = (card?.totalDebt ?? 0) - res.appliedAmount;
      if (res.partiallyApplied) {
        // Переплату мог успеть израсходовать другой кассир — молча рапортовать нельзя.
        message.warning(`Зачтено ${formatUZS(res.appliedAmount)} из ${formatUZS(res.requestedAmount)} — больше переплаты нет`, 6);
      } else {
        message.success(
          `Зачтено ${formatUZS(res.appliedAmount)}`
          + (debtLeft > 0.009 ? ` — остаток ${formatUZS(debtLeft)} можно принять деньгами` : ''),
        );
      }
      invalidateAll();
      // Долг остался — панель не закрываем: после обновления карточки она сама
      // переключится на «Деньгами» с оставшимися сделками.
      if (debtLeft <= 0.009) onClose();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.error || err?.response?.data?.message || 'Не удалось зачесть переплату');
    },
  });

  /**
   * Чек пробивают сразу после приёма денег, а сделка к этому моменту часто уже ушла из
   * списка «К оплате». Поэтому после оплаты предлагаем отметить чек тут же, одним нажатием.
   */
  const offerReceipt = (paidDealIds: string[]) => {
    const dealIds = paidDealIds.filter((id) => {
      const d = listDeals.find((x) => x.dealId === id);
      return d && receipt.canPunch(d.status);
    });
    if (dealIds.length === 0) return;
    const key = `receipt-offer-${dealIds.join('-')}`;
    notification.info({
      key,
      title: 'Чек пробит?',
      description: dealIds.length > 1
        ? `Отметить чек сразу по ${dealIds.length} ${plural(dealIds.length, 'сделке', 'сделкам', 'сделкам')}`
        : 'Отметьте, как только пробьёте — или позже во вкладке «Чеки».',
      duration: 20,
      placement: 'bottomRight',
      actions: (
        <Button
          type="primary"
          size="small"
          onClick={() => {
            notification.destroy(key);
            receipt.mut.mutate(
              { dealIds, value: true },
              { onSuccess: () => message.success('Чек отмечен') },
            );
          }}
        >
          Да, пробит
        </Button>
      ),
    });
  };

  const payMut = useMutation({
    mutationFn: () => cashboxV2Api.payClient(target!.clientId, {
      amount: amount!,
      method: method!,
      dealIds: selected,
      paidAt: paidAt.isSame(dayjs(), 'day') ? undefined : paidAt.toISOString(),
      note: note.trim() || undefined,
      receivedById,
      ...(usdActive ? { usdAmount: usdAmount!, usdRate: usdRate! } : {}),
    }),
    onSuccess: (res) => {
      const total = res.payments.reduce((s, p) => s + p.amount, 0);
      message.success(
        `Проведено ${formatUZS(total)}`
        + (usdActive ? ` (из них $${usdAmount!.toLocaleString('ru-RU')})` : '')
        + (res.payments.length > 1 ? ` на ${res.payments.length} ${plural(res.payments.length, 'сделку', 'сделки', 'сделок')}` : ''),
      );
      saveLastMethod(method!);
      if (usdActive) saveLastUsdRate(usdRate!);
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['cashbox2-receipts'] });
      offerReceipt(res.payments.map((p) => p.dealId));
      onClose();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.error || err?.response?.data?.message || 'Не удалось провести оплату');
    },
  });

  const pending = payMut.isPending || creditMut.isPending;
  const canSubmit = !!card && !!effectiveAmount && effectiveAmount > 0 && (isCredit || !!method)
    && selected.length > 0 && !pending && !usdInvalid;

  const submit = () => {
    if (!canSubmit) {
      if (!isCredit && !method) message.warning('Выберите способ оплаты');
      else if (usdInvalid) message.warning(usdError);
      return;
    }
    if (isCredit) {
      creditMut.mutate();
      return;
    }
    // При предоплате «сумма больше долга» и есть цель — переспрашивать незачем.
    if (allocation.overpayment > 0 && !isPrepay) {
      Modal.confirm({
        title: 'Сумма больше долга',
        content: (
          <div>
            Долг по выбранным сделкам: <strong>{formatUZS(selectedDebt)}</strong>.<br />
            Лишние <strong>{formatUZS(allocation.overpayment)}</strong> останутся переплатой
            на сделке «{allocation.lastTitle}».
          </div>
        ),
        okText: 'Всё верно, провести',
        cancelText: 'Исправить',
        onOk: () => payMut.mutate(),
      });
      return;
    }
    payMut.mutate();
  };

  const toggleDeal = (dealId: string, checked: boolean) => {
    // Предоплата — всегда на одну сделку: иначе вся сумма молча ушла бы на самую новую.
    if (isPrepay) {
      setSelected([dealId]);
      return;
    }
    setSelected((prev) => (checked ? [...prev, dealId] : prev.filter((id) => id !== dealId)));
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement={isMobile ? 'bottom' : 'right'}
      size={isMobile ? '92%' : 520}
      destroyOnClose
      title={card && card.client.id === target?.clientId ? (
        <ClientCompanyDisplay client={{ id: card.client.id, companyName: card.client.companyName, isSvip: card.client.isSvip }} link />
      ) : 'Оплата'}
      footer={
        <Button type="primary" size="large" block disabled={!canSubmit} loading={pending} onClick={submit}>
          {isCredit
            ? (effectiveAmount ? `Зачесть ${formatUZS(effectiveAmount)}` : 'Зачесть')
            : isPrepay
              ? (amount ? `Внести предоплату ${formatUZS(amount)}` : 'Внести предоплату')
              : (amount ? `Провести ${formatUZS(amount)}` : 'Провести')}
        </Button>
      }
    >
      {isLoading || !card || card.client.id !== target?.clientId ? (
        <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <Typography.Text type="secondary">Общий долг</Typography.Text>
            <Typography.Text strong style={{ fontSize: 22, color: card.totalDebt > 0 ? tk.colorWarning : tk.colorSuccess }}>
              {card.totalDebt > 0 ? formatUZS(card.totalDebt) : 'Нет долга'}
            </Typography.Text>
          </div>
          {(card.client.contactName || card.client.phone) && (
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              {[card.client.contactName, card.client.phone].filter(Boolean).join(' · ')}
            </Typography.Text>
          )}

          {listDeals.length === 0 ? (
            <Empty
              description={card.prepayment > 0
                ? `Долгов и сделок в работе нет · переплата ${formatUZS(card.prepayment)}`
                : 'Долгов и сделок в работе нет'}
              style={{ margin: '24px 0' }}
            />
          ) : (
            <>
              {isPrepay && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 14 }}
                  title="Долга нет — это предоплата"
                  description={`Сумма ляжет переплатой на выбранную сделку${card.prepayment > 0 ? ` (сейчас переплата ${formatUZS(card.prepayment)})` : ''} и потом зачтётся в следующий заказ.`}
                />
              )}
              {/* Переплата на других сделках — тоже способ закрыть долг, поэтому режим
                  стоит рядом с суммой, а не в отдельной кассе. */}
              {card.prepayment > 0 && !isPrepay && (
                <Segmented
                  block
                  value={mode}
                  onChange={(v) => { setMode(v as 'cash' | 'credit'); setAmountTouched(false); }}
                  options={[
                    { label: 'Деньгами', value: 'cash' },
                    { label: <span title="Зачёт переплаты с других сделок клиента">Зачёт · {formatUZS(card.prepayment)}</span>, value: 'credit' },
                  ]}
                  style={{ marginBottom: 14 }}
                />
              )}

              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                {isCredit ? 'Сколько зачесть' : 'Сумма'}
              </Typography.Text>
              <InputNumber
                autoFocus
                size="large"
                style={{ width: '100%', fontWeight: 600 }}
                min={1}
                value={amount}
                onChange={(v) => { setAmount(v == null ? null : Number(v)); setAmountTouched(true); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
                formatter={moneyFormatter}
                // Строкой, а не Number(): пустое поле иначе становится 0 и поднимается до min=1 —
                // так при предоплате (сумма пустая) Enter из поиска вписывал «1».
                parser={moneyParser}
              />
              {amountTouched && amount !== fullAmount && fullAmount > 0 && (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => setAmountTouched(false)}
                >
                  {isCredit ? 'Максимум' : 'Весь долг'}: {formatUZS(fullAmount)}
                </Button>
              )}
              {isCredit && !!amount && amount > creditMax + 0.009 && (
                <Typography.Text type="warning" style={{ display: 'block', fontSize: 12 }}>
                  Зачтётся не больше {formatUZS(creditMax)}
                  {creditMax < (card.prepayment - 0.009) ? ' — это весь долг по выбранным сделкам' : ' — больше переплаты нет'}
                </Typography.Text>
              )}

              {isCredit ? (
                <div style={{ marginTop: 14 }}>
                  <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                    Спишется со сделок
                    <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                      деньги в кассу не поступают
                    </Typography.Text>
                  </Typography.Text>
                  {card.creditSources.map((src) => {
                    const take = creditDrain.find((d) => d.dealId === src.dealId)?.amount ?? 0;
                    return (
                      <div
                        key={src.dealId}
                        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '2px 0', opacity: take > 0 ? 1 : 0.55 }}
                      >
                        <Link
                          to={`/deals/${src.dealId}`}
                          style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {src.title || src.dealId.slice(0, 8)}
                        </Link>
                        <span style={{ whiteSpace: 'nowrap', color: tk.colorTextSecondary }}>
                          {take > 0 && <span style={{ color: tk.colorText }}>−{formatUZS(take)} </span>}
                          из {formatUZS(src.surplus)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  <Typography.Text strong style={{ display: 'block', margin: '14px 0 6px' }}>Способ оплаты</Typography.Text>
                  <Radio.Group
                    optionType="button"
                    buttonStyle="solid"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    options={METHODS}
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                  />

                  <Checkbox
                    checked={usdOn}
                    onChange={(e) => setUsdOn(e.target.checked)}
                    style={{ marginTop: 12 }}
                  >
                    Часть или всё — долларами
                  </Checkbox>
                  {usdOn && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <InputNumber
                          autoFocus
                          prefix="$"
                          placeholder="Сколько"
                          style={{ flex: 1 }}
                          min={0.01}
                          value={usdAmount}
                          onChange={(v) => setUsdAmount(v == null ? null : Number(v))}
                          formatter={moneyFormatter}
                          parser={(v) => Number(moneyParser(v))}
                        />
                        <InputNumber
                          prefix="×"
                          placeholder="Курс, сум за $1"
                          style={{ flex: 1 }}
                          min={1}
                          value={usdRate}
                          onChange={(v) => setUsdRate(v == null ? null : Number(v))}
                          formatter={moneyFormatter}
                          parser={(v) => Number(moneyParser(v))}
                        />
                      </div>
                      {usdUzs > 0 && (
                        <div style={{ marginTop: 6, fontSize: 12 }}>
                          <Typography.Text type={usdInvalid ? 'danger' : uzsPart < 0 ? 'warning' : 'secondary'} style={{ fontSize: 12 }}>
                            ${usdAmount!.toLocaleString('ru-RU')} × {usdRate!.toLocaleString('ru-RU')} = {formatUZS(usdUzs)}
                            {' · '}
                            {uzsPart >= 0 ? `сумами: ${formatUZS(uzsPart)}` : `сдача сумами: ${formatUZS(-uzsPart)}`}
                          </Typography.Text>
                          {/* Клиент часто платит только долларами — тогда сумма сделки и есть $ × курс. */}
                          {Math.abs(uzsPart) > 0.009 && (
                            <Button
                              type="link"
                              size="small"
                              style={{ padding: 0, marginLeft: 8, height: 'auto', fontSize: 12 }}
                              onClick={() => { setAmount(usdUzs); setAmountTouched(true); }}
                            >
                              Сумма = {formatUZS(usdUzs)}
                            </Button>
                          )}
                        </div>
                      )}
                      {usdInvalid && usdUzs > 0 && (
                        <Typography.Text type="danger" style={{ display: 'block', fontSize: 12 }}>{usdError}</Typography.Text>
                      )}
                    </div>
                  )}
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '18px 0 6px' }}>
                <Typography.Text strong>
                  {isPrepay ? 'На какую сделку' : 'Куда'}
                  <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                    {isPrepay ? 'оплаченные, ещё в работе' : 'сначала самые старые'}
                  </Typography.Text>
                </Typography.Text>
                {!isPrepay && card.deals.length > 1 && (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    onClick={() => setSelected(selected.length === card.deals.length ? [] : card.deals.map((d) => d.dealId))}
                  >
                    {selected.length === card.deals.length ? 'Снять все' : 'Выбрать все'}
                  </Button>
                )}
              </div>
              <div>
                {listDeals.map((d) => {
                  const checked = selected.includes(d.dealId);
                  const gets = allocation.byDeal.get(d.dealId) ?? 0;
                  const closes = !isPrepay && checked && gets >= d.remaining - 0.009;
                  return (
                    <div
                      key={d.dealId}
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                        padding: '8px 10px',
                        border: `1px solid ${checked ? tk.colorPrimaryBorder : tk.colorBorderSecondary}`,
                        borderRadius: 8,
                        marginBottom: 6,
                        cursor: 'pointer',
                        opacity: checked ? 1 : 0.65,
                      }}
                      onClick={() => toggleDeal(d.dealId, !checked)}
                    >
                      {isPrepay
                        ? <Radio checked={checked} style={{ marginTop: 2 }} />
                        : <Checkbox checked={checked} style={{ marginTop: 2 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.title || d.dealId.slice(0, 8)}
                          </span>
                          {isPrepay ? (
                            <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                              {formatUZS(d.amount)} · {d.paidAmount > d.amount + 0.009 ? `переплата ${formatUZS(d.paidAmount - d.amount)}` : 'оплачено'}
                            </Typography.Text>
                          ) : (
                            <span style={{ whiteSpace: 'nowrap' }}>{formatUZS(d.remaining)}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {dayjs(d.createdAt).format('DD.MM.YYYY')} · {daysAgo(d.createdAt)} дн.
                            {d.contractNumber && ` · №${d.contractNumber}`}
                          </Typography.Text>
                          {checked && gets > 0 && (
                            <Typography.Text style={{ fontSize: 12, color: closes ? tk.colorSuccess : tk.colorText, whiteSpace: 'nowrap' }}>
                              {closes ? 'закроется' : `→ ${formatUZS(gets)}`}
                            </Typography.Text>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {allocation.overpayment > 0 && !isPrepay && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 8 }}
                  title={`Сумма больше долга на ${formatUZS(allocation.overpayment)} — останется переплатой на «${allocation.lastTitle}»`}
                />
              )}

              {/* Дата, «кто принял» и комментарий нужны редко — не загромождают форму. */}
              <Button
                type="link"
                size="small"
                style={{ padding: 0, marginTop: 12 }}
                onClick={() => setMoreOpen((v) => !v)}
                icon={moreOpen ? <UpOutlined /> : <DownOutlined />}
              >
                {moreOpen
                  ? 'Скрыть'
                  : `${isCredit ? 'Дата, комментарий' : 'Дата, кто принял, комментарий'}${!paidAt.isSame(dayjs(), 'day') || (!isCredit && receivedById) || note ? ' · изменено' : ''}`}
              </Button>
              {moreOpen && (
                <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                  <DatePicker
                    value={paidAt}
                    onChange={(d) => d && setPaidAt(d)}
                    format="DD.MM.YYYY"
                    allowClear={false}
                    disabledDate={(d) => !!d && d.isAfter(dayjs().endOf('day'))}
                    style={{ width: '100%' }}
                  />
                  {!isCredit && (
                    <Select
                      allowClear
                      showSearch
                      placeholder="Принял: вы"
                      value={receivedById}
                      onChange={setReceivedById}
                      options={staff}
                      filterOption={(input, option) => matchesSearch(String(option?.label ?? ''), input)}
                    />
                  )}
                  <Input.TextArea
                    rows={2}
                    maxLength={500}
                    placeholder="Комментарий"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {card.recentPayments.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Последние оплаты</Typography.Text>
              {card.recentPayments.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '3px 0' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dayjs(p.paidAt).format('DD.MM')} · {p.dealTitle || p.dealId.slice(0, 8)}
                  </span>
                  <span style={{ whiteSpace: 'nowrap', color: tk.colorTextSecondary }}>
                    {formatUZS(p.amount)} · {nonCashTag[p.kind]?.label ?? methodLabel(p.method)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

// ─────────────────────────── Чеки ───────────────────────────

function ReceiptsTab({
  deals,
  windowDays,
  loading,
  search,
}: {
  deals: ReceiptDeal[];
  windowDays: number;
  loading: boolean;
  search: string;
}) {
  const isMobile = useIsMobile();
  const { canPunch, mut } = useReceiptPunch();

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return deals;
    return deals.filter((d) =>
      matchesSearch(d.clientName, q) || matchesSearch(d.title, q) || matchesSearch(d.manager?.fullName, q));
  }, [deals, search]);

  const punch = (d: ReceiptDeal) => {
    mut.mutate({ dealIds: [d.dealId], value: true }, {
      onSuccess: () => {
        // Строка сразу уходит из списка — промах мышью должен откатываться одним кликом.
        const key = `receipt-${d.dealId}`;
        message.success({
          key,
          duration: 6,
          content: (
            <span>
              Чек отмечен: {d.title || d.dealId.slice(0, 8)}
              {' · '}
              <a onClick={() => { message.destroy(key); mut.mutate({ dealIds: [d.dealId], value: false }); }}>Отменить</a>
            </span>
          ),
        });
      },
    });
  };

  const punchButton = (d: ReceiptDeal, block?: boolean) => {
    const allowed = canPunch(d.status);
    return (
      <Button
        type="primary"
        ghost
        size={block ? 'middle' : 'small'}
        block={block}
        disabled={!allowed}
        title={allowed ? undefined : 'Сделка закрыта — отметить чек может зав. складом или админ'}
        loading={mut.isPending && mut.variables?.dealIds.includes(d.dealId)}
        onClick={(e) => { e.stopPropagation(); punch(d); }}
      >
        Чек пробит
      </Button>
    );
  };

  const columns = [
    {
      title: 'Сделка',
      dataIndex: 'title',
      render: (v: string | null, d: ReceiptDeal) => <Link to={`/deals/${d.dealId}`}>{v || d.dealId.slice(0, 8)}</Link>,
    },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, d: ReceiptDeal) => (
        <ClientCompanyDisplay client={{ id: d.clientId, companyName: d.clientName, isSvip: d.clientIsSvip }} />
      ),
    },
    {
      title: 'Оплачено',
      dataIndex: 'paidAmount',
      align: 'right' as const,
      render: (v: number, d: ReceiptDeal) => (
        <div style={{ whiteSpace: 'nowrap', lineHeight: 1.3 }}>
          <Typography.Text strong>{formatUZS(v)}</Typography.Text>
          {v + 0.009 < d.amount && (
            <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>из {formatUZS(d.amount)}</Typography.Text></div>
          )}
        </div>
      ),
    },
    {
      title: 'Последняя оплата',
      dataIndex: 'lastPaymentAt',
      width: 150,
      render: (v: string | null) => (v ? dayjs(v).format('DD.MM HH:mm') : '—'),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 150,
      render: (s: string) => <DealStatusTag status={s as DealStatus} />,
    },
    {
      title: 'Менеджер',
      key: 'manager',
      width: 110,
      render: (_: unknown, d: ReceiptDeal) => getFirstName(d.manager?.fullName) || '—',
    },
    { title: '', key: 'punch', width: 130, render: (_: unknown, d: ReceiptDeal) => punchButton(d) },
  ];

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Сделки, по которым пришли деньги, а чек не отмечен. Закрытые показываются {windowDays} дней.
      </Typography.Paragraph>
      {isMobile ? (
        <List
          loading={loading}
          dataSource={filtered}
          locale={{ emptyText: <Empty description={search ? 'Ничего не найдено' : 'Все чеки отмечены'} /> }}
          pagination={{ pageSize: 20, size: 'small' }}
          renderItem={(d) => (
            <Card size="small" style={{ marginBottom: 8 }} styles={{ body: { padding: 12 } }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <Link to={`/deals/${d.dealId}`} style={{ fontWeight: 600 }}>{d.title || d.dealId.slice(0, 8)}</Link>
                <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{formatUZS(d.paidAmount)}</Typography.Text>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {d.clientName}
                {d.lastPaymentAt && ` · ${dayjs(d.lastPaymentAt).format('DD.MM HH:mm')}`}
              </Typography.Text>
              {punchButton(d, true)}
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="dealId"
          loading={loading}
          size="middle"
          pagination={{ defaultPageSize: 30, showSizeChanger: true, pageSizeOptions: ['30', '50', '100'] }}
          scroll={{ x: 960 }}
          locale={{ emptyText: search ? 'Ничего не найдено' : 'Все чеки отмечены' }}
        />
      )}
    </>
  );
}

// ─────────────────────────── Журнал ───────────────────────────

function JournalTab({ staff }: { staff: { value: string; label: string }[] }) {
  const isMobile = useIsMobile();
  const { token: tk } = theme.useToken();
  const [period, setPeriod] = useState<JournalPeriod>('day');
  const [custom, setCustom] = useState<[Dayjs, Dayjs] | null>(null);
  const [method, setMethod] = useState<string>();
  const [receivedById, setReceivedById] = useState<string>();
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null);

  // Пересчитываем границы при смене периода; «сегодня» само обновится при следующем выборе.
  const range = useMemo(() => periodRange(period, custom), [period, custom]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['cashbox', 'v2', range, method, receivedById],
    queryFn: () => financeApi.cashbox({ period: 'custom', from: range!.from, to: range!.to, method, receivedById }),
    enabled: !!range,
    refetchInterval: 60_000,
  });

  const filterCount = [method, receivedById].filter(Boolean).length;

  const downloadReceipt = async (dealId: string) => {
    setReceiptLoading(dealId);
    try {
      await dealsApi.downloadPaymentReceipt(dealId);
    } catch {
      message.error('Не удалось сформировать квитанцию');
    } finally {
      setReceiptLoading(null);
    }
  };

  const exportCsv = () => {
    const rows = data?.payments ?? [];
    if (rows.length === 0) { message.info('Нечего выгружать'); return; }
    downloadCsv(
      `kassa-${dayjs().format('YYYY-MM-DD-HHmm')}`,
      ['Дата', 'Время', 'Клиент', 'Сделка', 'Сумма', 'Из них $', 'Курс', 'Способ', 'Тип', 'Принял', 'Примечание'],
      rows.map((p) => [
        dayjs(p.paidAt).format('DD.MM.YYYY'),
        dayjs(p.paidAt).format('HH:mm'),
        p.clientName,
        p.dealTitle || p.dealId.slice(0, 8),
        Math.round(p.amount),
        p.usdAmount ?? '',
        p.usdRate ?? '',
        methodLabel(p.method),
        nonCashTag[p.kind]?.label ?? 'Оплата',
        p.receivedBy || '',
        p.note || '',
      ]),
    );
  };

  const filters = (
    <div style={{ display: 'grid', gap: 8, width: 220 }}>
      <Select allowClear placeholder="Способ оплаты" value={method} onChange={setMethod} options={METHODS} />
      <Select
        allowClear
        showSearch
        placeholder="Принял"
        value={receivedById}
        onChange={setReceivedById}
        options={staff}
        filterOption={(input, option) => matchesSearch(String(option?.label ?? ''), input)}
      />
      {filterCount > 0 && (
        <Button size="small" onClick={() => { setMethod(undefined); setReceivedById(undefined); }}>Сбросить</Button>
      )}
    </div>
  );

  const isNonCash = (p: CashboxPayment) => p.kind !== 'CASH_IN' && p.kind !== 'REVERSAL';

  const columns = [
    {
      title: 'Время',
      dataIndex: 'paidAt',
      width: 130,
      render: (v: string) => dayjs(v).format(period === 'day' ? 'HH:mm' : 'DD.MM HH:mm'),
    },
    {
      title: 'Клиент · сделка',
      key: 'who',
      render: (_: unknown, p: CashboxPayment) => (
        <div style={{ lineHeight: 1.3 }}>
          <div><ClientCompanyDisplay client={{ id: p.clientId, companyName: p.clientName, isSvip: p.clientIsSvip }} /></div>
          <Link to={`/deals/${p.dealId}`} style={{ fontSize: 12 }}>{p.dealTitle || p.dealId.slice(0, 8)}</Link>
          {p.note && <Typography.Text type="secondary" style={{ fontSize: 12 }} title={p.note}> · 💬</Typography.Text>}
        </div>
      ),
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: number, p: CashboxPayment) => isNonCash(p)
        ? <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{formatUZS(v)}</Typography.Text>
        : (
          <div style={{ whiteSpace: 'nowrap', lineHeight: 1.3 }}>
            <Typography.Text strong>{formatUZS(v)}</Typography.Text>
            {p.usdAmount != null && <div><UsdPaymentTag usdAmount={p.usdAmount} usdRate={p.usdRate} /></div>}
          </div>
        ),
    },
    {
      title: 'Способ',
      key: 'method',
      width: 150,
      render: (_: unknown, p: CashboxPayment) => nonCashTag[p.kind]
        ? <Tag color={nonCashTag[p.kind].color}>{nonCashTag[p.kind].label}</Tag>
        : <Tag>{methodLabel(p.method)}</Tag>,
    },
    {
      title: 'Принял',
      dataIndex: 'receivedBy',
      width: 120,
      render: (v: string | null) => getFirstName(v) || '—',
    },
    {
      title: '',
      key: 'receipt',
      width: 50,
      render: (_: unknown, p: CashboxPayment) => (
        <Button
          type="text"
          size="small"
          icon={<PrinterOutlined />}
          title="Квитанция"
          loading={receiptLoading === p.dealId}
          onClick={() => downloadReceipt(p.dealId)}
        />
      ),
    },
  ];

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={period}
          onChange={(v) => setPeriod(v as JournalPeriod)}
          options={[
            { label: 'Сегодня', value: 'day' },
            { label: 'Вчера', value: 'yesterday' },
            { label: '7 дней', value: '7d' },
            { label: '30 дней', value: '30d' },
            { label: 'Период', value: 'custom' },
          ]}
        />
        {period === 'custom' && (
          <DatePicker.RangePicker
            format="DD.MM.YYYY"
            value={custom}
            disabledDate={(d) => !!d && d.isAfter(dayjs().endOf('day'))}
            onChange={(r) => setCustom(r && r[0] && r[1] ? [r[0], r[1]] : null)}
          />
        )}
        <Popover content={filters} trigger="click" placement="bottomLeft">
          <Badge count={filterCount} size="small">
            <Button icon={<FilterOutlined />}>Фильтры</Button>
          </Badge>
        </Popover>
        <Button icon={<DownloadOutlined />} onClick={exportCsv}>Экспорт</Button>
      </Space>

      {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} title="Не удалось загрузить журнал" />}
      {period === 'custom' && !custom && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} title="Выберите даты начала и конца периода" />
      )}

      {data && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginBottom: 12, fontSize: 13, color: tk.colorTextSecondary }}>
          <span>
            Итого: <Typography.Text strong>{formatUZS(data.totals.totalAmount)}</Typography.Text>
            {` · ${data.totals.count} ${plural(data.totals.count, 'оплата', 'оплаты', 'оплат')}`}
          </span>
          {/* Доллары лежат в кассе отдельно — как раздельные колонки кассовой книги. */}
          {!!data.totals.usdTotal && (
            <span>
              из них сумами: {formatUZS(data.totals.uzsTotal ?? 0)} · долларами:{' '}
              <Typography.Text strong>${data.totals.usdTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</Typography.Text>
            </span>
          )}
          {data.byMethod.map((m) => (
            <span key={m.method}>{methodLabel(m.method)}: {formatUZS(m.total)}</span>
          ))}
          {!!data.totals.nonCashCount && (
            <span>+ {data.totals.nonCashCount} служебных на {formatUZS(data.totals.nonCashAmount)} (не деньги)</span>
          )}
        </div>
      )}

      {isMobile ? (
        <List
          loading={isLoading}
          dataSource={data?.payments ?? []}
          locale={{ emptyText: <Empty description="Оплат нет" /> }}
          pagination={{ pageSize: 20, size: 'small' }}
          renderItem={(p) => (
            <Card size="small" style={{ marginBottom: 8 }} styles={{ body: { padding: 12 } }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ minWidth: 0 }}>{p.clientName}</span>
                <Typography.Text strong={!isNonCash(p)} type={isNonCash(p) ? 'secondary' : undefined} style={{ whiteSpace: 'nowrap' }}>
                  {formatUZS(p.amount)}
                </Typography.Text>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {dayjs(p.paidAt).format('DD.MM HH:mm')} · {nonCashTag[p.kind]?.label ?? methodLabel(p.method)}
                {p.receivedBy && ` · ${getFirstName(p.receivedBy)}`}
              </Typography.Text>
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={data?.payments}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          size="middle"
          pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
          locale={{ emptyText: 'Оплат нет' }}
        />
      )}
    </>
  );
}
