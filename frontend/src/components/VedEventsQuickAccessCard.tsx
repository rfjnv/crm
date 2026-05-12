import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Empty, List, Space, Tag, Typography, theme } from 'antd';
import { CalendarOutlined, RightOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { foreignTradeApi } from '../api/foreign-trade.api';
import type { BlockingHolidayEvent, VedCountryCode } from '../types';

const MANUAL_STORAGE_KEY = 'crm-ved-manual-calendar-events-v1';
const API_OVERRIDE_STORAGE_KEY = 'crm-ved-api-event-overrides-v1';

type CalendarColorKey = 'holiday' | 'rose' | 'orange' | 'blue' | 'green' | 'violet';

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

type QuickEvent = {
  id: string;
  sourceEventId: string;
  date: string;
  startDate: string;
  endDate: string;
  title: string;
  note: string | null;
  source: 'date-holidays' | 'manual';
  colorKey: CalendarColorKey;
  isBlocking: boolean;
  countryCode: VedCountryCode | null;
  countryLabel: string | null;
};

const COLOR_META: Record<CalendarColorKey, { label: string; tagColor: string }> = {
  holiday: { label: 'Праздники', tagColor: 'red' },
  rose: { label: 'Розовый', tagColor: 'magenta' },
  orange: { label: 'Оранжевый', tagColor: 'orange' },
  blue: { label: 'Синий', tagColor: 'blue' },
  green: { label: 'Зелёный', tagColor: 'green' },
  violet: { label: 'Фиолетовый', tagColor: 'purple' },
};

function loadManualEvents(): ManualCalendarEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MANUAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ManualCalendarEvent[];
    return Array.isArray(parsed) ? parsed : [];
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
    return Array.isArray(parsed) ? parsed : [];
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

function expandOfficialEvents(
  events: BlockingHolidayEvent[],
  overrides: Map<string, ApiEventOverride>,
): QuickEvent[] {
  return events.flatMap((event) => {
    const override = overrides.get(event.id) ?? null;
    const title = override?.title ?? event.name;
    const startDate = override?.startDate ?? event.startDate;
    const endDate = override?.endDate ?? event.endDate;
    const note = override?.note ?? event.note;
    const colorKey = override?.colorKey ?? 'holiday';
    const isBlocking = override?.isBlocking ?? true;

    return enumerateDates(startDate, endDate).map((date) => ({
      id: `${event.id}:${date}`,
      sourceEventId: event.id,
      date,
      startDate,
      endDate,
      title,
      note,
      source: 'date-holidays' as const,
      colorKey,
      isBlocking,
      countryCode: event.countryCode,
      countryLabel: event.countryLabel,
    }));
  });
}

function expandManualEvents(
  events: ManualCalendarEvent[],
  countryLabelMap: Map<VedCountryCode, string>,
): QuickEvent[] {
  return events.flatMap((event) => (
    enumerateDates(event.startDate, event.endDate).map((date) => ({
      id: `${event.id}:${date}`,
      sourceEventId: event.id,
      date,
      startDate: event.startDate,
      endDate: event.endDate,
      title: event.title,
      note: event.note,
      source: 'manual' as const,
      colorKey: event.colorKey,
      isBlocking: event.isBlocking,
      countryCode: event.countryCode,
      countryLabel: event.countryCode ? (countryLabelMap.get(event.countryCode) ?? event.countryCode) : null,
    }))
  ));
}

export default function VedEventsQuickAccessCard() {
  const { token } = theme.useToken();
  const [manualEvents] = useState<ManualCalendarEvent[]>(() => loadManualEvents());
  const [apiOverrides] = useState<ApiEventOverride[]>(() => loadApiOverrides());

  const today = dayjs().startOf('day');
  const from = today.format('YYYY-MM-DD');
  const to = today.add(30, 'day').format('YYYY-MM-DD');

  const { data, isLoading } = useQuery({
    queryKey: ['ved-events-quick-access', from, to],
    queryFn: () => foreignTradeApi.getBlockingEvents({ from, to }),
    staleTime: 5 * 60_000,
  });

  const countryLabelMap = useMemo(() => (
    new Map((data?.countries ?? []).map((country) => [country.code, country.label]))
  ), [data?.countries]);

  const overridesMap = useMemo(
    () => new Map(apiOverrides.map((override) => [override.sourceEventId, override])),
    [apiOverrides],
  );

  const allEvents = useMemo(() => {
    const official = expandOfficialEvents(data?.items ?? [], overridesMap);
    const manual = expandManualEvents(manualEvents, countryLabelMap);
    return [...official, ...manual]
      .filter((event) => event.date >= from)
      .sort((a, b) => (
        a.date.localeCompare(b.date)
        || Number(b.isBlocking) - Number(a.isBlocking)
        || a.title.localeCompare(b.title, 'ru')
      ));
  }, [countryLabelMap, data?.items, from, manualEvents, overridesMap]);

  const upcomingEvents = useMemo(() => allEvents.slice(0, 5), [allEvents]);
  const todayCount = useMemo(() => allEvents.filter((event) => event.date === from).length, [allEvents, from]);
  const nextWeekCount = useMemo(() => {
    const weekEnd = today.add(7, 'day').format('YYYY-MM-DD');
    return allEvents.filter((event) => event.date >= from && event.date <= weekEnd).length;
  }, [allEvents, from, today]);
  const blockingCount = useMemo(() => allEvents.filter((event) => event.isBlocking).length, [allEvents]);

  return (
    <Card
      bordered={false}
      style={{ borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}`, boxShadow: 'none' }}
      styles={{ body: { padding: '16px 20px' } }}
      title={(
        <Space wrap size={[8, 8]}>
          <Typography.Text strong style={{ fontSize: 14 }}>
            <CalendarOutlined style={{ marginRight: 6 }} />
            ВЭД: быстрый доступ к событиям
          </Typography.Text>
          <Tag color="blue">30 дней</Tag>
        </Space>
      )}
      extra={(
        <Link to="/foreign-trade/import-orders">
          <Button type="link" size="small" icon={<RightOutlined />}>
            Открыть календарь
          </Button>
        </Link>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Сегодня', value: todayCount, color: token.colorPrimary },
          { label: '7 дней', value: nextWeekCount, color: token.colorWarning },
          { label: 'Блокирующие', value: blockingCount, color: token.colorError },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              borderRadius: 12,
              padding: '10px 12px',
              background: `${item.color}12`,
              border: `1px solid ${item.color}24`,
            }}
          >
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {item.label}
            </Typography.Text>
            <Typography.Text strong style={{ fontSize: 18 }}>
              {item.value}
            </Typography.Text>
          </div>
        ))}
      </div>

      <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
        Ближайшие события
      </Typography.Text>

      {isLoading ? (
        <Typography.Text type="secondary">Загрузка событий...</Typography.Text>
      ) : upcomingEvents.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="На ближайшие 30 дней событий нет" />
      ) : (
        <List
          size="small"
          dataSource={upcomingEvents}
          renderItem={(item) => (
            <List.Item style={{ paddingInline: 0 }}>
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Space wrap size={[6, 6]}>
                  <Tag color={COLOR_META[item.colorKey].tagColor}>
                    {dayjs(item.date).format('DD.MM')}
                  </Tag>
                  {item.countryLabel ? <Tag>{item.countryLabel}</Tag> : <Tag>Общее</Tag>}
                  {item.isBlocking ? <Tag color="red">Блок</Tag> : null}
                  {item.source === 'manual' ? <Tag color="blue">Свое</Tag> : null}
                  <Typography.Text strong>{item.title}</Typography.Text>
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
    </Card>
  );
}
