import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Typography, Spin, Tag, theme, Progress, Table, Badge, Segmented, Pagination, DatePicker } from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  CheckCircleOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { dashboardApi, type DashboardPeriod } from '../api/warehouse.api';
import { financeApi } from '../api/finance.api';
import { analyticsApi, type AnalyticsPeriodQuery } from '../api/analytics.api';
import { settingsApi } from '../api/settings.api';
import { profileApi } from '../api/profile.api';
import { formatUZS, formatCount, formatMoneyCompact } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuthStore } from '../store/authStore';
import { SHOW_MY_MONTHLY_GOALS } from '../constants/featureFlags';
import { useThemeStore } from '../store/themeStore';
import { Column } from '@ant-design/charts';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import VedEventsQuickAccessCard from '../components/VedEventsQuickAccessCard';
import DashboardGreeting from '../components/DashboardGreeting';
import { ActiveStages, KpiFoot, KpiShareBar, KpiSparkline } from '../components/dashboard/KpiExtras';
import CallsKpi from '../components/dashboard/CallsKpi';
import RevenueBlock from '../components/dashboard/RevenueBlock';
import DealStagesBlock from '../components/dashboard/DealStagesBlock';
import GoalsBlock from '../components/dashboard/GoalsBlock';
import { callsApi } from '../api/calls.api';
import type { Permission, UserRole } from '../types';
import { getFirstName } from '../lib/name-utils';
import './DashboardPage.css';
import MissedCallsWidget from '../components/calls/MissedCallsWidget';

const DEFAULT_GOAL = 250_000_000;

/** Bar + rank badge colors for «Товар дня» (top-N order matches chart). */
/** Сколько проблемных остатков показывать на дашборде в новом дизайне. */
const STOCK_PREVIEW_LIMIT = 8;

const PRODUCT_DAY_BAR_COLORS = [
  '#22c55e',
  '#14b8a6',
  '#64748b',
  '#f59e0b',
  '#a855f7',
  '#38bdf8',
  '#fb923c',
  '#94a3b8',
] as const;

/** Новый дизайн: та же последовательность, но спокойнее — на стекле насыщенные цвета режут глаз. */
const PRODUCT_DAY_BAR_COLORS_MODERN = [
  '#4ade80',
  '#5eead4',
  '#a5b4fc',
  '#fcd34d',
  '#d8b4fe',
  '#7dd3fc',
  '#fdba74',
  '#cbd5e1',
] as const;

const PRODUCT_DAY_PAGE_SIZE = 5;

/** G2 adds extra tooltip rows for color (hex) and raw y; keep only our formatted row. */
function stripProductDayTooltipExtraRows(): void {
  document.querySelectorAll('.g2-tooltip .g2-tooltip-list-item').forEach((row) => {
    const valueCell = row.querySelector('.g2-tooltip-list-item-value');
    const valTxt = (valueCell?.textContent ?? '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(valTxt)) {
      (row as HTMLElement).style.display = 'none';
      return;
    }
    if (/^\d+$/.test(valTxt) && valTxt.length >= 4) {
      (row as HTMLElement).style.display = 'none';
    }
  });
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function DeltaBadge({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="dashboard-delta-empty">—</span>;
  const up = value >= 0;
  return (
    <span className={`dashboard-delta-badge ${up ? 'dashboard-delta-badge--up' : 'dashboard-delta-badge--down'}`}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{' '}
      {up ? '+' : ''}{value.toFixed(1)}%
      {suffix && <span className="dashboard-delta-suffix">{suffix}</span>}
    </span>
  );
}

const PERIOD_OPTIONS: { label: string; value: DashboardPeriod }[] = [
  { label: 'День', value: 'day' },
  { label: 'Неделя', value: 'week' },
  { label: 'Месяц', value: 'month' },
  { label: 'Квартал', value: 'quarter' },
];

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  day: 'сегодня',
  week: 'за неделю',
  month: 'за месяц',
  quarter: 'за квартал',
  custom: 'за период',
};

/**
 * Ряд по дням без пропусков: дни без данных — нули, чтобы линия не врала о тренде.
 * Воскресенье — выходной, его в ряду нет: иначе каждую неделю провал до нуля.
 */
function fillDays(points: { day: string; value: number }[], from: string, to: string): { day: string; value: number }[] {
  const byDay = new Map(points.map((p) => [p.day.slice(0, 10), p.value]));
  const out: { day: string; value: number }[] = [];
  for (let d = dayjs(from); !d.isAfter(dayjs(to), 'day') && out.length < 400; d = d.add(1, 'day')) {
    if (d.day() === 0) continue;
    const day = d.format('YYYY-MM-DD');
    out.push({ day, value: byDay.get(day) ?? 0 });
  }
  return out;
}

/** С чем сравниваем в подписи карточки: сервер отдаёт прошлый период в полях `*Yesterday`. */
const PREV_BASE_LABELS: Record<DashboardPeriod, string> = {
  day: 'вчера',
  week: 'пр. неделя',
  month: 'пр. месяц',
  quarter: 'пр. квартал',
  custom: 'пр. период',
};

/** Склонение по числу: pluralRu(5, ['клиент', 'клиента', 'клиентов']) → «клиентов». */
function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('day');
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);

  const dashboardParams = useMemo(() => {
    if (period === 'custom' && customRange) {
      return {
        period,
        from: customRange[0].format('YYYY-MM-DD'),
        to: customRange[1].format('YYYY-MM-DD'),
      };
    }
    return { period };
  }, [period, customRange]);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary', dashboardParams],
    queryFn: () => dashboardApi.summary(dashboardParams),
    enabled: period !== 'custom' || !!customRange,
    placeholderData: (prev) => prev,
    refetchInterval: period === 'custom' ? 120_000 : 60_000,
  });

  const { data: debtsData } = useQuery({
    queryKey: ['finance-debts-total'],
    queryFn: () => financeApi.getDebts({ totalsOnly: 1 }),
    refetchInterval: 120_000,
  });

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.getCompanySettings,
    staleTime: 300_000,
  });

  const user = useAuthStore((s) => s.user);
  const { token: tk } = theme.useToken();
  const navigate = useNavigate();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const design = useThemeStore((s) => s.design);
  const modern = design === 'modern';
  const productDayColors = modern ? PRODUCT_DAY_BAR_COLORS_MODERN : PRODUCT_DAY_BAR_COLORS;
  const isMobile = useIsMobile();

  const role = user?.role as UserRole | undefined;
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const canViewClosedDealsHistory =
    role === 'SUPER_ADMIN'
    || role === 'ADMIN'
    || (user?.permissions ?? []).includes('view_closed_deals_history' as Permission);
  const canViewVedEvents =
    role === 'SUPER_ADMIN'
    || role === 'ADMIN'
    || (user?.permissions ?? []).includes('view_import_orders' as Permission)
    || (user?.permissions ?? []).includes('manage_import_orders' as Permission);
  // Без доступа к стратегическим деньгам дашборд показывает только счётчики: графики выручки,
  // ABC и цели скрываются целиком — сервер их всё равно обнулит, а пустые графики только путают.
  const canSeeMoney = (user?.moneyAccess ?? 'FULL') === 'FULL';
  const showExtras = (isAdmin || role === 'MANAGER') && canSeeMoney;

  const analyticsPeriodQuery = useMemo((): AnalyticsPeriodQuery => {
    if (period === 'custom' && customRange) {
      return { from: customRange[0].format('YYYY-MM-DD'), to: customRange[1].format('YYYY-MM-DD') };
    }
    if (period === 'day' || period === 'custom') return { period: 'month' };
    return { period };
  }, [period, customRange]);

  // Графики не ждут сводку: раньше они стартовали второй волной, и дашборд открывался вдвое дольше.
  const { data: monthAnalytics, isLoading: extLoading } = useQuery({
    queryKey: ['dashboard-analytics-extras', analyticsPeriodQuery],
    queryFn: () => analyticsApi.getData(analyticsPeriodQuery),
    enabled: showExtras,
    refetchInterval: 60_000,
  });

  const { data: myGoal } = useQuery({
    queryKey: ['profile-monthly-goal'],
    queryFn: () => profileApi.monthlyGoal(),
    refetchInterval: 60_000,
  });

  // KPI «Звонки сегодня» — тем, у кого есть рабочие звонки (менеджер видит свои, руководитель — всех)
  const canSeeCallsKpi = isAdmin || role === 'MANAGER' || (user?.permissions ?? []).includes('use_rop_agent' as Permission);
  const { data: callsStats } = useQuery({
    queryKey: ['calls-today-stats'],
    queryFn: callsApi.todayStats,
    enabled: canSeeCallsKpi,
    refetchInterval: 60_000,
  });

  const { data: abcData } = useQuery({
    queryKey: ['dashboard-abc', analyticsPeriodQuery],
    queryFn: () => analyticsApi.getAbcXyz(analyticsPeriodQuery),
    enabled: showExtras,
    refetchInterval: 120_000,
  });

  const topProducts = useMemo(() => {
    if (!abcData?.products?.length) return [];
    return [...abcData.products].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [abcData]);

  const topManagers = useMemo(() => {
    const rows = monthAnalytics?.managers?.rows ?? [];
    return [...rows].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 5);
  }, [monthAnalytics]);

  const topClients = useMemo(() => {
    return (monthAnalytics?.sales?.topClients ?? []).slice(0, 5);
  }, [monthAnalytics]);

  const [productDayPeriod, setProductDayPeriod] = useState<'today' | 'yesterday'>('today');
  const [productDayPage, setProductDayPage] = useState(1);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);

  // NOTE: must be before the early return — React rules of hooks
  const productDayItems = useMemo(() => {
    const list = data?.productOfDayList?.[productDayPeriod];
    if (list?.length) {
      const merged = new Map<string, (typeof list)[number]>();
      for (const item of list) {
        const key = `${item.product.name}__${item.product.sku || ''}__${item.product.unit || ''}`;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, { ...item, qty: Number(item.qty || 0), revenue: Number(item.revenue || 0) });
        } else {
          existing.qty += Number(item.qty || 0);
          existing.revenue += Number(item.revenue || 0);
        }
      }
      return [...merged.values()].sort((a, b) => b.revenue - a.revenue);
    }
    const topOnly = data?.productOfDay?.[productDayPeriod];
    return topOnly ? [topOnly] : [];
  }, [data, productDayPeriod]);

  const pagedProductDayItems = useMemo(() => {
    const start = (productDayPage - 1) * PRODUCT_DAY_PAGE_SIZE;
    return productDayItems.slice(start, start + PRODUCT_DAY_PAGE_SIZE);
  }, [productDayItems, productDayPage]);

  const productDayChartData = useMemo(() => {
    const topRows = productDayItems.slice(0, 8);
    return topRows.map((item, index) => {
      const revenue = Number(item.revenue || 0);
      const fill = productDayColors[index % productDayColors.length];
      return {
        id: item.product.id,
        name: item.product.name || 'Товар',
        revenue,
        fill,
      };
    });
  }, [productDayItems, productDayColors]);

  const productDayChartYMax = useMemo(() => {
    const top8 = productDayItems.slice(0, 8).map((i) => Number(i.revenue || 0));
    const maxRev = Math.max(1, ...top8);
    return Math.max(5_000_000, Math.ceil(maxRev / 5_000_000) * 5_000_000);
  }, [productDayItems]);

  const productDayListMeasureRef = useRef<HTMLDivElement>(null);
  const [productDayChartHeight, setProductDayChartHeight] = useState(260);

  useLayoutEffect(() => {
    const el = productDayListMeasureRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setProductDayChartHeight(Math.round(Math.max(180, h)));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [productDayItems.length, productDayPage, pagedProductDayItems.length, isMobile]);
  const maxProductDayPage = Math.max(1, Math.ceil(productDayItems.length / PRODUCT_DAY_PAGE_SIZE));
  useEffect(() => {
    if (productDayPage > maxProductDayPage) setProductDayPage(maxProductDayPage);
  }, [productDayPage, maxProductDayPage]);
  useEffect(() => {
    setActiveProductId(null);
  }, [productDayPeriod]);

  const handlePeriodChange = useCallback((val: string | number) => {
    const v = val as DashboardPeriod;
    setPeriod(v);
    if (v !== 'custom') setCustomRange(null);
  }, []);

  const handleCustomRange = useCallback((dates: [Dayjs | null, Dayjs | null] | null) => {
    if (dates && dates[0] && dates[1]) {
      setCustomRange([dates[0], dates[1]]);
    }
  }, []);

  const revenueLabel = period === 'day' ? 'Выручка сегодня' : `Выручка ${PERIOD_LABELS[period]}`;
  const closedDealsLabel = period === 'day' ? 'Закрыто сделок' : `Закрыто сделок ${PERIOD_LABELS[period]}`;

  if (isLoading || !data) {
    return <Spin size="large" style={{ display: 'block', margin: '120px auto' }} />;
  }

  const totalDebt = debtsData?.totals?.totalDebtOwed ?? data.totalDebt;
  // Текущий период ещё идёт: в начале дня «−100% к вчера» пугает, хотя значит лишь «продаж пока нет».
  const periodInProgress = period !== 'custom';
  const revPct = isAdmin && !(periodInProgress && !data.revenueToday)
    ? pctChange(data.revenueToday || 0, data.revenueYesterday || 0)
    : null;
  const dealPct = isAdmin && !(periodInProgress && !data.closedDealsToday)
    ? pctChange(data.closedDealsToday || 0, data.closedDealsYesterday || 0)
    : null;
  const revenueGoal = companySettings?.monthlyRevenueGoal || DEFAULT_GOAL;
  const revenueMonth = data.revenueMonth || 0;
  const goalRemaining = Math.max(0, revenueGoal - revenueMonth);
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const dailyGoal = companySettings?.dailyRevenueGoal || (revenueGoal / daysInMonth);
  const revenueTodayForGoal = data.revenueToday || 0;
  const hasMyGoal = !!myGoal && (
    myGoal.targets.deals != null ||
    myGoal.targets.revenue != null ||
    myGoal.targets.callNotes != null
  );

  const allStockIssues = [
    ...(data.zeroStockProducts || []).map((p) => ({ ...p, issue: 'zero' as const })),
    ...(data.lowStockProducts || []).map((p) => ({ ...p, issue: 'low' as const })),
  ].filter((p) => !p.sku?.startsWith('TARGET'));
  // Дашборд — сводка: в новом дизайне показываем самые критичные позиции, остальные — на складе.
  // Нулевые остатки идут первыми, поэтому в превью попадают они.
  const stockPreview = modern ? allStockIssues.slice(0, STOCK_PREVIEW_LIMIT) : allStockIssues;
  const stockHidden = allStockIssues.length - stockPreview.length;

  /* ── KPI-карточки: база сравнения, разбивка, подписи ── */
  // Диапазон мини-графиков — как у графика выручки: 30 дней до сегодня или выбранный период
  const chartTo = dayjs().format('YYYY-MM-DD');
  const chartFrom = period === 'day' || !data.period
    ? dayjs().subtract(30, 'day').format('YYYY-MM-DD')
    : dayjs(data.period.from).format('YYYY-MM-DD');
  const closedSeries = fillDays((data.closedDealsByDay ?? []).map((d) => ({ day: d.day, value: d.count })), chartFrom, chartTo);
  const closedAvg = closedSeries.length ? closedSeries.reduce((s, p) => s + p.value, 0) / closedSeries.length : 0;
  const moneyShort = (v: number) => {
    const m = formatMoneyCompact(v);
    return m.unit ? `${m.text} ${m.unit}` : m.text;
  };
  const prevWord = PREV_BASE_LABELS[period];
  const goalVisible = (isAdmin || role === 'MANAGER') && canSeeMoney && period === 'day';
  // Утром продаж ещё нет: вместо «−100 % к вчера» — «пока нет · вчера …»
  const revenueFoot = (
    <>
      <KpiFoot delta={revPct !== null ? <DeltaBadge value={revPct} /> : undefined}>
        {periodInProgress && !data.revenueToday ? 'пока нет · ' : ''}
        {prevWord} {moneyShort(data.revenueYesterday || 0)}
      </KpiFoot>
      {goalVisible && (
        <KpiFoot>
          месяц {moneyShort(revenueMonth)} · {goalRemaining > 0 ? `до цели ${moneyShort(goalRemaining)}` : 'цель выполнена'}
        </KpiFoot>
      )}
      {canSeeMoney && (
        <KpiSparkline
          label="Выручка по дням"
          format={formatUZS}
          points={fillDays((data.revenueLast30Days ?? []).map((d) => ({ day: d.day, value: Number(d.total) || 0 })), chartFrom, chartTo)}
        />
      )}
    </>
  );
  const closedFoot = (
    <>
      <KpiFoot delta={dealPct !== null ? <DeltaBadge value={dealPct} /> : undefined}>
        {periodInProgress && !data.closedDealsToday ? 'пока нет · ' : ''}
        {prevWord} {formatCount(data.closedDealsYesterday || 0)}
      </KpiFoot>
      {closedSeries.some((p) => p.value > 0) && (
        <>
          <KpiFoot>в среднем {closedAvg.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} в рабочий день за {closedSeries.length} дн.</KpiFoot>
          <KpiSparkline
            label="Закрытые сделки по дням"
            format={(v) => `${formatCount(v)} ${pluralRu(v, ['сделка', 'сделки', 'сделок'])}`}
            points={closedSeries}
          />
        </>
      )}
    </>
  );
  const activeFoot = <ActiveStages counts={data.dealsByStatusCounts ?? []} />;
  // Список просрочек в аналитике обрезан на 20 строк — при упоре без суммы
  const overdue = monthAnalytics?.finance?.overdueDebts ?? [];
  const debtorsCount = debtsData?.totals?.clientCount;
  const overdueSum = overdue.reduce((sum, d) => sum + (Number(d.debt) || 0), 0);
  const topDebtor = monthAnalytics?.finance?.topDebtors?.[0];
  const debtFoot = (
    <>
    <KpiFoot>
      {debtorsCount != null && debtorsCount > 0 ? `${formatCount(debtorsCount)} ${pluralRu(debtorsCount, ['клиент', 'клиента', 'клиентов'])}` : null}
      {debtorsCount != null && debtorsCount > 0 && overdue.length > 0 ? ' · ' : ''}
      {overdue.length > 0 && (
        <span className="kpi-foot__text--risk">
          просрочено {overdue.length >= 20 ? '20+' : formatCount(overdue.length)} {pluralRu(overdue.length, ['сделка', 'сделки', 'сделок'])}
          {overdue.length < 20 ? ` на ${moneyShort(overdueSum)}` : ''}
        </span>
      )}
    </KpiFoot>
    {overdue.length > 0 && overdue.length < 20 && (
      <KpiShareBar part={overdueSum} total={totalDebt} title={`Просрочено ${formatUZS(overdueSum)} из ${formatUZS(totalDebt)}`} />
    )}
    {topDebtor && (
      <KpiFoot>больше всех: {topDebtor.companyName} — {moneyShort(topDebtor.totalDebt)}</KpiFoot>
    )}
    </>
  );

  /* ── shared styles ── */
  const card: CSSProperties = {
    borderRadius: 10,
    border: `1px solid ${tk.colorBorderSecondary}`,
    boxShadow: 'none',
  };
  const cardBody = { padding: '16px 20px' };
  const kpiGutter: [number, number] = isMobile ? [0, 12] : [16, 16];
  const blockGutter: [number, number] = isMobile ? [0, 12] : [16, 16];

  return (
    <div className="dashboard-page" style={{ paddingBottom: isMobile ? undefined : 32 }}>
      <style>{`
        .stock-row-zero td { background: rgba(255, 77, 79, 0.06) !important; }
        .stock-row-low td { background: rgba(250, 140, 22, 0.06) !important; }
      `}</style>

      {design === 'modern' ? (
        <DashboardGreeting
          name={getFirstName(user?.fullName) || 'коллега'}
          period={period}
          onPeriodChange={handlePeriodChange}
          canPickCustom={isAdmin}
          customRange={customRange}
          onCustomRange={handleCustomRange}
        />
      ) : (
        <>
        {/* ── Header ── */}
        {isMobile ? (
          <div className="dashboard-header">
            <div>
              <div className="dashboard-title">Дашборд</div>
              {user?.fullName && (
                <Typography.Text
                  type="secondary"
                  className="dashboard-subtitle"
                  style={{ fontSize: 13, display: 'block', marginTop: 4 }}
                >
                  Добро пожаловать, {user.fullName.split(' ')[0]}
                </Typography.Text>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <Typography.Title level={4} style={{ margin: 0, fontWeight: 600 }}>Дашборд</Typography.Title>
            {user?.fullName && (
              <Typography.Text type="secondary" className="dashboard-subtitle" style={{ fontSize: 13 }}>
                Добро пожаловать, {user.fullName.split(' ')[0]}
              </Typography.Text>
            )}
          </div>
        )}

        {/* ── Period selector ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: isMobile ? 12 : 16,
          flexWrap: 'wrap',
        }}>
          <Segmented
            size={isMobile ? 'small' : 'middle'}
            value={period}
            onChange={handlePeriodChange}
            options={[
              ...PERIOD_OPTIONS,
              ...(isAdmin ? [{ label: 'Период', value: 'custom' as DashboardPeriod, icon: <CalendarOutlined /> }] : []),
            ]}
          />
          {period === 'custom' && isAdmin && (
            <DatePicker.RangePicker
              size={isMobile ? 'small' : 'middle'}
              value={customRange}
              onChange={handleCustomRange as (dates: unknown) => void}
              format="DD.MM.YYYY"
              allowClear={false}
              style={{ maxWidth: isMobile ? '100%' : 260 }}
              disabledDate={(current) => current && current > dayjs().endOf('day')}
            />
          )}
        </div>
        </>
      )}

      {/* ── KPI cards ── */}
      <div className={isMobile ? 'section' : undefined}>
      {isMobile ? (
        <div className="cards-grid">
          <Link to="/revenue/today" className="cards-grid__link cards-grid__link--hero">
            <Card
              className="dashboard-metric-card card card-hero"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%', borderLeft: '3px solid #52c41a' }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label">
                {revenueLabel}
              </Typography.Text>
              <div className="dashboard-card-value">{formatUZS(data.revenueToday || 0)}</div>
              <div className="dashboard-card-delta">
                {revenueFoot}
              </div>
            </Card>
          </Link>

          <Link to={canViewClosedDealsHistory ? '/deals/closed' : '#'} className="cards-grid__link">
            <Card
              className="dashboard-metric-card card"
              bordered={false}
              hoverable={canViewClosedDealsHistory}
              style={{ ...card, cursor: canViewClosedDealsHistory ? 'pointer' : 'default', height: '100%' }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label">{closedDealsLabel}</Typography.Text>
              <div className="dashboard-card-value">{data.closedDealsToday}</div>
              <div className="dashboard-card-delta">
                {closedFoot}
              </div>
            </Card>
          </Link>

          <Link to="/deals" className="cards-grid__link">
            <Card
              className="dashboard-metric-card card"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%' }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label">Активные сделки</Typography.Text>
              <div className="dashboard-card-value">{data.activeDealsCount}</div>
              <div className="dashboard-card-delta">
                {activeFoot}
              </div>
            </Card>
          </Link>

          <Link to="/finance/debts" className="cards-grid__link cards-grid__link--full">
            <Card
              className="dashboard-metric-card card card-full"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%' }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label">Общий долг</Typography.Text>
              <div className="dashboard-card-value">{formatUZS(totalDebt)}</div>
              <div className="dashboard-card-delta">
                {debtFoot}
              </div>
            </Card>
          </Link>

          {callsStats && (
            <Link to="/calls" className="cards-grid__link cards-grid__link--full">
              <Card className="dashboard-metric-card card card-full" bordered={false} hoverable style={{ ...card, cursor: 'pointer', height: '100%' }}>
                <Typography.Text type="secondary" className="dashboard-card-label">Звонки сегодня</Typography.Text>
                <CallsKpi stats={callsStats} />
              </Card>
            </Link>
          )}
        </div>
      ) : (
      <Row className="dashboard-kpi-row" gutter={kpiGutter}>
        {/* Revenue — accent */}
        <Col xs={24} sm={12} lg={6}>
          <Link to="/revenue/today" style={{ display: 'block', height: '100%' }}>
            <Card
              className="dashboard-metric-card"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%', borderLeft: '3px solid #52c41a' }}
              styles={{ body: cardBody }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label" style={{ fontSize: 13 }}>
                {revenueLabel}
              </Typography.Text>
              <div
                className="dashboard-card-value"
                style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}
              >
                {formatUZS(data.revenueToday || 0)}
              </div>
              <div className="dashboard-card-delta">
                {revenueFoot}
              </div>
            </Card>
          </Link>
        </Col>

        {/* Closed deals */}
        <Col xs={24} sm={12} lg={6}>
          <Link to={canViewClosedDealsHistory ? '/deals/closed' : '#'} style={{ display: 'block', height: '100%' }}>
            <Card
              className="dashboard-metric-card"
              bordered={false}
              hoverable={canViewClosedDealsHistory}
              style={{ ...card, cursor: canViewClosedDealsHistory ? 'pointer' : 'default', height: '100%' }}
              styles={{ body: cardBody }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label" style={{ fontSize: 13 }}>{closedDealsLabel}</Typography.Text>
              <div
                className="dashboard-card-value"
                style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}
              >
                {data.closedDealsToday}
              </div>
              <div className="dashboard-card-delta">
                {closedFoot}
              </div>
            </Card>
          </Link>
        </Col>

        {/* Active deals */}
        <Col xs={24} sm={12} lg={6}>
          <Link to="/deals" style={{ display: 'block', height: '100%' }}>
            <Card
              className="dashboard-metric-card"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%' }}
              styles={{ body: cardBody }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label" style={{ fontSize: 13 }}>Активные сделки</Typography.Text>
              <div
                className="dashboard-card-value"
                style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}
              >
                {data.activeDealsCount}
              </div>
              <div className="dashboard-card-delta">
                {activeFoot}
              </div>
            </Card>
          </Link>
        </Col>

        {/* Debt — value uses default text color; red only on negative deltas elsewhere */}
        <Col xs={24} sm={12} lg={6}>
          <Link to="/finance/debts" style={{ display: 'block', height: '100%' }}>
            <Card
              className="dashboard-metric-card"
              bordered={false}
              hoverable
              style={{ ...card, cursor: 'pointer', height: '100%' }}
              styles={{ body: cardBody }}
            >
              <Typography.Text type="secondary" className="dashboard-card-label" style={{ fontSize: 13 }}>Общий долг</Typography.Text>
              <div
                className="dashboard-card-value"
                style={{ fontSize: 20, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}
              >
                {formatUZS(totalDebt)}
              </div>
              <div className="dashboard-card-delta">
                {debtFoot}
              </div>
            </Card>
          </Link>
        </Col>
        {callsStats && (
          <Col xs={24}>
            <Link to="/calls" style={{ display: 'block' }}>
              <Card className="dashboard-metric-card" bordered={false} hoverable style={{ ...card, cursor: 'pointer' }} styles={{ body: cardBody }}>
                <Typography.Text type="secondary" className="dashboard-card-label" style={{ fontSize: 13 }}>Звонки сегодня</Typography.Text>
                <CallsKpi stats={callsStats} />
              </Card>
            </Link>
          </Col>
        )}
      </Row>
      )}
      </div>

      {/* ── Monthly goal (compact, clickable → settings) ── */}
      {SHOW_MY_MONTHLY_GOALS && hasMyGoal && myGoal && (
        <div className={isMobile ? 'section' : undefined}>
          <Card
            bordered={false}
            style={{ ...card, marginTop: isMobile ? 0 : 16 }}
            styles={{ body: { padding: isMobile ? 14 : '12px 20px' } }}
            title={<Typography.Text strong style={{ fontSize: 14 }}>Мои цели на месяц</Typography.Text>}
          >
            <Row gutter={[12, 12]}>
              {myGoal.targets.deals != null && (
                <Col xs={24} md={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Сделки (закрыто)</Typography.Text>
                  <div style={{ marginTop: 2, marginBottom: 6 }}>
                    <Typography.Text strong>{myGoal.actual.dealsClosed}</Typography.Text>
                    <Typography.Text type="secondary"> / {myGoal.targets.deals}</Typography.Text>
                  </div>
                  <Progress percent={Math.min(100, myGoal.progress.deals ?? 0)} size="small" />
                </Col>
              )}
              {myGoal.targets.revenue != null && (
                <Col xs={24} md={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Выручка</Typography.Text>
                  <div style={{ marginTop: 2, marginBottom: 6 }}>
                    <Typography.Text strong>{formatUZS(myGoal.actual.revenue)}</Typography.Text>
                    <Typography.Text type="secondary"> / {formatUZS(myGoal.targets.revenue)}</Typography.Text>
                  </div>
                  <Progress percent={Math.min(100, myGoal.progress.revenue ?? 0)} size="small" />
                </Col>
              )}
              {myGoal.targets.callNotes != null && (
                <Col xs={24} md={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Обзвоны (заметки)</Typography.Text>
                  <div style={{ marginTop: 2, marginBottom: 6 }}>
                    <Typography.Text strong>{myGoal.actual.callNotes}</Typography.Text>
                    <Typography.Text type="secondary"> / {myGoal.targets.callNotes}</Typography.Text>
                  </div>
                  <Progress percent={Math.min(100, myGoal.progress.callNotes ?? 0)} size="small" />
                </Col>
              )}
            </Row>
          </Card>
        </div>
      )}

      {/* Пропущенные звонки с рабочих телефонов: менеджеру свои, руководителю сводка */}
      <MissedCallsWidget />

      {/* Цели по выручке: сегодня, месяц по дням, год по месяцам (год — только админам) */}
      {(isAdmin || role === 'MANAGER') && canSeeMoney && (
        <div className={isMobile ? 'section' : undefined}>
          <Card
            className="dashboard-goals-card"
            bordered={false}
            style={{ ...card, marginTop: isMobile ? 0 : 16 }}
            styles={{ body: { padding: isMobile ? 16 : '18px 20px' } }}
          >
            <GoalsBlock
              revenueToday={revenueTodayForGoal}
              revenueMonth={revenueMonth}
              monthlyGoal={revenueGoal}
              dailyGoal={dailyGoal}
              yearlyGoal={companySettings?.yearlyRevenueGoal || revenueGoal * 12}
              goals={data.goals}
              showYear={isAdmin}
              canEdit={isAdmin}
            />
          </Card>
        </div>
      )}

      {canViewVedEvents && (
        <div className={isMobile ? 'section' : undefined}>
          <div style={{ marginTop: isMobile ? 0 : 16 }}>
            <VedEventsQuickAccessCard />
          </div>
        </div>
      )}

      {/* ── Выручка за 30 дней + сделки в работе ── */}
      {isAdmin && (
        <div className={isMobile ? 'section' : undefined}>
        <Row gutter={blockGutter} style={{ marginTop: isMobile ? 0 : 16 }} align="stretch">
          <Col xs={24} lg={14} style={{ display: 'flex' }}>
            <Card bordered={false} style={{ ...card, width: '100%' }} styles={{ body: { padding: isMobile ? 16 : '18px 20px', height: '100%' } }}>
              <RevenueBlock
                title={period === 'day' ? 'Выручка за 30 дней' : `Выручка ${PERIOD_LABELS[period]}`}
                points={fillDays((data.revenueLast30Days ?? []).map((d) => ({ day: d.day, value: Number(d.total) || 0 })), chartFrom, chartTo)}
                total={(data.revenueLast30Days ?? [])
                  .filter((d) => d.day.slice(0, 10) >= chartFrom && d.day.slice(0, 10) <= chartTo)
                  .reduce((sum, d) => sum + (Number(d.total) || 0), 0)}
                prevTotal={data.chartPrevTotal ?? 0}
                dailyGoal={dailyGoal}
                showGoal={canSeeMoney}
              />
            </Card>
          </Col>
          <Col xs={24} lg={10} style={{ display: 'flex' }}>
            <Card
              bordered={false}
              style={{ ...card, width: '100%' }}
              styles={{ body: { padding: isMobile ? 16 : '18px 20px', height: '100%' } }}
            >
              <DealStagesBlock
                counts={data.dealsByStatusCounts ?? []}
                closedInPeriod={data.closedInChart ?? 0}
                closedLabel={period === 'day' ? 'за 30 дней' : PERIOD_LABELS[period]}
              />
            </Card>
          </Col>
        </Row>
        </div>
      )}

      {/* ── Product of the day ── */}
      {(isAdmin || role === 'MANAGER') && (
        <div className={isMobile ? 'section' : undefined}>
        <Row gutter={blockGutter} style={{ marginTop: isMobile ? 0 : 16 }}>
          <Col xs={24}>
            <Card
              bordered={false}
              style={card}
              styles={{ body: { padding: '14px 16px' } }}
              title={(
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <Typography.Text strong style={{ fontSize: 14 }}>
                    {period === 'day' ? 'Товар дня (по выручке)' : `Топ товаров ${PERIOD_LABELS[period]}`}
                  </Typography.Text>
                  {period === 'day' && (
                    <Segmented
                      size="small"
                      value={productDayPeriod}
                      onChange={(v) => setProductDayPeriod(v as 'today' | 'yesterday')}
                      options={[
                        { label: 'Сегодня', value: 'today' },
                        { label: 'Вчера', value: 'yesterday' },
                      ]}
                    />
                  )}
                </div>
              )}
            >
              {productDayItems.length === 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  Нет продаж за выбранный день
                </Typography.Text>
              ) : (
                <>
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                    Показано {Math.min(productDayItems.length, (productDayPage - 1) * PRODUCT_DAY_PAGE_SIZE + 1)}-
                    {Math.min(productDayItems.length, productDayPage * PRODUCT_DAY_PAGE_SIZE)} из {productDayItems.length}
                  </Typography.Text>

                  <Row gutter={[16, 12]} align="stretch" wrap>
                    <Col xs={24} lg={14} style={{ display: 'flex', minWidth: 0 }}>
                      <div
                        ref={productDayListMeasureRef}
                        style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}
                      >
                        {pagedProductDayItems.map((item, idx) => {
                          const unit = item.product.unit?.trim() || 'шт';
                          const rank = (productDayPage - 1) * PRODUCT_DAY_PAGE_SIZE + idx + 1;
                          const isActive = activeProductId === item.product.id;
                          const badgeColor =
                            productDayColors[(rank - 1) % productDayColors.length];
                          return (
                            <div
                              key={item.product.id}
                              onMouseEnter={() => setActiveProductId(item.product.id)}
                              onMouseLeave={() => setActiveProductId(null)}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 12,
                                padding: '9px 10px',
                                borderRadius: 10,
                                border: `1px solid ${isActive ? badgeColor : tk.colorBorderSecondary}`,
                                background: isActive ? `${badgeColor}1f` : 'transparent',
                                boxShadow: isActive ? `0 0 0 1px ${badgeColor}33` : 'none',
                                transition: 'all 160ms ease',
                              }}
                            >
                              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span
                                  style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 7,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: '#f8fafc',
                                    background: badgeColor,
                                    flexShrink: 0,
                                  }}
                                >
                                  {rank}
                                </span>
                                <Typography.Text strong style={{ fontSize: 14 }}>
                                  {rank === 1 ? '👑 ' : ''}{item.product.name}
                                </Typography.Text>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                  {item.product.sku ? `${item.product.sku} · ` : ''}{formatCount(item.qty)} {unit}
                                </Typography.Text>
                                <Typography.Text strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                                  {formatUZS(item.revenue)}
                                </Typography.Text>
                              </div>
                            </div>
                          );
                        })}
                        {productDayItems.length > PRODUCT_DAY_PAGE_SIZE ? (
                          <Pagination
                            size="small"
                            current={productDayPage}
                            pageSize={PRODUCT_DAY_PAGE_SIZE}
                            total={productDayItems.length}
                            showSizeChanger={false}
                            onChange={(p) => setProductDayPage(p)}
                          />
                        ) : null}
                      </div>
                    </Col>

                    <Col xs={24} lg={10} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    {productDayChartData.length > 0 ? (
                      <Column
                        data={productDayChartData}
                        xField="name"
                        yField="revenue"
                        colorField="fill"
                        height={productDayChartHeight}
                        padding={[4, 12, 4, 12]}
                        legend={false}
                        interaction={{ elementHighlight: true }}
                        scale={{
                          y: {
                            min: 0,
                            max: productDayChartYMax,
                            nice: false,
                            tickCount: productDayChartYMax / 5_000_000 + 1,
                          },
                          color: { type: 'identity' as const },
                        }}
                        axis={{
                          x: {
                            label: false,
                            title: false,
                            tick: false,
                            line: false,
                          },
                          y: {
                            labelFormatter: (v: string | number) => {
                              const n = Number(v);
                              if (!Number.isFinite(n)) return '0';
                              if (n === 0) return '0';
                              return `${Math.round(n / 1_000_000)} млн`;
                            },
                            labelFill: tk.colorTextSecondary,
                            grid: true,
                            gridLineDash: [4, 4],
                            gridStroke: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(51,65,85,0.15)',
                          },
                        }}
                        tooltip={{
                          title: { field: 'name' },
                          items: [
                            (datum: { revenue?: number | string; fill?: string }) => ({
                              color: datum.fill || productDayColors[0],
                              name: '',
                              value: formatUZS(Number(datum.revenue ?? 0)),
                            }),
                          ],
                        }}
                        style={() => ({
                          radius: [10, 10, 0, 0],
                        })}
                        onReady={(plot) => {
                          const scheduleStrip = () => {
                            requestAnimationFrame(() => {
                              requestAnimationFrame(() => stripProductDayTooltipExtraRows());
                            });
                          };
                          plot.on('element:mouseenter', (evt: unknown) => {
                            const id = ((evt as { data?: { data?: { id?: string } } })?.data?.data)?.id;
                            if (id) setActiveProductId(id);
                            scheduleStrip();
                            window.setTimeout(scheduleStrip, 24);
                          });
                          plot.on('element:mouseleave', () => {
                            setActiveProductId(null);
                          });
                          (plot as { on?: (ev: string, fn: () => void) => void }).on?.(
                            'tooltip:show',
                            scheduleStrip,
                          );
                        }}
                      />
                    ) : null}
                    </Col>
                  </Row>
                </>
              )}
            </Card>
          </Col>
        </Row>
        </div>
      )}

      {/* ── Tops ── */}
      {showExtras && (
        <div className={isMobile ? 'section' : undefined}>
        <Row gutter={blockGutter} style={{ marginTop: isMobile ? 0 : 16 }}>
          {[
            {
              title: 'Топ товаров',
              items: topProducts.map((p) => ({ label: p.name, value: formatUZS(p.revenue), href: `/inventory/products/${p.entityId}` })),
            },
            ...(isAdmin ? [
              {
                title: 'Топ менеджеров',
                items: topManagers.map((m) => ({ label: getFirstName(m.fullName), value: formatUZS(m.totalRevenue), href: `/analytics` })),
              },
              {
                title: 'Топ клиентов',
                items: topClients.map((c) => ({
                  label: (
                    <ClientCompanyDisplay
                      client={{ id: c.clientId, companyName: c.companyName, isSvip: c.isSvip }}
                    />
                  ),
                  value: formatUZS(c.totalRevenue),
                  href: `/clients/${c.clientId}`,
                })),
              },
            ] : []),
          ].map((block) => (
            <Col xs={24} md={8} key={block.title}>
              <Card
                bordered={false}
                style={{ ...card, height: '100%' }}
                styles={{ body: { padding: '16px 20px' } }}
                title={<Typography.Text strong style={{ fontSize: 14 }}>{block.title}</Typography.Text>}
              >
                {extLoading ? <Spin size="small" /> : (
                  <div
                    className={isMobile ? 'dashboard-top-list' : undefined}
                    style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? undefined : 2 }}
                  >
                    {block.items.length === 0 && (
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>Нет данных</Typography.Text>
                    )}
                    {block.items.map((row, i) => (
                      <div
                        key={i}
                        className="dash-top-row"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 0',
                          borderBottom: i < block.items.length - 1 ? `1px solid ${tk.colorBorderSecondary}` : undefined,
                          cursor: 'pointer',
                        }}
                        onClick={() => navigate(row.href)}
                      >
                        <span className="dash-top-rank" style={{
                          width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 600, flexShrink: 0,
                          background: i === 0 ? (isDark ? '#177ddc22' : '#e6f4ff') : tk.colorFillQuaternary,
                          color: i === 0 ? tk.colorPrimary : tk.colorTextSecondary,
                        }}>
                          {i + 1}
                        </span>
                        <div className="dash-top-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', fontSize: 13 }}>
                          {row.label}
                        </div>
                        <Typography.Text strong style={{ fontSize: 13, flexShrink: 0 }}>{row.value}</Typography.Text>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Col>
          ))}
        </Row>
        </div>
      )}

      {/* ── Stock issues ── */}
      <div className={isMobile ? 'section' : undefined}>
      <Card
        bordered={false}
        style={{ ...card, marginTop: isMobile ? 0 : 16 }}
        styles={{ body: { padding: '16px 20px' } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Typography.Text strong style={{ fontSize: 14 }}>Проблемные остатки</Typography.Text>
            {allStockIssues.length > 0 && (
              <Badge count={allStockIssues.length} style={{ backgroundColor: tk.colorError }} />
            )}
          </div>
        }
        extra={stockHidden > 0 ? (
          <Link to="/inventory/warehouse">Показать все {allStockIssues.length}</Link>
        ) : undefined}
      >
        {allStockIssues.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            <CheckCircleOutlined style={{ color: tk.colorSuccess, marginRight: 6 }} />
            Все товары в достаточном количестве
          </Typography.Text>
        ) : isMobile ? (
          <div className="dashboard-stock-mobile" style={{ display: 'flex', flexDirection: 'column' }}>
            {stockPreview.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                  borderLeft: `3px solid ${item.issue === 'zero' ? tk.colorError : tk.colorWarning}`,
                  background: tk.colorFillQuaternary,
                }}
                onClick={() => navigate(`/inventory/products/${item.id}`)}
              >
                <div>
                  <Typography.Text strong style={{ fontSize: 13 }}>{item.name}</Typography.Text>
                  <div><Tag style={{ marginTop: 2 }}>{item.sku}</Tag></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ color: item.issue === 'zero' ? tk.colorError : tk.colorWarning, fontWeight: 700 }}>{item.stock}</span>
                  <div style={{ fontSize: 11, color: tk.colorTextSecondary }}>мин: {item.minStock}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table
            dataSource={stockPreview}
            rowKey="id"
            pagination={false}
            size="small"
            bordered={false}
            onRow={(r) => ({ onClick: () => navigate(`/inventory/products/${r.id}`), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Товар', dataIndex: 'name', ellipsis: true },
              { title: 'Артикул', dataIndex: 'sku', width: 120, render: (v: string) => <Tag>{v}</Tag> },
              {
                title: 'Остаток', dataIndex: 'stock', width: 90, align: 'right' as const,
                render: (v: number, r) => (
                  <span style={{ color: r.issue === 'zero' ? tk.colorError : tk.colorWarning, fontWeight: 600 }}>{v}</span>
                ),
              },
              { title: 'Мин.', dataIndex: 'minStock', width: 70, align: 'right' as const },
            ]}
          />
        )}
      </Card>
      </div>
    </div>
  );
}
