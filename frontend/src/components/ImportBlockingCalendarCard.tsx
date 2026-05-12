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
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
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

const STORAGE_KEY = 'crm-ved-manual-calendar-events-v1';

type CalendarColorKey = 'holiday' | 'rose' | 'orange' | 'blue' | 'green' | 'violet';
type ManualColorKey = Exclude<CalendarColorKey, 'holiday'>;

type CalendarEventItem = {
  id: string;
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
};

type ManualCalendarEvent = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  note: string | null;
  countryCode: VedCountryCode | null;
  colorKey: ManualColorKey;
  isBlocking: boolean;
  createdAt: string;
};

type ManualEventFormValues = {
  title: string;
  dateRange: [Dayjs, Dayjs];
  note?: string;
  countryCode?: VedCountryCode;
  colorKey: ManualColorKey;
  isBlocking?: boolean;
};

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

const MANUAL_COLOR_OPTIONS: ManualColorKey[] = ['rose', 'orange', 'blue', 'green', 'violet'];
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
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
    if (current) {
      current.push(event);
    } else {
      byDate.set(event.date, [event]);
    }
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

function expandOfficialEvents(events: BlockingHolidayEvent[]): CalendarEventItem[] {
  return events.flatMap((event) => (
    enumerateDates(event.startDate, event.endDate).map((date) => ({
      id: `${event.id}:${date}`,
      name: event.name,
      countryCode: event.countryCode,
      countryLabel: event.countryLabel,
      isPrimaryCountry: event.isPrimaryCountry,
      date,
      startDate: event.startDate,
      endDate: event.endDate,
      note: event.note,
      source: 'date-holidays' as const,
      colorKey: 'holiday' as const,
      isBlocking: true,
    }))
  ));
}

function expandManualEvents(
  events: ManualCalendarEvent[],
  countryLabelMap: Map<VedCountryCode, string>,
): CalendarEventItem[] {
  return events.flatMap((event) => (
    enumerateDates(event.startDate, event.endDate).map((date) => ({
      id: `${event.id}:${date}`,
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingManualEventId, setEditingManualEventId] = useState<string | null>(null);
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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(manualEvents));
    } catch {
      /* ignore localStorage quota */
    }
  }, [manualEvents]);

  const countryLabelMap = useMemo(() => (
    new Map((data?.countries ?? []).map((country) => [country.code, country.label]))
  ), [data?.countries]);

  const officialEvents = useMemo(() => expandOfficialEvents(data?.items ?? []), [data?.items]);
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

  const riskOrders = useMemo<RiskOrderHit[]>(() => {
    return orders
      .map((order) => {
        const countryCode = normalizeVedCountry(order.supplier.country);
        if (selectedCountryCode && countryCode !== selectedCountryCode) {
          return { order, etdHits: [], etaHits: [] };
        }

        const etdHits = getBlockingHitsForOrderDate(order.etd, blockingEventsByDate, countryCode);
        const etaHits = getBlockingHitsForOrderDate(order.eta, blockingEventsByDate, countryCode);
        return { order, etdHits, etaHits };
      })
      .filter((row) => row.etdHits.length > 0 || row.etaHits.length > 0);
  }, [orders, blockingEventsByDate, selectedCountryCode]);

  const selectedDayRiskOrders = useMemo(() => (
    riskOrders.filter((row) => (
      row.etdHits.some((hit) => hit.date === selectedDateKey)
      || row.etaHits.some((hit) => hit.date === selectedDateKey)
    ))
  ), [riskOrders, selectedDateKey]);

  function openCreateModal() {
    form.setFieldsValue({
      title: '',
      dateRange: [selectedDate, selectedDate],
      note: '',
      countryCode: selectedCountryCode ?? undefined,
      colorKey: 'blue',
      isBlocking: false,
    });
    setEditingManualEventId(null);
    setIsCreateOpen(true);
  }

  function openEditModal(eventId: string) {
    const event = manualEvents.find((item) => item.id === eventId);
    if (!event) return;

    form.setFieldsValue({
      title: event.title,
      dateRange: [dayjs(event.startDate), dayjs(event.endDate)],
      note: event.note ?? '',
      countryCode: event.countryCode ?? undefined,
      colorKey: event.colorKey,
      isBlocking: event.isBlocking,
    });
    setEditingManualEventId(eventId);
    setIsCreateOpen(true);
  }

  function handleSubmit() {
    form.validateFields().then((values) => {
      const existingEvent = editingManualEventId
        ? manualEvents.find((item) => item.id === editingManualEventId) ?? null
        : null;
      const nextEvent: ManualCalendarEvent = existingEvent
        ? {
            ...existingEvent,
            title: values.title.trim(),
            startDate: values.dateRange[0].format('YYYY-MM-DD'),
            endDate: values.dateRange[1].format('YYYY-MM-DD'),
            note: values.note?.trim() || null,
            countryCode: values.countryCode ?? null,
            colorKey: values.colorKey,
            isBlocking: Boolean(values.isBlocking),
          }
        : {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: values.title.trim(),
            startDate: values.dateRange[0].format('YYYY-MM-DD'),
            endDate: values.dateRange[1].format('YYYY-MM-DD'),
            note: values.note?.trim() || null,
            countryCode: values.countryCode ?? null,
            colorKey: values.colorKey,
            isBlocking: Boolean(values.isBlocking),
            createdAt: new Date().toISOString(),
          };

      setManualEvents((prev) => {
        const base = existingEvent
          ? prev.map((item) => (item.id === editingManualEventId ? nextEvent : item))
          : [...prev, nextEvent];
        return base.sort((a, b) => (
          a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'ru')
        ));
      });
      setSelectedDate(values.dateRange[0].startOf('day'));
      setIsCreateOpen(false);
      setEditingManualEventId(null);
      message.success(existingEvent ? 'Событие обновлено' : 'Событие добавлено');
    });
  }

  function removeManualEvent(eventId: string) {
    setManualEvents((prev) => prev.filter((event) => event.id !== eventId));
    if (editingManualEventId === eventId) {
      setEditingManualEventId(null);
      setIsCreateOpen(false);
    }
    message.success('Событие удалено');
  }

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
        Ирана, Кыргызстана и Туркменистана. Ниже можно добавлять свои события: встречи, дедлайны,
        напоминания и собственные блокирующие окна.
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
                        actions={item.source === 'manual' ? [
                          <Button
                            key="edit"
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEditModal(item.id.split(':')[0])}
                          />,
                          <Popconfirm
                            key="delete"
                            title="Удалить это событие?"
                            onConfirm={() => removeManualEvent(item.id.split(':')[0])}
                          >
                            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>,
                        ] : undefined}
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
        title={editingManualEventId ? 'Редактировать событие' : 'Добавить своё событие'}
        open={isCreateOpen}
        onCancel={() => {
          setIsCreateOpen(false);
          setEditingManualEventId(null);
        }}
        onOk={handleSubmit}
        okText={editingManualEventId ? 'Сохранить изменения' : 'Сохранить'}
        width={560}
        destroyOnClose
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
              options={MANUAL_COLOR_OPTIONS.map((colorKey) => ({
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
