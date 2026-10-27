import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { foreignTradeApi } from '../api/foreign-trade.api';
import { importOrdersApi } from '../api/import-orders.api';
import { normalizeVedCountry } from '../utils/vedBlockingCalendar';
import type { BlockingHolidayEvent, VedCountryCode } from '../types';
import './VedEventsQuickAccessCard.css';

/* Свои события и правки праздников — из календаря ВЭД (ImportBlockingCalendarCard), в браузере */
const MANUAL_STORAGE_KEY = 'crm-ved-manual-calendar-events-v1';
const API_OVERRIDE_STORAGE_KEY = 'crm-ved-api-event-overrides-v1';

type ManualCalendarEvent = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  countryCode: VedCountryCode | null;
  isBlocking: boolean;
};

type ApiEventOverride = {
  sourceEventId: string;
  title: string;
  startDate: string;
  endDate: string;
  isBlocking: boolean;
};

interface VedEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  countryCode: VedCountryCode | null;
  countryLabel: string;
  manual: boolean;
}

const DAYS = 30;

/** Цвет страны — в ленте и у кода страны */
const COUNTRY_COLOR: Record<VedCountryCode, string> = {
  CN: '#e11d48',
  TR: '#dc2626',
  RU: '#2563eb',
  KZ: '#0891b2',
  KG: '#d97706',
  TM: '#65a30d',
  IR: '#16a34a',
  GE: '#9333ea',
};
const OWN_COLOR = '#64748b';

/** Заказ ещё не уехал от поставщика — праздник может сдвинуть отгрузку */
const NOT_SHIPPED = new Set(['DRAFT', 'ORDERED', 'IN_PRODUCTION']);

function loadJson<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]') as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function inDays(n: number): string {
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return `через ${n} ${plural(n, ['день', 'дня', 'дней'])}`;
}

const fmtDay = (d: string) => dayjs(d).locale('ru').format('D MMM').replace('.', '');
const colorOf = (code: VedCountryCode | null) => (code ? COUNTRY_COLOR[code] : OWN_COLOR);

/**
 * Главная: праздники у поставщиков на 30 дней — лента дней, список по-русски
 * (многодневный праздник — одна строка) и заказы, отгрузка которых попадает на праздник.
 */
export default function VedEventsQuickAccessCard() {
  const [manualEvents] = useState(() => loadJson<ManualCalendarEvent>(MANUAL_STORAGE_KEY));
  const [overrides] = useState(() => loadJson<ApiEventOverride>(API_OVERRIDE_STORAGE_KEY));

  const today = useMemo(() => dayjs().startOf('day'), []);
  const from = today.format('YYYY-MM-DD');
  const to = today.add(DAYS - 1, 'day').format('YYYY-MM-DD');

  const { data, isLoading } = useQuery({
    queryKey: ['ved-events-quick-access', from, to],
    queryFn: () => foreignTradeApi.getBlockingEvents({ from, to }),
    staleTime: 5 * 60_000,
  });
  // Заказы видят не все, кто видит календарь: нет доступа — просто без блока рисков
  const { data: orders } = useQuery({
    queryKey: ['import-orders', 'ved-quick'],
    queryFn: () => importOrdersApi.list(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const events = useMemo<VedEvent[]>(() => {
    const labels = new Map((data?.countries ?? []).map((c) => [c.code, c.label]));
    const byId = new Map(overrides.map((o) => [o.sourceEventId, o]));
    const official = (data?.items ?? []).map((e: BlockingHolidayEvent) => {
      const o = byId.get(e.id);
      return {
        id: e.id,
        title: o?.title ?? e.name,
        startDate: o?.startDate ?? e.startDate,
        endDate: o?.endDate ?? e.endDate,
        countryCode: e.countryCode,
        countryLabel: e.countryLabel,
        manual: false,
        blocking: o?.isBlocking ?? true,
      };
    });
    const manual = manualEvents.map((e) => ({
      id: e.id,
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      countryCode: e.countryCode,
      countryLabel: e.countryCode ? (labels.get(e.countryCode) ?? e.countryCode) : 'Своё',
      manual: true,
      blocking: e.isBlocking,
    }));
    return [...official, ...manual]
      .filter((e) => e.blocking && e.endDate >= from && e.startDate <= to)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.countryLabel.localeCompare(b.countryLabel, 'ru'));
  }, [data, overrides, manualEvents, from, to]);

  const strip = useMemo(() => Array.from({ length: DAYS }, (_, i) => {
    const d = today.add(i, 'day');
    const key = d.format('YYYY-MM-DD');
    return { key, d, events: events.filter((e) => e.startDate <= key && e.endDate >= key) };
  }), [events, today]);

  const risks = useMemo(() => (orders ?? []).flatMap((o) => {
    if (!o.etd || !NOT_SHIPPED.has(o.status)) return [];
    const etd = o.etd.slice(0, 10);
    const code = normalizeVedCountry(o.supplier?.country);
    if (!code) return [];
    const hit = events.find((e) => e.countryCode === code && e.startDate <= etd && e.endDate >= etd);
    return hit ? [{ order: o, event: hit, etd }] : [];
  }), [orders, events]);

  const countries = useMemo(() => {
    const seen = new Map<string, VedEvent>();
    events.forEach((e) => { if (!seen.has(e.countryCode ?? 'OWN')) seen.set(e.countryCode ?? 'OWN', e); });
    return [...seen.values()];
  }, [events]);
  const next = events[0];

  return (
    <Card className="ved-quick" bordered={false} styles={{ body: { padding: '18px 20px' } }}>
      <header className="ved-quick__head">
        <span className="ved-quick__title">ВЭД · праздники у поставщиков</span>
        <span className="ved-quick__sub">ближайшие {DAYS} дней</span>
        <Link className="ved-quick__link" to="/foreign-trade/import-orders">Календарь ›</Link>
      </header>

      <div className="ved-quick__summary">
        {isLoading ? 'Загружаем праздники…' : !next ? `В ближайшие ${DAYS} дней праздников у поставщиков нет` : (
          <>
            Ближайший — <b>{next.countryLabel}, {inDays(Math.max(0, dayjs(next.startDate).diff(today, 'day')))}</b>
            {' · '}всего {events.length} {plural(events.length, ['праздник', 'праздника', 'праздников'])}
            {' '}в {countries.length} {plural(countries.length, ['стране', 'странах', 'странах'])}
          </>
        )}
      </div>

      <div className="ved-quick__strip">
        {strip.map(({ key, d, events: dayEvents }, i) => (
          <span
            key={key}
            className={`ved-quick__day${d.day() === 0 ? ' ved-quick__day--off' : ''}${i === 0 ? ' ved-quick__day--today' : ''}`}
            title={`${d.locale('ru').format('D MMM, dd')}${dayEvents.length ? ` — ${dayEvents.map((x) => `${x.countryLabel}: ${x.title}`).join('; ')}` : ''}`}
          >
            {dayEvents[0] && <i style={{ background: colorOf(dayEvents[0].countryCode) }} />}
          </span>
        ))}
      </div>
      <div className="ved-quick__caps">
        <span>сегодня, {fmtDay(from)}</span>
        <span>{fmtDay(today.add(Math.floor(DAYS / 2), 'day').format('YYYY-MM-DD'))}</span>
        <span>{fmtDay(to)}</span>
      </div>

      {countries.length > 0 && (
        <div className="ved-quick__legend">
          {countries.map((e) => (
            <span key={e.countryCode ?? 'OWN'}><i style={{ background: colorOf(e.countryCode) }} />{e.countryLabel}</span>
          ))}
          <span><i className="ved-quick__legend-off" />воскресенье</span>
        </div>
      )}

      {events.slice(0, 6).map((e) => {
        const n = Math.max(0, dayjs(e.startDate).diff(today, 'day'));
        const len = dayjs(e.endDate).diff(dayjs(e.startDate), 'day') + 1;
        return (
          <div key={e.id} className="ved-quick__ev">
            <div className="ved-quick__date">
              <b>{len > 1 ? `${dayjs(e.startDate).date()}–${fmtDay(e.endDate)}` : fmtDay(e.startDate)}</b>
              <small>{dayjs(e.startDate).locale('ru').format('dd')}{len > 1 ? ` · ${len} ${plural(len, ['день', 'дня', 'дней'])}` : ''}</small>
            </div>
            <div className="ved-quick__t">
              <div className="ved-quick__name">{e.title}</div>
              <div className="ved-quick__meta">
                <span className="ved-quick__cc" style={{ background: colorOf(e.countryCode) }}>{e.countryCode ?? '•'}</span>
                {e.countryLabel}{e.manual ? ' · своё событие' : ' · не работают'}
              </div>
            </div>
            <span className={`ved-quick__when${n <= 7 ? ' ved-quick__when--soon' : ''}`}>{inDays(n)}</span>
          </div>
        );
      })}
      {events.length > 6 && (
        <Link className="ved-quick__more" to="/foreign-trade/import-orders">ещё {events.length - 6} в календаре ›</Link>
      )}

      {risks.length > 0 && (
        <div className="ved-quick__risk">
          <b>Попадают на праздники — проверьте сроки</b>
          {risks.slice(0, 5).map(({ order, event, etd }) => (
            <Link key={order.id} className="ved-quick__risk-row" to={`/foreign-trade/import-orders/${order.id}`}>
              <span>{order.number} · {order.supplier.companyName} ({event.countryLabel})</span>
              <span>отгрузка {fmtDay(etd)} — {event.title}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
