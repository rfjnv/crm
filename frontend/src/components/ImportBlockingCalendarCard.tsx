import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Calendar,
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

function monthRange(value: Dayjs) {
  return {
    from: value.startOf('month').startOf('week'),
    to: value.endOf('month').endOf('week'),
  };
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
  const [panelValue, setPanelValue] = useState(() => dayjs().startOf('month'));
  const [selectedDate, setSelectedDate] = useState(() => dayjs().startOf('day'));
  const [selectedCountryCode, setSelectedCountryCode] = useState<VedCountryCode | null>(null);
  const [selectedColorKey, setSelectedColorKey] = useState<CalendarColorKey | null>(null);
  const [manualEvents, setManualEvents] = useState<ManualCalendarEvent[]>(() => loadManualEvents());
  const [apiOverrides, setApiOverrides] = useState<ApiEventOverride[]>(() => loadApiOverrides());
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  const [form] = Form.useForm<ManualEventFormValues>();

  const visibleRange = useMemo(() => monthRange(panelValue), [panelValue]);

  const { data, isLoading } = useQuery({
    queryKey: [
      'foreign-trade-blocking-events',
      visibleRange.from.format('YYYY-MM-DD'),
      visibleRange.to.format('YYYY-MM-DD'),
    ],
    queryFn: () => foreignTradeApi.getBlockingEvents({
      from: visibleRange.from.format('YYYY-MM-DD'),
      to: visibleRange.to.format('YYYY-MM-DD'),
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
    () => [...officialEvents, ...expandedManualEvents],
    [officialEvents, expandedManualEvents],
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
          <Typography.Text strong>Календарь блокирующих дней ВЭД</Typography.Text>
          <Tag color="red">Красные дни: праздники / нерабочие дни</Tag>
        </Space>
      )}
      extra={(
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreateModal}>
          Добавить событие
        </Button>
      )}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        Календарь показывает официальные праздники для Китая, Турции, Грузии, России, Казахстана,
        Ирана, Кыргызстана и Туркменистана. Любое событие можно фильтровать по странам и цветам,
        а API-праздники теперь редактируются через локальные override-настройки поверх справочника.
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
            <Calendar
              fullscreen={false}
              value={selectedDate}
              onSelect={(value) => setSelectedDate(value.startOf('day'))}
              onPanelChange={(value) => {
                setPanelValue(value.startOf('month'));
                setSelectedDate(value.startOf('month'));
              }}
              dateFullCellRender={(value) => {
                const dayEvents = eventsByDate.get(value.format('YYYY-MM-DD')) ?? [];
                const dayCountryCodes = getUniqueCountryCodes(dayEvents);
                const accentColorKey = dayEvents[0]?.colorKey ?? 'holiday';
                const accentColor = COLOR_META[accentColorKey];
                const isSelected = value.isSame(selectedDate, 'day');
                const isCurrentMonth = value.month() === panelValue.month();
                const hasGeneralEvent = dayEvents.some((event) => event.countryCode === null);

                return (
                  <div
                    style={{
                      minHeight: 76,
                      padding: 6,
                      borderRadius: 12,
                      border: `1px solid ${
                        isSelected ? token.colorPrimary : dayEvents.length ? accentColor.cellBorder : 'transparent'
                      }`,
                      background: dayEvents.length
                        ? (isSelected ? token.colorPrimaryBg : accentColor.cellBg)
                        : isSelected
                        ? token.colorPrimaryBg
                        : 'transparent',
                      opacity: isCurrentMonth ? 1 : 0.52,
                      transition: 'all 120ms ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <Typography.Text
                        strong={isSelected}
                        style={{ color: dayEvents.length ? accentColor.cellBorder : undefined }}
                      >
                        {value.date()}
                      </Typography.Text>
                      {dayEvents.length > 0 ? (
                        <Badge
                          count={dayEvents.length}
                          size="small"
                          style={{ backgroundColor: accentColor.cellBorder }}
                        />
                      ) : null}
                    </div>

                    {dayCountryCodes.length > 0 || hasGeneralEvent ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {dayCountryCodes.slice(0, 2).map((countryCode) => {
                          const tagEvent = dayEvents.find((event) => event.countryCode === countryCode);
                          return (
                            <Tag
                              key={countryCode}
                              color={COLOR_META[tagEvent?.colorKey ?? 'holiday'].tagColor}
                              style={{ marginInlineEnd: 0 }}
                            >
                              {countryCode}
                            </Tag>
                          );
                        })}
                        {dayCountryCodes.length === 0 && hasGeneralEvent ? (
                          <Tag
                            color={COLOR_META[dayEvents.find((event) => event.countryCode === null)?.colorKey ?? 'holiday'].tagColor}
                            style={{ marginInlineEnd: 0 }}
                          >
                            EVT
                          </Tag>
                        ) : null}
                        {dayCountryCodes.length > 2 ? (
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            +{dayCountryCodes.length - 2}
                          </Typography.Text>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              }}
            />
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
                  Заказы под риском в этом месяце
                </Typography.Text>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  {riskOrders.length > 0
                    ? `Найдено ${riskOrders.length} заказ(ов), где ETD или ETA попадает на блокирующий день.`
                    : 'В текущем месяце совпадений по ETD/ETA нет.'}
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
