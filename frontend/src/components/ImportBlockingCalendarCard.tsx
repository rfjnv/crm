import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
  message,
  theme,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { foreignTradeApi } from '../api/foreign-trade.api';
import type {
  BlockingHolidayEvent,
  ImportOrderListItem,
  SupportedVedCountry,
  VedCountryCode,
} from '../types';
import { normalizeVedCountry } from '../utils/vedBlockingCalendar';

const MANUAL_STORAGE_KEY = 'crm-ved-manual-calendar-events-v1';
const API_OVERRIDE_STORAGE_KEY = 'crm-ved-api-event-overrides-v1';

type CalendarColorKey = 'holiday' | 'rose' | 'orange' | 'blue' | 'green' | 'violet';

type CalendarEventItem = {
  id: string;
  sourceEventId: string;
  name: string;
  countryCode: VedCountryCode | null;
  countryLabel: string | null;
  isPrimaryCountry: boolean;
  date: string;
  startDate: string;
  endDate: string;
  note: string | null;
  source: 'date-holidays' | 'manual';
  colorKey: CalendarColorKey;
  isBlocking: boolean;
  hasOverride: boolean;
};

type ManualCalendarEvent = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  note: string | null;
  countryCode: VedCountryCode | null;
  colorKey: CalendarColorKey;
  isBlocking: boolean;
  createdAt: string;
};

type ApiEventOverride = {
  sourceEventId: string;
  title: string;
  startDate: string;
  endDate: string;
  note: string | null;
  colorKey: CalendarColorKey;
  isBlocking: boolean;
  updatedAt: string;
};

type ManualEventFormValues = {
  title: string;
  dateRange: [Dayjs, Dayjs];
  note?: string;
  countryCode?: VedCountryCode;
  colorKey: CalendarColorKey;
  isBlocking?: boolean;
};

type EditingTarget =
  | { source: 'manual'; sourceEventId: string }
  | { source: 'date-holidays'; sourceEventId: string }
  | null;

type RiskOrderHit = {
  order: ImportOrderListItem;
  etdHits: CalendarEventItem[];
  etaHits: CalendarEventItem[];
};

const COLOR_META: Record<CalendarColorKey, {
  label: string;
  tagColor: string;
  cellBg: string;
  cellBorder: string;
}> = {
  holiday: {
    label: 'Праздники',
    tagColor: 'red',
    cellBg: 'rgba(255, 77, 79, 0.10)',
    cellBorder: '#ff7875',
  },
  rose: {
    label: 'Розовый',
    tagColor: 'magenta',
    cellBg: 'rgba(235, 47, 150, 0.12)',
    cellBorder: '#eb2f96',
  },
  orange: {
    label: 'Оранжевый',
    tagColor: 'orange',
    cellBg: 'rgba(250, 140, 22, 0.12)',
    cellBorder: '#fa8c16',
  },
  blue: {
    label: 'Синий',
    tagColor: 'blue',
    cellBg: 'rgba(22, 119, 255, 0.12)',
    cellBorder: '#1677ff',
  },
  green: {
    label: 'Зелёный',
    tagColor: 'green',
    cellBg: 'rgba(82, 196, 26, 0.12)',
    cellBorder: '#52c41a',
  },
  violet: {
    label: 'Фиолетовый',
    tagColor: 'purple',
    cellBg: 'rgba(114, 46, 209, 0.12)',
    cellBorder: '#722ed1',
  },
};

const COLOR_FILTER_ORDER: CalendarColorKey[] = ['holiday', 'rose', 'orange', 'blue', 'green', 'violet'];
const MONTH_LABELS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;
const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

function monthRange(value: Dayjs) {
  return {
    from: value.startOf('year'),
    to: value.endOf('year'),
  };
}

function buildMonthGrid(month: Dayjs): Dayjs[] {
  const firstDay = month.startOf('month');
  const offset = (firstDay.day() + 6) % 7;
  const gridStart = firstDay.subtract(offset, 'day');
  return Array.from({ length: 42 }, (_, index) => gridStart.add(index, 'day'));
}

function loadManualEvents(): ManualCalendarEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MANUAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ManualCalendarEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => (
      typeof item?.id === 'string'
      && typeof item?.title === 'string'
      && typeof item?.startDate === 'string'
      && typeof item?.endDate === 'string'
      && typeof item?.colorKey === 'string'
    ));
  } catch {
    return [];
  }
}

function loadApiOverrides(): ApiEventOverride[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(API_OVERRIDE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ApiEventOverride[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => (
      typeof item?.sourceEventId === 'string'
      && typeof item?.title === 'string'
      && typeof item?.startDate === 'string'
      && typeof item?.endDate === 'string'
      && typeof item?.colorKey === 'string'
    ));
  } catch {
    return [];
  }
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = dayjs(startDate).startOf('day');
  const end = dayjs(endDate).startOf('day');
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    dates.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
  }
  return dates;
}

function groupEventsByDate(events: CalendarEventItem[]): Map<string, CalendarEventItem[]> {
  const byDate = new Map<string, CalendarEventItem[]>();
  for (const event of events) {
    const current = byDate.get(event.date);
    if (current) current.push(event);
    else byDate.set(event.date, [event]);
  }
  return byDate;
}

function getUniqueCountryCodes(events: CalendarEventItem[]): VedCountryCode[] {
  return [...new Set(events
    .map((event) => event.countryCode)
    .filter((countryCode): countryCode is VedCountryCode => Boolean(countryCode)))];
}

function getUniqueColorKeys(events: CalendarEventItem[]): CalendarColorKey[] {
  const present = new Set(events.map((event) => event.colorKey));
  return COLOR_FILTER_ORDER.filter((colorKey) => present.has(colorKey));
}

function expandOfficialEvents(
  events: BlockingHolidayEvent[],
  overridesMap: Map<string, ApiEventOverride>,
): CalendarEventItem[] {
  return events.flatMap((event) => {
    const override = overridesMap.get(event.id) ?? null;
    const title = override?.title ?? event.name;
    const startDate = override?.startDate ?? event.startDate;
    const endDate = override?.endDate ?? event.endDate;
    const note = override?.note ?? event.note;
    const colorKey = override?.colorKey ?? 'holiday';
    const isBlocking = override?.isBlocking ?? true;

    return enumerateDates(startDate, endDate).map((date) => ({
      id: `${event.id}:${date}`,
      sourceEventId: event.id,
      name: title,
      countryCode: event.countryCode,
      countryLabel: event.countryLabel,
      isPrimaryCountry: event.isPrimaryCountry,
      date,
      startDate,
      endDate,
      note,
      source: 'date-holidays' as const,
      colorKey,
      isBlocking,
      hasOverride: Boolean(override),
    }));
  });
}

function expandManualEvents(
  events: ManualCalendarEvent[],
  countryLabelMap: Map<VedCountryCode, string>,
): CalendarEventItem[] {
  return events.flatMap((event) => (
    enumerateDates(event.startDate, event.endDate).map((date) => ({
      id: `${event.id}:${date}`,
      sourceEventId: event.id,
      name: event.title,
      countryCode: event.countryCode,
      countryLabel: event.countryCode ? (countryLabelMap.get(event.countryCode) ?? event.countryCode) : null,
      isPrimaryCountry: false,
      date,
      startDate: event.startDate,
      endDate: event.endDate,
      note: event.note,
      source: 'manual' as const,
      colorKey: event.colorKey,
      isBlocking: event.isBlocking,
      hasOverride: false,
    }))
  ));
}

function getBlockingHitsForOrderDate(
  date: string | null | undefined,
  eventsByDate: Map<string, CalendarEventItem[]>,
  countryCode: VedCountryCode | null,
): CalendarEventItem[] {
  if (!date) return [];
  const key = dayjs(date).format('YYYY-MM-DD');
  return (eventsByDate.get(key) ?? []).filter((event) => (
    event.isBlocking && (event.countryCode === null || event.countryCode === countryCode)
  ));
}

export default function ImportBlockingCalendarCard({ orders }: { orders: ImportOrderListItem[] }) {
  const { token } = theme.useToken();
  const [panelValue, setPanelValue] = useState(() => dayjs().startOf('year'));
  const [selectedDate, setSelectedDate] = useState(() => dayjs().startOf('day'));
  const [selectedCountryCode, setSelectedCountryCode] = useState<VedCountryCode | null>(null);
  const [selectedColorKey, setSelectedColorKey] = useState<CalendarColorKey | null>(null);
  const [manualEvents, setManualEvents] = useState<ManualCalendarEvent[]>(() => loadManualEvents());
  const [apiOverrides, setApiOverrides] = useState<ApiEventOverride[]>(() => loadApiOverrides());
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  const [form] = Form.useForm<ManualEventFormValues>();

  const visibleRange = useMemo(() => monthRange(panelValue), [panelValue]);
  const yearMonths = useMemo(
    () => Array.from({ length: 12 }, (_, index) => panelValue.startOf('year').month(index)),
    [panelValue],
  );
  const rangeFrom = visibleRange.from.format('YYYY-MM-DD');
  const rangeTo = visibleRange.to.format('YYYY-MM-DD');

  const { data, isLoading } = useQuery({
    queryKey: [
      'foreign-trade-blocking-events',
      rangeFrom,
      rangeTo,
    ],
    queryFn: () => foreignTradeApi.getBlockingEvents({
      from: rangeFrom,
      to: rangeTo,
    }),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify(manualEvents));
    } catch {
      /* ignore localStorage quota */
    }
  }, [manualEvents]);

  useEffect(() => {
    try {
      window.localStorage.setItem(API_OVERRIDE_STORAGE_KEY, JSON.stringify(apiOverrides));
    } catch {
      /* ignore localStorage quota */
    }
  }, [apiOverrides]);

  const countryLabelMap = useMemo(() => (
    new Map((data?.countries ?? []).map((country) => [country.code, country.label]))
  ), [data?.countries]);

  const overridesMap = useMemo(
    () => new Map(apiOverrides.map((override) => [override.sourceEventId, override])),
    [apiOverrides],
  );

  const officialEvents = useMemo(
    () => expandOfficialEvents(data?.items ?? [], overridesMap),
    [data?.items, overridesMap],
  );
  const expandedManualEvents = useMemo(
    () => expandManualEvents(manualEvents, countryLabelMap),
    [manualEvents, countryLabelMap],
  );
  const allEvents = useMemo(
    () => [...officialEvents, ...expandedManualEvents].filter((event) => (
      event.date >= rangeFrom && event.date <= rangeTo
    )),
    [officialEvents, expandedManualEvents, rangeFrom, rangeTo],
  );

  const monthCountryCodes = useMemo(() => getUniqueCountryCodes(allEvents), [allEvents]);
  const availableColorKeys = useMemo(() => getUniqueColorKeys(allEvents), [allEvents]);
  const visibleCountries = useMemo<SupportedVedCountry[]>(() => {
    const allowed = new Set(monthCountryCodes);
    return (data?.countries ?? []).filter((country) => allowed.has(country.code));
  }, [data?.countries, monthCountryCodes]);

  const events = useMemo(() => (
    allEvents.filter((event) => {
      if (selectedCountryCode && event.countryCode !== selectedCountryCode) return false;
      if (selectedColorKey && event.colorKey !== selectedColorKey) return false;
      return true;
    })
  ), [allEvents, selectedCountryCode, selectedColorKey]);

  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);
  const blockingEventsByDate = useMemo(
    () => groupEventsByDate(events.filter((event) => event.isBlocking)),
    [events],
  );

  const selectedDateKey = selectedDate.format('YYYY-MM-DD');
  const selectedDayEvents = eventsByDate.get(selectedDateKey) ?? [];

  const riskOrders = useMemo<RiskOrderHit[]>(() => (
    orders
      .map((order) => {
        const countryCode = normalizeVedCountry(order.supplier.country);
        if (selectedCountryCode && countryCode !== selectedCountryCode) {
          return { order, etdHits: [], etaHits: [] };
        }

        const etdHits = getBlockingHitsForOrderDate(order.etd, blockingEventsByDate, countryCode);
        const etaHits = getBlockingHitsForOrderDate(order.eta, blockingEventsByDate, countryCode);
        return { order, etdHits, etaHits };
      })
      .filter((row) => row.etdHits.length > 0 || row.etaHits.length > 0)
  ), [orders, blockingEventsByDate, selectedCountryCode]);

  const selectedDayRiskOrders = useMemo(() => (
    riskOrders.filter((row) => (
      row.etdHits.some((hit) => hit.date === selectedDateKey)
      || row.etaHits.some((hit) => hit.date === selectedDateKey)
    ))
  ), [riskOrders, selectedDateKey]);

  const currentOfficialOverride = useMemo(() => (
    editingTarget?.source === 'date-holidays'
      ? apiOverrides.find((override) => override.sourceEventId === editingTarget.sourceEventId) ?? null
      : null
  ), [apiOverrides, editingTarget]);

  function closeModal() {
    setIsCreateOpen(false);
    setEditingTarget(null);
  }

  function openCreateModal() {
    form.setFieldsValue({
      title: '',
      dateRange: [selectedDate, selectedDate],
      note: '',
      countryCode: selectedCountryCode ?? undefined,
      colorKey: 'blue',
      isBlocking: false,
    });
    setEditingTarget(null);
    setIsCreateOpen(true);
  }

  function openEditModal(item: CalendarEventItem) {
    form.setFieldsValue({
      title: item.name,
      dateRange: [dayjs(item.startDate), dayjs(item.endDate)],
      note: item.note ?? '',
      countryCode: item.countryCode ?? undefined,
      colorKey: item.colorKey,
      isBlocking: item.isBlocking,
    });
    setEditingTarget({ source: item.source, sourceEventId: item.sourceEventId });
    setIsCreateOpen(true);
  }

  function handleSubmit() {
    form.validateFields().then((values) => {
      const payload = {
        title: values.title.trim(),
        startDate: values.dateRange[0].format('YYYY-MM-DD'),
        endDate: values.dateRange[1].format('YYYY-MM-DD'),
        note: values.note?.trim() || null,
        countryCode: values.countryCode ?? null,
        colorKey: values.colorKey,
        isBlocking: Boolean(values.isBlocking),
      };

      if (!editingTarget) {
        const nextEvent: ManualCalendarEvent = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ...payload,
          createdAt: new Date().toISOString(),
        };

        setManualEvents((prev) => [...prev, nextEvent].sort((a, b) => (
          a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'ru')
        )));
        setSelectedDate(values.dateRange[0].startOf('day'));
        closeModal();
        message.success('Событие добавлено');
        return;
      }

      if (editingTarget.source === 'manual') {
        const existingEvent = manualEvents.find((item) => item.id === editingTarget.sourceEventId) ?? null;
        const nextEvent: ManualCalendarEvent = existingEvent
          ? {
              ...existingEvent,
              ...payload,
            }
          : {
              id: editingTarget.sourceEventId,
              ...payload,
              createdAt: new Date().toISOString(),
            };

        setManualEvents((prev) => {
          const exists = prev.some((item) => item.id === editingTarget.sourceEventId);
          const base = exists
            ? prev.map((item) => (item.id === editingTarget.sourceEventId ? nextEvent : item))
            : [...prev, nextEvent];
          return base.sort((a, b) => (
            a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'ru')
          ));
        });
        setSelectedDate(values.dateRange[0].startOf('day'));
        closeModal();
        message.success('Событие обновлено');
        return;
      }

      const nextOverride: ApiEventOverride = {
        sourceEventId: editingTarget.sourceEventId,
        title: payload.title,
        startDate: payload.startDate,
        endDate: payload.endDate,
        note: payload.note,
        colorKey: payload.colorKey,
        isBlocking: payload.isBlocking,
        updatedAt: new Date().toISOString(),
      };

      setApiOverrides((prev) => {
        const exists = prev.some((item) => item.sourceEventId === editingTarget.sourceEventId);
        return exists
          ? prev.map((item) => (item.sourceEventId === editingTarget.sourceEventId ? nextOverride : item))
          : [...prev, nextOverride];
      });
      setSelectedDate(values.dateRange[0].startOf('day'));
      closeModal();
      message.success('Правки для API-события сохранены');
    });
  }

  function removeManualEvent(sourceEventId: string) {
    setManualEvents((prev) => prev.filter((event) => event.id !== sourceEventId));
    if (editingTarget?.source === 'manual' && editingTarget.sourceEventId === sourceEventId) {
      closeModal();
    }
    message.success('Событие удалено');
  }

  function resetOfficialOverride(sourceEventId: string) {
    setApiOverrides((prev) => prev.filter((override) => override.sourceEventId !== sourceEventId));
    if (editingTarget?.source === 'date-holidays' && editingTarget.sourceEventId === sourceEventId) {
      closeModal();
    }
    message.success('Правки API-события сброшены');
  }

  const modalTitle = !editingTarget
    ? 'Добавить своё событие'
    : editingTarget.source === 'manual'
    ? 'Редактировать событие'
    : 'Редактировать API-событие';

  const modalOkText = !editingTarget
    ? 'Сохранить'
    : editingTarget.source === 'manual'
    ? 'Сохранить изменения'
    : 'Сохранить override';

  return (
    <Card
      style={{ marginBottom: 16 }}
      title={(
        <Space wrap size={[8, 8]}>
          <Typography.Text strong>Годовой календарь ВЭД</Typography.Text>
          <Tag color="red">Красные дни: праздники / нерабочие дни</Tag>
        </Space>
      )}
      extra={(
        <Space wrap size={[8, 8]}>
          <DatePicker
            picker="year"
            allowClear={false}
            value={panelValue}
            format="YYYY"
            onChange={(value) => {
              if (!value) return;
              setPanelValue(value.startOf('year'));
              if (selectedDate.year() !== value.year()) {
                setSelectedDate(value.startOf('year'));
              }
            }}
          />
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreateModal}>
            Добавить событие
          </Button>
        </Space>
      )}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        На странице импортных заказов календарь теперь показывает весь выбранный год: 12 месяцев,
        официальные праздники по странам, ручные события и локальные override-правки для API-праздников.
      </Typography.Paragraph>

      <Space wrap size={[6, 6]} style={{ marginBottom: 10 }}>
        <Tag
          color={selectedCountryCode === null ? 'blue' : 'default'}
          style={{ cursor: 'pointer', userSelect: 'none', marginInlineEnd: 0 }}
          onClick={() => setSelectedCountryCode(null)}
        >
          Все страны
        </Tag>
        {visibleCountries.map((country) => {
          const active = selectedCountryCode === country.code;
          const color = active
            ? 'blue'
            : country.code === 'CN' || country.code === 'TR'
            ? 'volcano'
            : 'default';

          return (
            <Tag
              key={country.code}
              color={color}
              style={{ cursor: 'pointer', userSelect: 'none', marginInlineEnd: 0 }}
              onClick={() => setSelectedCountryCode((current) => (
                current === country.code ? null : country.code
              ))}
            >
              {country.label}
            </Tag>
          );
        })}
      </Space>

      <Space wrap size={[6, 6]} style={{ marginBottom: 14 }}>
        <Tag
          color={selectedColorKey === null ? 'blue' : 'default'}
          style={{ cursor: 'pointer', userSelect: 'none', marginInlineEnd: 0 }}
          onClick={() => setSelectedColorKey(null)}
        >
          Все цвета
        </Tag>
        {availableColorKeys.map((colorKey) => (
          <Tag
            key={colorKey}
            color={selectedColorKey === colorKey ? 'blue' : COLOR_META[colorKey].tagColor}
            style={{ cursor: 'pointer', userSelect: 'none', marginInlineEnd: 0 }}
            onClick={() => setSelectedColorKey((current) => (
              current === colorKey ? null : colorKey
            ))}
          >
            {COLOR_META[colorKey].label}
          </Tag>
        ))}
      </Space>

      {(selectedCountryCode || selectedColorKey) ? (
        <Typography.Paragraph style={{ marginTop: -4, marginBottom: 12 }}>
          <Typography.Text strong>
            Фильтр:
            {' '}
            {selectedCountryCode
              ? (countryLabelMap.get(selectedCountryCode) ?? selectedCountryCode)
              : 'все страны'}
            {' · '}
            {selectedColorKey ? COLOR_META[selectedColorKey].label : 'все цвета'}
          </Typography.Text>
        </Typography.Paragraph>
      ) : null}

      {isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 12,
              }}
            >
              {yearMonths.map((month) => {
                const monthCells = buildMonthGrid(month);
                return (
                  <div
                    key={month.format('YYYY-MM')}
                    style={{
                      borderRadius: 14,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      padding: 10,
                      background: token.colorBgContainer,
                    }}
                  >
                    <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                      {MONTH_LABELS[month.month()]}
                      {' '}
                      {month.format('YYYY')}
                    </Typography.Text>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                        gap: 4,
                        marginBottom: 6,
                      }}
                    >
                      {WEEKDAY_LABELS.map((label) => (
                        <Typography.Text
                          key={label}
                          type="secondary"
                          style={{ fontSize: 11, textAlign: 'center' }}
                        >
                          {label}
                        </Typography.Text>
                      ))}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                        gap: 4,
                      }}
                    >
                      {monthCells.map((value) => {
                        const dayEvents = eventsByDate.get(value.format('YYYY-MM-DD')) ?? [];
                        const dayCountryCodes = getUniqueCountryCodes(dayEvents);
                        const accentColorKey = dayEvents[0]?.colorKey ?? 'holiday';
                        const accentColor = COLOR_META[accentColorKey];
                        const isSelected = value.isSame(selectedDate, 'day');
                        const isCurrentMonth = value.month() === month.month();
                        const hasGeneralEvent = dayEvents.some((event) => event.countryCode === null);

                        return (
                          <button
                            key={value.format('YYYY-MM-DD')}
                            type="button"
                            onClick={() => {
                              if (value.year() !== panelValue.year()) return;
                              setSelectedDate(value.startOf('day'));
                            }}
                            style={{
                              minHeight: 52,
                              padding: '6px 4px',
                              borderRadius: 10,
                              border: `1px solid ${
                                isSelected ? token.colorPrimary : dayEvents.length ? accentColor.cellBorder : token.colorBorderSecondary
                              }`,
                              background: dayEvents.length
                                ? (isSelected ? token.colorPrimaryBg : accentColor.cellBg)
                                : isSelected
                                ? token.colorPrimaryBg
                                : 'transparent',
                              opacity: isCurrentMonth ? 1 : 0.45,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: isSelected ? 700 : 500,
                                  color: dayEvents.length ? accentColor.cellBorder : token.colorText,
                                }}
                              >
                                {value.date()}
                              </span>
                              {dayEvents.length > 0 ? (
                                <span
                                  style={{
                                    minWidth: 16,
                                    height: 16,
                                    borderRadius: 999,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 10,
                                    color: '#fff',
                                    background: accentColor.cellBorder,
                                  }}
                                >
                                  {dayEvents.length}
                                </span>
                              ) : null}
                            </div>

                            {dayCountryCodes.length > 0 || hasGeneralEvent ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 4 }}>
                                {dayCountryCodes.slice(0, 2).map((countryCode) => {
                                  const tagEvent = dayEvents.find((event) => event.countryCode === countryCode);
                                  return (
                                    <span
                                      key={countryCode}
                                      style={{
                                        fontSize: 9,
                                        lineHeight: '12px',
                                        padding: '1px 4px',
                                        borderRadius: 999,
                                        color: '#fff',
                                        background: COLOR_META[tagEvent?.colorKey ?? 'holiday'].cellBorder,
                                      }}
                                    >
                                      {countryCode}
                                    </span>
                                  );
                                })}
                                {dayCountryCodes.length === 0 && hasGeneralEvent ? (
                                  <span
                                    style={{
                                      fontSize: 9,
                                      lineHeight: '12px',
                                      padding: '1px 4px',
                                      borderRadius: 999,
                                      color: '#fff',
                                      background: COLOR_META[dayEvents.find((event) => event.countryCode === null)?.colorKey ?? 'holiday'].cellBorder,
                                    }}
                                  >
                                    EVT
                                  </span>
                                ) : null}
                                {dayCountryCodes.length > 2 ? (
                                  <span style={{ fontSize: 9, color: token.colorTextSecondary }}>
                                    +{dayCountryCodes.length - 2}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Col>

          <Col xs={24} xl={8}>
            <div
              style={{
                display: 'grid',
                gap: 12,
                padding: 16,
                borderRadius: 16,
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  Выбранная дата
                </Typography.Text>
                <Typography.Text strong style={{ fontSize: 18 }}>
                  {selectedDate.format('DD.MM.YYYY')}
                </Typography.Text>
              </div>

              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                  События дня
                </Typography.Text>
                {selectedDayEvents.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="На этот день событий нет"
                  />
                ) : (
                  <List
                    size="small"
                    dataSource={selectedDayEvents}
                    renderItem={(item) => (
                      <List.Item
                        style={{ paddingInline: 0 }}
                        actions={item.source === 'manual'
                          ? [
                              <Button
                                key="edit"
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => openEditModal(item)}
                              />,
                              <Popconfirm
                                key="delete"
                                title="Удалить это событие?"
                                onConfirm={() => removeManualEvent(item.sourceEventId)}
                              >
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>,
                            ]
                          : [
                              <Button
                                key="edit"
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => openEditModal(item)}
                              />,
                              ...(item.hasOverride
                                ? [
                                    <Popconfirm
                                      key="reset"
                                      title="Сбросить правки и вернуть данные из API?"
                                      onConfirm={() => resetOfficialOverride(item.sourceEventId)}
                                    >
                                      <Button type="text" size="small" icon={<UndoOutlined />} />
                                    </Popconfirm>,
                                  ]
                                : []),
                            ]}
                      >
                        <Space direction="vertical" size={2}>
                          <Space wrap size={[6, 6]}>
                            <Tag color={COLOR_META[item.colorKey].tagColor}>
                              {COLOR_META[item.colorKey].label}
                            </Tag>
                            {item.countryLabel ? (
                              <Tag color={item.isPrimaryCountry ? 'volcano' : 'default'}>
                                {item.countryLabel}
                              </Tag>
                            ) : (
                              <Tag>Общее</Tag>
                            )}
                            {item.source === 'date-holidays' ? <Tag>API</Tag> : <Tag color="blue">Свое</Tag>}
                            {item.hasOverride ? <Tag color="gold">Override</Tag> : null}
                            {item.isBlocking ? <Tag color="red">Блок</Tag> : null}
                            <Typography.Text strong>{item.name}</Typography.Text>
                          </Space>
                          {item.note ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {item.note}
                            </Typography.Text>
                          ) : null}
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </div>

              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                  Заказы под риском в этом году
                </Typography.Text>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  {riskOrders.length > 0
                    ? `Найдено ${riskOrders.length} заказ(ов), где ETD или ETA попадает на блокирующий день.`
                    : 'В текущем году совпадений по ETD/ETA нет.'}
                </Typography.Text>
                {selectedDayRiskOrders.length > 0 ? (
                  <List
                    size="small"
                    dataSource={selectedDayRiskOrders.slice(0, 6)}
                    renderItem={(row) => (
                      <List.Item style={{ paddingInline: 0 }}>
                        <Space direction="vertical" size={2}>
                          <Link to={`/foreign-trade/import-orders/${row.order.id}`} style={{ fontWeight: 600 }}>
                            {row.order.number}
                          </Link>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {row.order.supplier.companyName}
                          </Typography.Text>
                          <Space wrap size={[6, 6]}>
                            {row.etdHits.some((hit) => hit.date === selectedDateKey) ? (
                              <Tag color="volcano">ETD</Tag>
                            ) : null}
                            {row.etaHits.some((hit) => hit.date === selectedDateKey) ? (
                              <Tag color="magenta">ETA</Tag>
                            ) : null}
                          </Space>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="На выбранную дату заказов под риском нет"
                  />
                )}
              </div>
            </div>
          </Col>
        </Row>
      )}

      <Modal
        title={modalTitle}
        open={isCreateOpen}
        onCancel={closeModal}
        onOk={handleSubmit}
        okText={modalOkText}
        width={560}
        destroyOnClose
        footer={[
          <Button key="cancel" onClick={closeModal}>
            Отмена
          </Button>,
          ...(editingTarget?.source === 'date-holidays' && currentOfficialOverride
            ? [
                <Popconfirm
                  key="reset"
                  title="Сбросить все локальные правки и вернуть данные из API?"
                  onConfirm={() => resetOfficialOverride(editingTarget.sourceEventId)}
                >
                  <Button icon={<UndoOutlined />}>Сбросить к API</Button>
                </Popconfirm>,
              ]
            : []),
          <Button key="save" type="primary" onClick={handleSubmit}>
            {modalOkText}
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label="Название"
            rules={[{ required: true, message: 'Введите название события' }]}
          >
            <Input placeholder="Например, встреча с поставщиком / дедлайн / личная заметка" />
          </Form.Item>

          <Form.Item
            name="dateRange"
            label="Период"
            rules={[{ required: true, message: 'Выберите дату или диапазон дат' }]}
          >
            <DatePicker.RangePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>

          <Form.Item name="countryCode" label="Страна (необязательно)">
            <Select
              allowClear
              disabled={editingTarget?.source === 'date-holidays'}
              placeholder="Общее событие без привязки к стране"
              options={(data?.countries ?? []).map((country) => ({
                value: country.code,
                label: country.label,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="colorKey"
            label="Цвет"
            rules={[{ required: true, message: 'Выберите цвет' }]}
          >
            <Select
              options={COLOR_FILTER_ORDER.map((colorKey) => ({
                value: colorKey,
                label: COLOR_META[colorKey].label,
              }))}
            />
          </Form.Item>

          <Form.Item name="note" label="Комментарий">
            <Input.TextArea rows={3} placeholder="Любая дополнительная информация" />
          </Form.Item>

          <Form.Item name="isBlocking" valuePropName="checked">
            <Checkbox>Это блокирующее событие и должно влиять на риск ETD / ETA</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
