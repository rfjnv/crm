import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Table, Typography, Select, Card, Statistic, Row, Col, Tag, Space, Segmented,
  Tabs, Input, Button, Modal, Form, InputNumber, message, Spin, DatePicker, List, Empty,
  Drawer, Badge, Alert,
} from 'antd';
import { DollarOutlined, FilterOutlined, DownloadOutlined, PrinterOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import dayjs from 'dayjs';
import {
  financeApi,
  type CashboxPayment,
  type ActiveDealRow,
  type ApplyCreditResult,
  type PayableDealRow,
} from '../api/finance.api';
import DealStatusTag from '../components/DealStatusTag';
import ReceiptPunchedTag from '../components/ReceiptPunchedTag';
import { dealsApi } from '../api/deals.api';
import { clientsApi } from '../api/clients.api';
import { usersApi } from '../api/users.api';
import { matchesSearch } from '../utils/translit';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { downloadCsv } from '../utils/csv';
import type { ClientDebtRow, DealStatus } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useAuthStore } from '../store/authStore';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { getFirstName } from '../lib/name-utils';

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
  DEBT: 'Долг',
};

/**
 * Служебные проводки — движение внутри учёта, а не поступление денег.
 * Показываются в журнале (кассиру важно видеть, откуда взялась оплата),
 * но в кассовые итоги не входят.
 */
const nonCashHint: Record<string, string> = {
  CREDIT_TRANSFER: 'Зачёт переплаты с других сделок — деньги в кассу не поступали',
  ADJUSTMENT: 'Выравнивание оплаты, проведённой мимо кассы',
};

const nonCashTag: Record<string, { color: string; label: string }> = {
  CREDIT_TRANSFER: { color: 'purple', label: 'Зачёт переплаты' },
  ADJUSTMENT: { color: 'default', label: 'Выравнивание' },
  REVERSAL: { color: 'red', label: 'Сторно' },
};

/**
 * Вертикальный ритм страницы.
 *
 * Было десять разрозненных `marginBottom: 16` — все блоки шли с одинаковым шагом,
 * поэтому смысловые группы (фильтры / показатели / данные) не читались как группы.
 * SECTION крупнее BLOCK: им разделяются разделы, внутри раздела — обычный шаг.
 */
const GAP = { BLOCK: 16, SECTION: 24 } as const;

const paymentStatusLabels: Record<string, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Полностью' },
};

export default function CashboxPage() {
  const isMobile = useIsMobile();
  // Вкладка живёт в URL: F5 при разборе долгов больше не отбрасывает в начало,
  // и на конкретный срез можно дать ссылку коллеге.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'payments';
  const setActiveTab = useCallback(
    (key: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (key === 'payments') next.delete('tab');
        else next.set('tab', key);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );
  const [period, setPeriod] = useState<string>('day');
  /** Границы произвольного диапазона в ISO — нужны для закрытия месяца и любых сверок. */
  const [customRange, setCustomRange] = useState<[string, string] | null>(null);
  const [receivedById, setReceivedById] = useState<string>();
  const [clientId, setClientId] = useState<string>();
  const [method, setMethod] = useState<string>();
  const [paymentStatus, setPaymentStatus] = useState<string>();
  const [entryType, setEntryType] = useState<'DEBT_COLLECTION' | 'SALE_PAYMENT'>();
  const [paymentsFilterOpen, setPaymentsFilterOpen] = useState(false);
  const [debtsFilterOpen, setDebtsFilterOpen] = useState(false);
  const [activeFilterOpen, setActiveFilterOpen] = useState(false);
  const { token: tk } = theme.useToken();

  /**
   * Отметку чека по ЗАКРЫТОЙ сделке бэкенд разрешает админам, зав. складу и тем,
   * у кого есть edit_closed_deal. Раньше закрытые сделки сюда не попадали, поэтому
   * вопрос не возникал; теперь «закрытые сегодня» видны, и кнопку надо гасить
   * заранее — иначе остальные роли получают 403 уже после нажатия.
   */
  const authUser = useAuthStore((s) => s.user);
  const mayPunchClosedReceipt = useMemo(() => {
    const role = authUser?.role;
    if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'WAREHOUSE_MANAGER') return true;
    return !!authUser?.permissions?.includes('edit_closed_deal');
  }, [authUser]);

  // Debtors tab state
  const [debtSearch, setDebtSearch] = useState('');
  const [debtRange, setDebtRange] = useState<DebtRange>('all');
  const [customMin, setCustomMin] = useState<number | null>(null);
  const [debtStatus, setDebtStatus] = useState<DebtStatus>('all');
  // Отдельные фильтры для «Активных» и «Долгов»: раньше состояние было общим, и
  // выбор менеджера в одной вкладке незаметно фильтровал другую.
  const [debtsManagerId, setDebtsManagerId] = useState<string | undefined>(undefined);
  const [activeManagerId, setActiveManagerId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortOption>('debt_desc');
  // Единая точка приёма оплаты: поиск сделки по клиенту / названию / номеру договора.
  const [payerModalOpen, setPayerModalOpen] = useState(false);
  const [payerSearch, setPayerSearch] = useState('');
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<{ clientId: string; clientName: string; isSvip?: boolean } | null>(null);
  const [activePayModalOpen, setActivePayModalOpen] = useState(false);
  const [activePayDeal, setActivePayDeal] = useState<ActiveDealRow | null>(null);
  /**
   * Пресет оплаты. Раньше это были два состояния ('cash' | 'credit') и три кнопки,
   * из которых третья просто стирала сумму и никак не подсвечивалась — тристейт
   * читался как случайный набор чипов. Теперь один явный переключатель.
   */
  const [activePayPreset, setActivePayPreset] = useState<'full' | 'partial' | 'credit'>('full');
  const activePayMode: 'cash' | 'credit' = activePayPreset === 'credit' ? 'credit' : 'cash';
  const [activePayForm] = Form.useForm();
  const queryClient = useQueryClient();

  const { data, isLoading, error: cashboxError } = useQuery({
    queryKey: ['cashbox', period, customRange, clientId, method, paymentStatus, entryType, receivedById],
    queryFn: () => financeApi.cashbox({
      period,
      from: period === 'custom' ? customRange?.[0] : undefined,
      to: period === 'custom' ? customRange?.[1] : undefined,
      clientId,
      method,
      paymentStatus,
      entryType,
      receivedById,
    }),
    // Диапазон без выбранных дат запрашивать бессмысленно.
    enabled: period !== 'custom' || !!customRange,
    // Реже, чем раньше: при 15 секундах таблица перескакивала прямо под руками.
    refetchInterval: 60_000,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list(),
  });

  const debtParams = useMemo(() => {
    const p: { minDebt?: number; managerId?: string; paymentStatus?: string } = {};
    if (debtsManagerId) p.managerId = debtsManagerId;
    if (debtStatus !== 'all') p.paymentStatus = debtStatus;

    let minDebt = 0;
    if (debtRange === '1m') minDebt = 1_000_000;
    else if (debtRange === '5m') minDebt = 5_000_000;
    else if (debtRange === '10m') minDebt = 10_000_000;
    else if (debtRange === 'custom' && customMin) minDebt = customMin;
    if (minDebt > 0) p.minDebt = minDebt;

    return p;
  }, [debtsManagerId, debtStatus, debtRange, customMin]);

  const { data: debtsData, isLoading: debtsLoading, error: debtsError } = useQuery({
    queryKey: ['finance-debts', debtParams],
    queryFn: () => financeApi.getDebts(debtParams),
    // Раньше запрос ждал открытия вкладки, поэтому счётчик в её заголовке
    // появлялся только после клика — окинуть взглядом объём работы было нельзя.
  });

  const activeDealsParams = useMemo(
    () => (activeManagerId ? { managerId: activeManagerId } : undefined),
    [activeManagerId],
  );

  const { data: activeDealsData, isLoading: activeDealsLoading, error: activeDealsError } = useQuery({
    queryKey: ['finance-active-deals', activeDealsParams],
    queryFn: () => financeApi.getActiveDeals(activeDealsParams),
    refetchInterval: 60_000,
  });

  const { data: activePayContext, isLoading: activePayContextLoading } = useQuery({
    queryKey: ['deal-payment-context', activePayDeal?.dealId],
    queryFn: () => financeApi.getDealPaymentContext(activePayDeal!.dealId),
    enabled: !!activePayDeal?.dealId && activePayModalOpen,
  });

  const activePayAmountWatch = Form.useWatch('amount', activePayForm);

  const [receiptDownloading, setReceiptDownloading] = useState<string | null>(null);

  const downloadReceipt = useCallback(async (dealId: string) => {
    setReceiptDownloading(dealId);
    try {
      await dealsApi.downloadPaymentReceipt(dealId);
    } catch {
      message.error('Не удалось сформировать квитанцию');
    } finally {
      setReceiptDownloading(null);
    }
  }, []);

  const exportPayments = useCallback(() => {
    const rows = data?.payments ?? [];
    if (rows.length === 0) {
      message.info('Нечего выгружать за выбранный период');
      return;
    }
    downloadCsv(
      `kassa-${dayjs().format('YYYY-MM-DD-HHmm')}`,
      ['Дата', 'Время', 'Сделка', 'Клиент', 'Сумма', 'Метод', 'Тип', 'Менеджер', 'Принял', 'Примечание'],
      rows.map((p) => [
        dayjs(p.paidAt).format('DD.MM.YYYY'),
        dayjs(p.paidAt).format('HH:mm'),
        p.dealTitle || p.dealId.slice(0, 8),
        p.clientName,
        // Число без пробелов — иначе Excel примет его за текст.
        Math.round(p.amount),
        p.method ? methodLabels[p.method] || p.method : '',
        nonCashTag[p.kind]?.label
          ?? (p.entryType === 'DEBT_COLLECTION' ? 'Приход долга' : 'Оплата продажи'),
        p.manager || '',
        p.receivedBy || '',
        p.note || '',
      ]),
    );
    message.success(`Выгружено строк: ${rows.length}`);
  }, [data]);

  const debouncedPayerSearch = useDebouncedValue(payerSearch, 300);

  const { data: payerResults, isFetching: payerSearching } = useQuery({
    queryKey: ['payable-deals', debouncedPayerSearch],
    queryFn: () => financeApi.searchPayableDeals(debouncedPayerSearch),
    enabled: payerModalOpen && debouncedPayerSearch.trim().length >= 2,
  });

  const { data: clientDetail, isLoading: clientDetailLoading } = useQuery({
    queryKey: ['client-debt-detail', selectedClient?.clientId],
    queryFn: () => financeApi.clientDebtDetail(selectedClient!.clientId),
    enabled: !!selectedClient?.clientId && payModalOpen,
  });

  const receiptPunchedMut = useMutation({
    mutationFn: (vals: { dealId: string; isReceiptPunched: boolean }) =>
      dealsApi.update(vals.dealId, { isReceiptPunched: vals.isReceiptPunched }),
    onSuccess: (_data, vars) => {
      message.success(vars.isReceiptPunched ? 'Отмечено: чек пробит' : 'Отметка снята');
      queryClient.invalidateQueries({ queryKey: ['finance-active-deals'] });
      queryClient.invalidateQueries({ queryKey: ['deal', vars.dealId] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.error || 'Ошибка обновления отметки чека');
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
    mutationFn: (vals: { dealId: string; amount: number; method?: string; note?: string; paidAt?: string; receivedById?: string }) =>
      dealsApi.createPayment(vals.dealId, {
        amount: vals.amount,
        method: vals.method,
        note: vals.note,
        paidAt: vals.paidAt,
        receivedById: vals.receivedById,
      }),
    onSuccess: () => {
      message.success('Платёж добавлен');
      activePayForm.resetFields();
      setActivePayModalOpen(false);
      setActivePayDeal(null);
      setActivePayPreset('full');
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
    onSuccess: (res: ApplyCreditResult) => {
      // Пул переплаты мог оказаться меньше запрошенного (например, его успел
      // израсходовать другой кассир) — молча рапортовать об успехе нельзя.
      if (res?.partiallyApplied) {
        message.warning(
          `Зачтено ${formatUZS(res.appliedAmount)} из запрошенных ${formatUZS(res.requestedAmount)} — `
          + 'на других сделках клиента больше переплаты нет',
          6,
        );
      } else {
        message.success('Переплата зачтена');
      }
      activePayForm.resetFields();
      setActivePayModalOpen(false);
      setActivePayDeal(null);
      setActivePayPreset('full');
      invalidateAfterActivePayment();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Не удалось зачесть переплату');
    },
  });

  const openActivePayModal = useCallback(
    (row: ActiveDealRow) => {
      setActivePayDeal(row);
      setActivePayPreset('full');
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

  /**
   * Открывает обычную форму платежа для сделки, найденной поиском.
   * Форма одна и та же — независимо от того, активна сделка, закрыта сегодня или
   * висит в долгах несколько месяцев.
   */
  const openActivePayModalFromSearch = useCallback(
    (d: PayableDealRow) => {
      setPayerModalOpen(false);
      setPayerSearch('');
      openActivePayModal({
        dealId: d.dealId,
        title: d.title,
        status: d.status,
        clientId: d.clientId,
        clientName: d.clientName,
        clientIsSvip: d.clientIsSvip,
        amount: d.amount,
        paidAmount: d.paidAmount,
        remaining: d.remaining,
        manager: d.manager,
      });
    },
    [openActivePayModal],
  );

  /** Сделка выбрана в «Долгах» — открываем ту же полную форму платежа. */
  const openActivePayModalFromClientDeal = useCallback(
    (deal: { id: string; title: string; status: string; amount: number | string; paidAmount: number | string; manager?: { id: string; fullName: string } | null }) => {
      if (!selectedClient) return;
      const amount = Number(deal.amount);
      const paidAmount = Number(deal.paidAmount);
      setPayModalOpen(false);
      openActivePayModal({
        dealId: deal.id,
        title: deal.title,
        status: deal.status,
        clientId: selectedClient.clientId,
        clientName: selectedClient.clientName,
        clientIsSvip: selectedClient.isSvip,
        amount,
        paidAmount,
        remaining: amount - paidAmount,
        manager: deal.manager ?? null,
      });
    },
    [openActivePayModal, selectedClient],
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

      // Повторяем порядок списания бэкенда (от большей переплаты), чтобы кассир
      // видел заранее, с каких именно сделок уйдут деньги. Переплата клиента почти
      // всегда собрана из нескольких сделок, и «общая сумма» этого не объясняет.
      const drain: { dealId: string; title: string; amount: number }[] = [];
      let left = applied;
      for (const src of activePayContext.creditSources) {
        if (left <= 0) break;
        const take = Math.min(src.surplus, left);
        drain.push({ dealId: src.dealId, title: src.title, amount: take });
        left -= take;
      }

      return {
        applied,
        newRemaining: Math.max(0, newRemaining),
        dealOverAfter,
        label: 'Зачёт переплаты',
        drain,
        shortfall: pay > creditCap ? pay - creditCap : 0,
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
      drain: [] as { dealId: string; title: string; amount: number }[],
      shortfall: 0,
    };
  }, [activePayContext, activePayAmountWatch, activePayMode]);

  const submitActivePay = async () => {
    if (!activePayDeal) return;
    let vals;
    try {
      vals = await activePayForm.validateFields();
    } catch {
      return; // подсветку невалидных полей рисует сама форма
    }
    const paidAtStr = vals.paidAt ? dayjs(vals.paidAt).toISOString() : undefined;
    const amt = Number(vals.amount);

    // Сумма выше остатка не запрещена (бывает предоплата вперёд), но раньше проходила
    // молча — опечатка в лишний ноль оседала «переплатой» и всплывала недели спустя.
    const remaining = activePayContext?.deal.remaining ?? 0;
    if (activePayMode === 'cash' && remaining > 0 && amt > remaining) {
      const excess = amt - remaining;
      const ok = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: 'Сумма больше остатка по сделке',
          content: (
            <div>
              <div>Остаток: <strong>{formatUZS(remaining)}</strong></div>
              <div>Вносится: <strong>{formatUZS(amt)}</strong></div>
              <div style={{ marginTop: 8 }}>
                Лишние <strong>{formatUZS(excess)}</strong> останутся переплатой на этой сделке.
              </div>
            </div>
          ),
          okText: 'Всё верно, провести',
          cancelText: 'Исправить сумму',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!ok) return;
    }

    try {
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
          receivedById: vals.receivedById,
        });
      }
    } catch {
      // сообщение об ошибке показывает onError мутации; здесь гасим reject,
      // чтобы он не всплывал необработанным из onOk модалки
    }
  };

  const clientOptions = useMemo(
    () =>
      (clients ?? []).map((c) => ({
        value: c.id,
        label: (
          <Space size={4} align="center">
            <ClientCompanyDisplay client={c} />
          </Space>
        ),
      })),
    [clients],
  );

  const managers = useMemo(() => {
    if (!users) return [];
    return users
      .filter((u: { role: string; isActive: boolean }) =>
        ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'].includes(u.role) && u.isActive,
      )
      .map((u: { id: string; fullName: string }) => ({ value: u.id, label: getFirstName(u.fullName) }));
  }, [users]);

  /** Кто может значиться принявшим деньги — все активные сотрудники, не только менеджеры. */
  const staff = useMemo(() => {
    if (!users) return [];
    return users
      .filter((u: { isActive: boolean }) => u.isActive)
      .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName }));
  }, [users]);

  const debtorClients: ClientDebtRow[] = debtsData?.clients ?? [];

  const filteredDebtors = useMemo(() => {
    let result = debtorClients;

    if (debtSearch.trim()) {
      const q = debtSearch.trim();
      result = result.filter(
        (c) =>
          matchesSearch(c.clientName, q) ||
          matchesSearch(c.manager?.fullName, q),
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
    setSelectedClient({ clientId: row.clientId, clientName: row.clientName, isSvip: row.isSvip });
    setPayModalOpen(true);
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
      key: 'client',
      render: (_: unknown, r: CashboxPayment) => (
        <ClientCompanyDisplay
          client={{ id: r.clientId, companyName: r.clientName, isSvip: r.clientIsSvip }}
          link
        />
      ),
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: number, r: CashboxPayment) =>
        r.kind === 'CASH_IN' || r.kind === 'REVERSAL' ? (
          formatUZS(v)
        ) : (
          // Служебная проводка: денег в кассу не поступало, в итоги не входит.
          <Typography.Text type="secondary" title={nonCashHint[r.kind]}>
            {formatUZS(v)}
          </Typography.Text>
        ),
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
      // Две отдельные колонки дублировали друг друга: пока receivedById не заполнялся,
      // «Принял» был копией автора записи. Теперь принявший — главный, менеджер — контекст.
      title: 'Принял',
      dataIndex: 'receivedBy',
      width: 150,
      render: (v: string | null, r: CashboxPayment) => (
        <div style={{ lineHeight: 1.3 }}>
          <div>{getFirstName(v) || '—'}</div>
          {r.manager && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              менеджер: {getFirstName(r.manager)}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      // Примечание заполнено у единиц строк — целая колонка ради этого держала
      // на весь экран столбец прочерков.
      title: '',
      dataIndex: 'note',
      width: 40,
      render: (v: string | null) => v
        ? <Typography.Text type="secondary" title={v}>💬</Typography.Text>
        : null,
    },
    {
      title: '',
      key: 'receipt',
      width: 60,
      render: (_: unknown, r: CashboxPayment) => (
        // Генератор квитанции существовал в API, но выдать её клиенту из кассы было нельзя.
        <Button
          type="link"
          size="small"
          icon={<PrinterOutlined />}
          title="Квитанция об оплате"
          loading={receiptDownloading === r.dealId}
          onClick={() => downloadReceipt(r.dealId)}
        />
      ),
    },
  ];

  const paymentColumnsWithEntryType = [
    ...paymentColumns.slice(0, 5),
    {
      title: 'Тип прихода',
      dataIndex: 'entryType',
      width: 150,
      render: (v: CashboxPayment['entryType'], r: CashboxPayment) => {
        const svc = nonCashTag[r.kind];
        if (svc) return <Tag color={svc.color}>{svc.label}</Tag>;
        return v === 'DEBT_COLLECTION'
          ? <Tag color="gold">Приход долга</Tag>
          : <Tag color="blue">Оплата продажи</Tag>;
      },
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
      key: 'client',
      render: (_: unknown, r: ActiveDealRow) => (
        <ClientCompanyDisplay
          client={{ id: r.clientId, companyName: r.clientName, isSvip: r.clientIsSvip }}
          link
        />
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
        <span style={{ color: v > 0 ? tk.colorWarning : tk.colorTextSecondary }}>{formatUZS(v)}</span>
      ),
    },
    {
      title: 'Менеджер',
      dataIndex: ['manager', 'fullName'],
      render: (_: unknown, r: ActiveDealRow) => getFirstName(r.manager?.fullName) || '—',
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 190,
      render: (s: string, r: ActiveDealRow) => (
        <Space size={4} wrap>
          <DealStatusTag status={s as DealStatus} />
          {r.closedToday && <Tag color="cyan">Закрыта сегодня</Tag>}
        </Space>
      ),
    },
    {
      title: 'Чек',
      key: 'receiptPunched',
      width: 170,
      render: (_: unknown, r: ActiveDealRow) => {
        const blocked = !!r.closedToday && !mayPunchClosedReceipt;
        return (
          <Space size={4} wrap>
            {r.isReceiptPunched ? <ReceiptPunchedTag isReceiptPunched /> : <Tag>Не пробит</Tag>}
            <Button
              size="small"
              type="link"
              disabled={blocked}
              title={blocked ? 'Сделка закрыта — отметку чека может поставить зав. складом или админ' : undefined}
              loading={receiptPunchedMut.isPending && receiptPunchedMut.variables?.dealId === r.dealId}
              onClick={() => receiptPunchedMut.mutate({ dealId: r.dealId, isReceiptPunched: !r.isReceiptPunched })}
            >
              {r.isReceiptPunched ? 'Снять' : 'Отметить'}
            </Button>
          </Space>
        );
      },
    },
    {
      title: '',
      key: 'pay',
      width: 130,
      fixed: 'right' as const,
      render: (_: unknown, r: ActiveDealRow) => (
        <Button type="link" size={isMobile ? 'middle' : 'small'} onClick={() => openActivePayModal(r)}>
          Внести платёж
        </Button>
      ),
    },
  ];

  const debtorColumns = [
    {
      title: 'Клиент',
      key: 'client',
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
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v > 0 ? tk.colorError : undefined }}>{formatUZS(v)}</span>
      ),
    },
    {
      title: 'Переплата',
      dataIndex: 'prepayment',
      align: 'right' as const,
      render: (v: number) =>
        v > 0
          ? <span style={{ color: tk.colorSuccess }}>{formatUZS(v)}</span>
          : <Typography.Text type="secondary">{'—'}</Typography.Text>,
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
      render: (v: string | null) => getFirstName(v) || '—',
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
        <Button type="primary" size={isMobile ? 'middle' : 'small'} icon={<DollarOutlined />} onClick={() => openPayModal(r)}>
          Оплатить
        </Button>
      ) : null,
    },
  ];

  // ──── Deal selection for payment modal ────

  const clientDeals = clientDetail?.deals ?? [];

  /** Единый баннер ошибки — вместо пустой таблицы, которую путали с «нет данных». */
  const renderError = (err: unknown, title: string) => err ? (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: GAP.BLOCK }}
      message={title}
      description={
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error
        || (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || 'Проверьте соединение и попробуйте обновить страницу.'
      }
    />
  ) : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0 }}>Касса</Typography.Title>
        {/* Точка входа кассира — «пришёл человек с деньгами». Работает с любой вкладки
            и находит сделку независимо от статуса, чтобы не искать её по вкладкам вручную. */}
        <Button
          type="primary"
          icon={<DollarOutlined />}
          onClick={() => { setPayerSearch(''); setPayerModalOpen(true); }}
          style={{ marginLeft: 'auto' }}
        >
          Принять оплату
        </Button>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'payments',
          label: 'Платежи',
          children: (() => {
            const paymentsFilterCount = [clientId, method, paymentStatus, entryType, receivedById].filter(Boolean).length;
            const paymentFilterFields = (
              <Space direction={isMobile ? 'vertical' : 'horizontal'} wrap style={{ width: isMobile ? '100%' : undefined }}>
                <Select
                  allowClear
                  showSearch
                  placeholder="Клиент"
                  style={{ width: isMobile ? '100%' : 200 }}
                  value={clientId}
                  onChange={setClientId}
                  options={clientOptions}
                  filterOption={(input, option) => {
                    const c = clients?.find((x) => x.id === option?.value);
                    if (!c) return false;
                    return matchesSearch(
                      [c.companyName, c.contactName || '', c.phone || ''].join(' '),
                      input,
                    );
                  }}
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
                {/* Для кассы «кто принял деньги» — более частый вопрос, чем менеджер сделки. */}
                <Select
                  allowClear
                  showSearch
                  placeholder="Принял"
                  style={{ width: isMobile ? '100%' : 180 }}
                  value={receivedById}
                  onChange={setReceivedById}
                  options={staff}
                  filterOption={(input, option) => matchesSearch(String(option?.label ?? ''), input)}
                />
              </Space>
            );
            return (
            <>
              <Space wrap style={{ marginBottom: GAP.BLOCK, width: isMobile ? '100%' : undefined }}>
                <Segmented
                  value={period}
                  onChange={(v) => setPeriod(v as string)}
                  block={isMobile}
                  style={isMobile ? { width: '100%' } : undefined}
                  options={[
                    { label: 'Вчера', value: 'yesterday' },
                    { label: 'Сегодня', value: 'day' },
                    // Скользящие периоды, а не календарные — подписи это отражают.
                    { label: '7 дней', value: 'week' },
                    { label: '30 дней', value: 'month' },
                    { label: 'Период', value: 'custom' },
                  ]}
                />
                {period === 'custom' && (
                  <DatePicker.RangePicker
                    format="DD.MM.YYYY"
                    style={{ width: isMobile ? '100%' : undefined }}
                    value={customRange ? [dayjs(customRange[0]), dayjs(customRange[1])] : null}
                    disabledDate={(d) => !!d && d.isAfter(dayjs().endOf('day'))}
                    onChange={(range) => {
                      if (!range || !range[0] || !range[1]) { setCustomRange(null); return; }
                      setCustomRange([
                        range[0].startOf('day').toISOString(),
                        range[1].endOf('day').toISOString(),
                      ]);
                    }}
                  />
                )}
                {isMobile ? (
                  <>
                    <Badge count={paymentsFilterCount} size="small">
                      <Button icon={<FilterOutlined />} onClick={() => setPaymentsFilterOpen(true)}>
                        Фильтры
                      </Button>
                    </Badge>
                    <Drawer
                      title="Фильтры"
                      placement="bottom"
                      height="auto"
                      open={paymentsFilterOpen}
                      onClose={() => setPaymentsFilterOpen(false)}
                    >
                      {paymentFilterFields}
                      <Button
                        block
                        style={{ marginTop: 16 }}
                        onClick={() => {
                          setClientId(undefined);
                          setMethod(undefined);
                          setPaymentStatus(undefined);
                          setEntryType(undefined);
                          setReceivedById(undefined);
                        }}
                      >
                        Сбросить фильтры
                      </Button>
                    </Drawer>
                  </>
                ) : paymentFilterFields}
                <Button icon={<DownloadOutlined />} onClick={exportPayments}>
                  Экспорт
                </Button>
              </Space>

              {/* Молчаливая пустая таблица вместо ошибки скрывала и падение API, и 403 —
                  кассир не отличал «не было платежей» от «система недоступна». */}
              {renderError(cashboxError, 'Не удалось загрузить платежи')}

              {period === 'custom' && !customRange && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: GAP.BLOCK }}
                  message="Выберите даты начала и конца периода"
                />
              )}

              {/* Summary cards */}
              <Row gutter={[16, 16]} style={{ marginBottom: GAP.SECTION }}>
                <Col xs={24} sm={12} lg={6}>
                  <Card size="small">
                    <Statistic title="Итого за период" value={data?.totals.totalAmount ?? 0} formatter={(v) => formatUZS(Number(v))} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <Card size="small">
                    <Statistic title="Итого за сегодня" value={data?.totals.todayTotal ?? 0} formatter={(v) => formatUZS(Number(v))} valueStyle={{ color: tk.colorSuccess }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <Card size="small">
                    <Statistic title="Количество оплат" value={data?.totals.count ?? 0} />
                    {!!data?.totals.nonCashCount && (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        + {data.totals.nonCashCount} служебных на {formatUZS(data.totals.nonCashAmount)}
                        {' '}(не деньги)
                      </Typography.Text>
                    )}
                  </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
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

              {isMobile ? (
                <List
                  loading={isLoading}
                  dataSource={data?.payments ?? []}
                  locale={{ emptyText: <Empty description="Нет данных" /> }}
                  pagination={{ pageSize: 20, size: 'small' }}
                  renderItem={(p: CashboxPayment) => {
                    const statusCfg = paymentStatusLabels[p.dealPaymentStatus] || { color: 'default', label: p.dealPaymentStatus };
                    return (
                      <Card size="small" style={{ marginBottom: 8 }} styles={{ body: { padding: 12 } }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <Link to={`/deals/${p.dealId}`} style={{ fontWeight: 600 }}>
                              {p.dealTitle || p.dealId.slice(0, 8)}
                            </Link>
                            <div style={{ fontSize: 12, color: tk.colorTextSecondary }}>
                              {dayjs(p.paidAt).format('DD.MM.YYYY HH:mm')}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap' }}>
                            {formatUZS(p.amount)}
                          </div>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <ClientCompanyDisplay
                            client={{ id: p.clientId, companyName: p.clientName, isSvip: p.clientIsSvip }}
                            link
                          />
                        </div>
                        <Space size={4} wrap style={{ marginTop: 8 }}>
                          {p.method && <Tag>{methodLabels[p.method] || p.method}</Tag>}
                          {nonCashTag[p.kind] ? (
                            <Tag color={nonCashTag[p.kind].color}>{nonCashTag[p.kind].label}</Tag>
                          ) : (
                            <Tag color={p.entryType === 'DEBT_COLLECTION' ? 'gold' : 'blue'}>
                              {p.entryType === 'DEBT_COLLECTION' ? 'Приход долга' : 'Оплата продажи'}
                            </Tag>
                          )}
                          <Tag color={statusCfg.color}>{statusCfg.label}</Tag>
                        </Space>
                        {(p.manager || p.receivedBy) && (
                          <div style={{ fontSize: 12, color: tk.colorTextSecondary, marginTop: 6 }}>
                            {p.manager && <>Менеджер: {p.manager}</>}
                            {p.manager && p.receivedBy && ' · '}
                            {p.receivedBy && <>Принял: {p.receivedBy}</>}
                          </div>
                        )}
                        {p.note && (
                          <div style={{ fontSize: 12, marginTop: 4 }}>{p.note}</div>
                        )}
                      </Card>
                    );
                  }}
                />
              ) : (
                <Table
                  dataSource={data?.payments}
                  columns={paymentColumnsWithEntryType}
                  rowKey="id"
                  loading={isLoading}
                  pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
                  size="middle"
                  bordered={false}
                  // 600 было вдвое меньше реальной ширины — вместо прокрутки колонки
                  // сжимались и текст переносился в 2–3 строки.
                  scroll={{ x: 1150 }}
                  summary={() => data?.payments && data.payments.length > 0 ? (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={3}>
                        Итого денег
                        {!!data.totals.nonCashCount && (
                          <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                            (без {data.totals.nonCashCount} служебных)
                          </Typography.Text>
                        )}
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        {formatUZS(data.totals.totalAmount)}
                      </Table.Summary.Cell>
                      {/* 10 колонок: 3 + 1 + 6 */}
                      <Table.Summary.Cell index={4} colSpan={6} />
                    </Table.Summary.Row>
                  ) : undefined}
                />
              )}
            </>
            );
          })(),
        },
        {
          key: 'active',
          label: `Активные${activeDealsData !== undefined ? ` (${activeDealsData.count})` : ''}`,
          children: (() => {
            const activeFilterCount = activeManagerId ? 1 : 0;
            const managerSelect = (
              <Select
                value={activeManagerId}
                onChange={(v) => setActiveManagerId(v)}
                allowClear
                placeholder="Менеджер"
                style={{ width: isMobile ? '100%' : 200 }}
                options={managers}
              />
            );
            return (
            <>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                Сделки в работе и закрытые сегодня — чтобы принять оплату по свежей сделке,
                не разыскивая её среди должников.
                {!!activeDealsData?.closedTodayCount && (
                  <> Закрыто сегодня: <strong>{activeDealsData.closedTodayCount}</strong>.</>
                )}
              </Typography.Paragraph>
              <Space wrap style={{ marginBottom: GAP.SECTION }}>
                {isMobile ? (
                  <>
                    <Badge count={activeFilterCount} size="small">
                      <Button icon={<FilterOutlined />} onClick={() => setActiveFilterOpen(true)}>
                        Фильтры
                      </Button>
                    </Badge>
                    <Drawer
                      title="Фильтры"
                      placement="bottom"
                      height="auto"
                      open={activeFilterOpen}
                      onClose={() => setActiveFilterOpen(false)}
                    >
                      {managerSelect}
                      <Button block style={{ marginTop: 16 }} onClick={() => setActiveManagerId(undefined)}>
                        Сбросить фильтры
                      </Button>
                    </Drawer>
                  </>
                ) : managerSelect}
              </Space>
              {renderError(activeDealsError, 'Не удалось загрузить активные сделки')}
              <Row gutter={[16, 16]} style={{ marginBottom: GAP.SECTION }}>
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
                      valueStyle={{ color: tk.colorSuccess }}
                    />
                  </Card>
                </Col>
                <Col xs={24} sm={8}>
                  <Card size="small">
                    <Statistic
                      title="Остаток к оплате"
                      value={activeDealsData?.totals.totalRemaining ?? 0}
                      formatter={(v) => formatUZS(Number(v))}
                      valueStyle={{ color: tk.colorWarning }}
                    />
                  </Card>
                </Col>
              </Row>
              {isMobile ? (
                <List
                  loading={activeDealsLoading}
                  dataSource={activeDealsData?.deals ?? []}
                  locale={{ emptyText: <Empty description="Нет активных сделок" /> }}
                  pagination={{ pageSize: 20, size: 'small' }}
                  renderItem={(r: ActiveDealRow) => (
                    <Card size="small" style={{ marginBottom: 8 }} styles={{ body: { padding: 12 } }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <Link to={`/deals/${r.dealId}`} style={{ fontWeight: 600 }}>
                            {r.title || r.dealId.slice(0, 8)}
                          </Link>
                          <div style={{ marginTop: 4 }}>
                            <ClientCompanyDisplay
                              client={{ id: r.clientId, companyName: r.clientName, isSvip: r.clientIsSvip }}
                              link
                            />
                          </div>
                        </div>
                        <DealStatusTag status={r.status as DealStatus} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 13, marginTop: 10 }}>
                        <span style={{ color: tk.colorTextSecondary }}>Сумма сделки</span>
                        <span style={{ textAlign: 'right' }}>{formatUZS(r.amount)}</span>
                        <span style={{ color: tk.colorTextSecondary }}>Оплачено</span>
                        <span style={{ textAlign: 'right' }}>{formatUZS(r.paidAmount)}</span>
                        <span style={{ color: tk.colorTextSecondary }}>Остаток</span>
                        <span style={{ textAlign: 'right', color: r.remaining > 0 ? tk.colorWarning : tk.colorTextSecondary }}>
                          {formatUZS(r.remaining)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                        {r.isReceiptPunched ? <ReceiptPunchedTag isReceiptPunched /> : <Tag>Чек не пробит</Tag>}
                        <Button
                          size="small"
                          type="link"
                          disabled={!!r.closedToday && !mayPunchClosedReceipt}
                          loading={receiptPunchedMut.isPending && receiptPunchedMut.variables?.dealId === r.dealId}
                          onClick={() => receiptPunchedMut.mutate({ dealId: r.dealId, isReceiptPunched: !r.isReceiptPunched })}
                        >
                          {r.isReceiptPunched ? 'Снять отметку' : 'Отметить чек'}
                        </Button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {getFirstName(r.manager?.fullName) || '—'}
                        </Typography.Text>
                        <Button type="primary" size="middle" onClick={() => openActivePayModal(r)}>
                          Внести платёж
                        </Button>
                      </div>
                    </Card>
                  )}
                />
              ) : (
                <Table
                  dataSource={activeDealsData?.deals}
                  columns={activeDealColumns}
                  rowKey="dealId"
                  loading={activeDealsLoading}
                  pagination={{ defaultPageSize: 30, showSizeChanger: true, pageSizeOptions: ['20', '30', '50', '100'] }}
                  size="middle"
                  bordered={false}
                  scroll={{ x: 1120 }}
                  locale={{ emptyText: 'Нет активных сделок' }}
                />
              )}
            </>
            );
          })(),
        },
        {
          key: 'debtors',
          label: `Долги${debtorClients.length > 0 ? ` (${debtorClients.length})` : ''}`,
          children: (() => {
            const debtsFilterCount =
              (debtRange !== 'all' ? 1 : 0) +
              (debtStatus !== 'all' ? 1 : 0) +
              (debtsManagerId ? 1 : 0) +
              (sortBy !== 'debt_desc' ? 1 : 0);
            const debtsFilterFields = (
              <Space direction={isMobile ? 'vertical' : 'horizontal'} wrap style={{ width: isMobile ? '100%' : undefined }}>
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
                  value={debtsManagerId}
                  onChange={(v) => setDebtsManagerId(v)}
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
            );
            return (
            <>
              <div
                style={{
                  marginBottom: GAP.BLOCK,
                  display: 'flex',
                  flexDirection: isMobile ? 'column' : 'row',
                  justifyContent: 'space-between',
                  alignItems: isMobile ? 'stretch' : 'center',
                  gap: isMobile ? 12 : 0,
                }}
              >
                <Input.Search
                  placeholder="Поиск по клиенту или менеджеру..."
                  style={{ width: isMobile ? '100%' : 300 }}
                  allowClear
                  value={debtSearch}
                  onChange={(e) => setDebtSearch(e.target.value)}
                />
              </div>

              {renderError(debtsError, 'Не удалось загрузить долги')}

              {/* Главные цифры вкладки подавались серым вторичным текстом — слабее,
                  чем placeholder в поиске рядом. Тот же визуальный язык, что и на
                  соседних вкладках: карточки со Statistic. */}
              <Row gutter={[16, 16]} style={{ marginBottom: GAP.SECTION }}>
                <Col xs={24} sm={8}>
                  <Card size="small" loading={debtsLoading}>
                    <Statistic title="Клиентов с долгом" value={debtsData?.totals?.clientCount ?? 0} />
                  </Card>
                </Col>
                <Col xs={24} sm={8}>
                  <Card size="small" loading={debtsLoading}>
                    <Statistic
                      title="Общий долг"
                      value={debtsData?.totals?.totalDebtOwed ?? 0}
                      formatter={(v) => formatUZS(Number(v))}
                      valueStyle={{ color: tk.colorError }}
                    />
                  </Card>
                </Col>
                <Col xs={24} sm={8}>
                  <Card size="small" loading={debtsLoading}>
                    <Statistic
                      title="Переплаты"
                      value={debtsData?.totals?.prepayments ?? 0}
                      formatter={(v) => formatUZS(Number(v))}
                      valueStyle={{ color: tk.colorSuccess }}
                    />
                  </Card>
                </Col>
              </Row>

              <Space wrap style={{ marginBottom: GAP.SECTION }}>
                {isMobile ? (
                  <>
                    <Badge count={debtsFilterCount} size="small">
                      <Button icon={<FilterOutlined />} onClick={() => setDebtsFilterOpen(true)}>
                        Фильтры
                      </Button>
                    </Badge>
                    <Drawer
                      title="Фильтры"
                      placement="bottom"
                      height="auto"
                      open={debtsFilterOpen}
                      onClose={() => setDebtsFilterOpen(false)}
                    >
                      {debtsFilterFields}
                      <Button
                        block
                        style={{ marginTop: 16 }}
                        onClick={() => {
                          setDebtRange('all');
                          setCustomMin(null);
                          setDebtStatus('all');
                          setDebtsManagerId(undefined);
                          setSortBy('debt_desc');
                        }}
                      >
                        Сбросить фильтры
                      </Button>
                    </Drawer>
                  </>
                ) : debtsFilterFields}
              </Space>

              {isMobile ? (
                <List
                  loading={debtsLoading}
                  dataSource={filteredDebtors}
                  locale={{ emptyText: <Empty description="Нет задолженностей" /> }}
                  pagination={{ pageSize: 20, size: 'small' }}
                  renderItem={(r: ClientDebtRow) => {
                    const pct = r.totalAmount > 0 ? Math.round((r.totalPaid / r.totalAmount) * 100) : 0;
                    return (
                      <Card size="small" style={{ marginBottom: 8 }} styles={{ body: { padding: 12 } }}>
                        {/* Кнопка оплаты намеренно НЕ в шапке карточки: там она попадала
                            в зону случайного касания при прокрутке списка. */}
                        <ClientCompanyDisplay
                          client={{ id: r.clientId, companyName: r.clientName, isSvip: r.isSvip }}
                          link
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 13, marginTop: 10 }}>
                          <span style={{ color: tk.colorTextSecondary }}>Общий долг</span>
                          <span style={{ textAlign: 'right', color: r.totalDebt > 0 ? tk.colorError : undefined }}>
                            {formatUZS(r.totalDebt)}
                          </span>
                          <span style={{ color: tk.colorTextSecondary }}>Переплата</span>
                          <span style={{ textAlign: 'right', color: r.prepayment > 0 ? tk.colorSuccess : undefined }}>
                            {r.prepayment > 0 ? formatUZS(r.prepayment) : '—'}
                          </span>
                          <span style={{ color: tk.colorTextSecondary }}>Оплачено</span>
                          <span style={{ textAlign: 'right', color: tk.colorTextSecondary }}>
                            {formatUZS(r.totalPaid)} ({pct}%)
                          </span>
                          <span style={{ color: tk.colorTextSecondary }}>Сделок</span>
                          <span style={{ textAlign: 'right' }}>{r.dealsCount}</span>
                          <span style={{ color: tk.colorTextSecondary }}>Последний платёж</span>
                          <span style={{ textAlign: 'right' }}>
                            {r.lastPaymentDate ? dayjs(r.lastPaymentDate).format('DD.MM.YYYY') : '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {getFirstName(r.manager?.fullName) || '—'}
                          </Typography.Text>
                          {r.paymentStatus === 'PARTIAL'
                            ? <Tag color="orange">Частично</Tag>
                            : <Tag color="default">Не оплачено</Tag>}
                        </div>
                        {r.totalDebt > 0 && (
                          <Button
                            block
                            type="primary"
                            icon={<DollarOutlined />}
                            style={{ marginTop: 12 }}
                            onClick={() => openPayModal(r)}
                          >
                            Оплатить
                          </Button>
                        )}
                      </Card>
                    );
                  }}
                />
              ) : (
                <Table
                  dataSource={filteredDebtors}
                  columns={debtorColumns}
                  rowKey="clientId"
                  loading={debtsLoading}
                  pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
                  size="middle"
                  bordered={false}
                  scroll={{ x: 1150 }}
                  locale={{ emptyText: 'Нет задолженностей' }}
                />
              )}
            </>
            );
          })(),
        },
      ]} />

      {/* Единая точка приёма оплаты: находим сделку и передаём её в обычную форму платежа */}
      <Modal
        title="Принять оплату"
        open={payerModalOpen}
        onCancel={() => { setPayerModalOpen(false); setPayerSearch(''); }}
        footer={null}
        width={isMobile ? 'calc(100vw - 24px)' : 640}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Найдите сделку по клиенту, названию или номеру договора — статус не важен.
        </Typography.Paragraph>
        <Input.Search
          autoFocus
          allowClear
          placeholder="Клиент, название сделки или № договора..."
          value={payerSearch}
          onChange={(e) => setPayerSearch(e.target.value)}
          loading={payerSearching}
        />

        <div style={{ maxHeight: 380, overflowY: 'auto', marginTop: 16 }}>
          {payerSearch.trim().length < 2 && (
            <Typography.Text type="secondary">Введите минимум 2 символа</Typography.Text>
          )}
          {payerSearch.trim().length >= 2 && !payerSearching && !payerResults?.deals.length && (
            <Empty description="Сделки не найдены" />
          )}
          {payerResults?.deals.map((d) => (
            <div
              key={d.dealId}
              role="button"
              tabIndex={0}
              onClick={() => openActivePayModalFromSearch(d)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openActivePayModalFromSearch(d); }
              }}
              style={{
                padding: '10px 12px',
                border: `1px solid ${tk.colorBorderSecondary}`,
                borderRadius: 8,
                marginBottom: 8,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{d.title || d.dealId.slice(0, 8)}</div>
                  <div style={{ fontSize: 12, color: tk.colorTextSecondary }}>
                    {d.clientName}
                    {d.contractNumber && ` · договор №${d.contractNumber}`}
                    {d.manager?.fullName && ` · ${getFirstName(d.manager.fullName)}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ color: d.remaining > 0 ? tk.colorWarning : tk.colorSuccess, fontWeight: 600 }}>
                    {d.remaining > 0 ? formatUZS(d.remaining) : 'Оплачена'}
                  </div>
                  <div style={{ fontSize: 12, color: tk.colorTextSecondary }}>
                    из {formatUZS(d.amount)}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <DealStatusTag status={d.status as DealStatus} />
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Выбор сделки клиента из «Долгов». Собственной формы платежа здесь больше нет:
          она была урезанной копией модалки «Активных» — без зачёта переплаты, даты
          и предпросмотра, — и именно на ней ловился баг с чужой суммой. Теперь после
          выбора сделки открывается та же полная форма. */}
      <Modal
        title={
          selectedClient ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Оплата —
              <ClientCompanyDisplay
                client={{
                  id: selectedClient.clientId,
                  companyName: selectedClient.clientName,
                  isSvip: selectedClient.isSvip,
                }}
                link
              />
            </span>
          ) : (
            'Оплата'
          )
        }
        open={payModalOpen}
        onCancel={() => { setPayModalOpen(false); setSelectedClient(null); }}
        footer={null}
        width={isMobile ? 'calc(100vw - 24px)' : 600}
        destroyOnClose
      >
        {clientDetailLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              Выберите сделку — дальше откроется форма платежа с зачётом переплаты,
              датой и проверкой перед сохранением.
            </Typography.Text>

            <div role="list" aria-label="Сделки клиента" style={{ maxHeight: 340, overflowY: 'auto' }}>
              {clientDeals.length === 0 && (
                <Typography.Text type="secondary">Нет неоплаченных сделок</Typography.Text>
              )}
              {clientDeals.map((deal: any) => {
                const debt = Number(deal.amount) - Number(deal.paidAmount);
                return (
                  <div
                    key={deal.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openActivePayModalFromClientDeal(deal)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openActivePayModalFromClientDeal(deal);
                      }
                    }}
                    style={{
                      padding: '10px 12px',
                      border: `1px solid ${tk.colorBorderSecondary}`,
                      borderRadius: 8,
                      marginBottom: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontWeight: 600 }}>{deal.title || deal.id.slice(0, 8)}</span>
                      <span style={{ color: tk.colorError, whiteSpace: 'nowrap' }}>
                        Долг: {formatUZS(debt)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: tk.colorTextSecondary }}>
                      Сумма: {formatUZS(Number(deal.amount))} · Оплачено: {formatUZS(Number(deal.paidAmount))}
                      {deal.manager?.fullName && ` · ${getFirstName(deal.manager.fullName)}`}
                    </div>
                  </div>
                );
              })}
            </div>
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
          setActivePayPreset('full');
          activePayForm.resetFields();
        }}
        onOk={submitActivePay}
        okText={activePayMode === 'credit' ? 'Зачесть переплату' : 'Сохранить платёж'}
        confirmLoading={activeCashPaymentMut.isPending || applyCreditMut.isPending}
        width={isMobile ? 'calc(100vw - 24px)' : 520}
        destroyOnClose
      >
        {activePayContextLoading || !activePayContext ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <>
            {/* Кто и по какой сделке — одной строкой, без отдельного абзаца */}
            <div style={{ marginBottom: 14, fontSize: 13 }}>
              <ClientCompanyDisplay
                client={{
                  id: activePayContext.deal.clientId,
                  companyName: activePayContext.deal.clientName,
                  isSvip: activePayContext.deal.clientIsSvip,
                }}
                link
              />
              {' · '}
              <Link to={`/deals/${activePayContext.deal.dealId}`}>открыть сделку</Link>
            </div>

            {/* Остаток — главное число экрана, поэтому он крупный, а не одна из
                четырёх одинаковых строк мелкой сетки. */}
            <Card size="small" style={{ marginBottom: 14 }} styles={{ body: { padding: '10px 14px' } }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Остаток по сделке</Typography.Text>
                <Typography.Text
                  strong
                  style={{
                    fontSize: 20,
                    whiteSpace: 'nowrap',
                    color: activePayContext.deal.remaining > 0 ? tk.colorWarning : tk.colorSuccess,
                  }}
                >
                  {activePayContext.deal.remaining > 0
                    ? formatUZS(activePayContext.deal.remaining)
                    : 'Оплачена'}
                </Typography.Text>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '2px 14px',
                  marginTop: 6,
                  fontSize: 12,
                  color: tk.colorTextSecondary,
                }}
              >
                <span>Сумма: {formatUZS(activePayContext.deal.amount)}</span>
                <span>Оплачено: {formatUZS(activePayContext.deal.paidAmount)}</span>
                {activePayContext.deal.overpaymentOnThisDeal > 0 && (
                  <span style={{ color: tk.colorSuccess }}>
                    Переплата здесь: {formatUZS(activePayContext.deal.overpaymentOnThisDeal)}
                  </span>
                )}
              </div>
            </Card>

            {/* Три кнопки-чипа заменены одним переключателем: режим виден всегда,
                а не угадывается по тому, какая кнопка подсветилась. */}
            <Segmented
              block
              value={activePayPreset}
              onChange={(v) => {
                const preset = v as 'full' | 'partial' | 'credit';
                setActivePayPreset(preset);
                const rem = activePayContext.deal.remaining;
                const credit = activePayContext.creditFromOtherDeals;
                if (preset === 'full') {
                  activePayForm.setFieldsValue({ amount: Math.max(0, rem) || undefined });
                } else if (preset === 'partial') {
                  activePayForm.setFieldsValue({ amount: undefined });
                } else {
                  activePayForm.setFieldsValue({ amount: rem > 0 ? Math.min(rem, credit) : credit });
                }
              }}
              options={[
                {
                  label: 'Весь остаток',
                  value: 'full',
                  disabled: activePayContext.deal.remaining <= 0,
                },
                { label: 'Частично', value: 'partial' },
                {
                  label: 'Зачёт переплаты',
                  value: 'credit',
                  disabled: activePayContext.creditFromOtherDeals <= 0,
                },
              ]}
              style={{ marginBottom: 14 }}
            />

            {/* Переплата у клиента почти всегда набрана из нескольких сделок —
                показываем, откуда именно спишутся деньги, до проведения зачёта. */}
            {activePayContext.creditSources.length > 0 && (
              <Card
                size="small"
                style={{
                  marginBottom: 14,
                  // colorSuccessBorder — тёмно-оливковый #274916, на холодном фоне
                  // выглядит болотным. Чистая линия colorSuccess слева вместо него.
                  ...(activePayPreset === 'credit'
                    ? { borderLeft: `3px solid ${tk.colorSuccess}` }
                    : {}),
                }}
                styles={{ body: { padding: '10px 14px' } }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <Typography.Text style={{ fontSize: 12 }} type="secondary">
                    Переплата на других сделках
                    {activePayContext.creditSources.length > 1
                      && ` · ${activePayContext.creditSources.length} шт.`}
                  </Typography.Text>
                  <Typography.Text strong style={{ color: tk.colorSuccess, whiteSpace: 'nowrap' }}>
                    {formatUZS(activePayContext.creditFromOtherDeals)}
                  </Typography.Text>
                </div>
                <div style={{ maxHeight: 96, overflowY: 'auto' }}>
                  {activePayContext.creditSources.map((src, i) => (
                    <div
                      key={src.dealId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        fontSize: 12,
                        padding: '2px 0',
                      }}
                    >
                      <Link
                        to={`/deals/${src.dealId}`}
                        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {i + 1}. {src.title || src.dealId.slice(0, 8)}
                      </Link>
                      <span style={{ whiteSpace: 'nowrap', color: tk.colorTextSecondary }}>
                        {formatUZS(src.surplus)}
                      </span>
                    </div>
                  ))}
                </div>
                {activePayPreset === 'credit' && activePayContext.creditSources.length > 1 && (
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
                    Списание идёт сверху вниз — начиная с наибольшей переплаты.
                  </Typography.Text>
                )}
              </Card>
            )}

            <Form form={activePayForm} layout="vertical" size="middle" requiredMark={false}>
              <Form.Item
                name="amount"
                label="Сумма"
                rules={[{ required: true, message: 'Введите сумму' }]}
                extra={activePayMode === 'credit'
                  ? 'Спишется с переплаты на других сделках — деньги в кассу не поступают.'
                  : 'Сумма выше остатка допустима — лишнее станет переплатой на этой сделке.'}
              >
                <InputNumber
                  autoFocus
                  style={{ width: '100%', fontSize: 18, fontWeight: 600 }}
                  min={1}
                  max={activePayMode === 'credit' ? activePayContext.creditFromOtherDeals : undefined}
                  formatter={moneyFormatter}
                  parser={(v) => Number(moneyParser(v))}
                />
              </Form.Item>

              {/* Второстепенные поля — в две колонки, иначе модалка вырастает
                  в вертикальную простыню из пяти одинаковых полей. */}
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item name="paidAt" label="Дата оплаты" initialValue={dayjs()}>
                    <DatePicker
                      style={{ width: '100%' }}
                      format="DD.MM.YYYY"
                      allowClear={false}
                      disabledDate={(d) => !!d && d.isAfter(dayjs().endOf('day'))}
                    />
                  </Form.Item>
                </Col>
                {activePayMode === 'cash' && (
                  <Col xs={24} sm={12}>
                    <Form.Item name="method" label="Способ оплаты">
                      <Select
                        allowClear
                        placeholder="Выберите"
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
                  </Col>
                )}
              </Row>

              {activePayMode === 'cash' && (
                <Form.Item
                  name="receivedById"
                  label="Принял"
                  tooltip="Кто фактически принял деньги. По умолчанию — вы."
                >
                  <Select
                    allowClear
                    showSearch
                    placeholder="Вы"
                    options={staff}
                    filterOption={(input, option) =>
                      matchesSearch(String(option?.label ?? ''), input)}
                  />
                </Form.Item>
              )}

              <Form.Item name="note" label="Комментарий">
                <Input.TextArea rows={2} placeholder="Необязательно" />
              </Form.Item>
            </Form>

            {activePayPreview && (
              // Финальная проверка перед проводкой — акцентная рамка, а не серая заливка,
              // которая делала самый важный блок модалки визуально самым слабым.
              <Card
                size="small"
                style={{
                  marginTop: 12,
                  // Ни colorPrimaryBg, ни colorPrimaryBorder: при этом primary они дают
                  // один и тот же #182b3c — выходило мутное синее пятно без границы.
                  // Нейтральная полупрозрачная подложка + акцентная полоса слева
                  // не конфликтуют ни с тёмной, ни со светлой темой.
                  background: tk.colorFillQuaternary,
                  borderColor: tk.colorBorderSecondary,
                  borderLeft: `3px solid ${tk.colorPrimary}`,
                }}
              >
                <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                  Итого до сохранения
                </Typography.Text>
                <div style={{ fontSize: 13 }}>
                  <div>{activePayPreview.label}: <strong>{formatUZS(activePayPreview.applied)}</strong></div>
                  <div>Остаток по сделке после: <strong>{formatUZS(activePayPreview.newRemaining)}</strong></div>
                  {activePayPreview.dealOverAfter > 0 && (
                    <div style={{ color: tk.colorSuccess }}>
                      Переплата на сделке: <strong>{formatUZS(activePayPreview.dealOverAfter)}</strong>
                    </div>
                  )}
                  {activePayPreview.shortfall > 0 && (
                    <div style={{ color: tk.colorWarning, marginTop: 4 }}>
                      Переплаты не хватает на {formatUZS(activePayPreview.shortfall)} — зачтётся только
                      доступное.
                    </div>
                  )}
                  {activePayPreview.drain.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Спишется со сделок:
                      </Typography.Text>
                      {activePayPreview.drain.map((d) => (
                        <div
                          key={d.dealId}
                          style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}
                        >
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.title || d.dealId.slice(0, 8)}
                          </span>
                          <span style={{ whiteSpace: 'nowrap' }}>−{formatUZS(d.amount)}</span>
                        </div>
                      ))}
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
