import { useEffect, useMemo, useState } from 'react';
import { DatePicker, Dropdown } from 'antd';
import { CalendarBlank, CaretDown, Check } from '@phosphor-icons/react';
import dayjs, { type Dayjs } from 'dayjs';
import type { DashboardPeriod } from '../api/warehouse.api';
import { useHoverGlider } from '../hooks/useHoverGlider';

/** Фразы под приветствием сменяют друг друга, чтобы шапка не была скучной. */
const MOTTOS = [
  'Каждый звонок — шаг к сделке',
  'Маленькие шаги каждый день дают большой результат',
  'Сегодня отличный день, чтобы закрыть сделку',
  'Клиент помнит не цену, а отношение',
  'Лучшее время для нового клиента — сейчас',
  'Цель месяца ближе, чем кажется',
  'Сделайте сегодня то, за что завтра скажете себе спасибо',
  'Порядок в CRM — порядок в продажах',
  'Один довольный клиент приводит троих',
  'Дисциплина сильнее мотивации',
];

const MOTTO_INTERVAL_MS = 6000;
const MOTTO_FADE_MS = 350;

const PERIOD_ITEMS: { value: DashboardPeriod; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
];

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

interface Props {
  name: string;
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
  /** «Свой период» доступен не всем — как и раньше, только администраторам. */
  canPickCustom: boolean;
  customRange: [Dayjs, Dayjs] | null;
  onCustomRange: (dates: [Dayjs | null, Dayjs | null] | null) => void;
}

/**
 * Шапка дашборда в новом дизайне: приветствие по времени суток, сменяющиеся
 * мотивирующие фразы и выбор периода справа в той же строке.
 */
export default function DashboardGreeting({
  name,
  period,
  onPeriodChange,
  canPickCustom,
  customRange,
  onCustomRange,
}: Props) {
  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);
  const words = `${greeting}, ${name}`.split(' ');

  const [mottoIndex, setMottoIndex] = useState(() => Math.floor(Math.random() * MOTTOS.length));
  const [mottoLeaving, setMottoLeaving] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let fadeTimer: number | undefined;
    const timer = window.setInterval(() => {
      setMottoLeaving(true);
      fadeTimer = window.setTimeout(() => {
        setMottoIndex((i) => (i + 1) % MOTTOS.length);
        setMottoLeaving(false);
      }, MOTTO_FADE_MS);
    }, MOTTO_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(fadeTimer);
    };
  }, []);

  const [open, setOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);

  const items = canPickCustom ? [...PERIOD_ITEMS, { value: 'custom' as DashboardPeriod, label: 'Свой период' }] : PERIOD_ITEMS;
  const currentLabel =
    period === 'custom' && customRange
      ? `${customRange[0].format('DD.MM')} — ${customRange[1].format('DD.MM')}`
      : items.find((i) => i.value === period)?.label ?? 'Период';

  const choose = (value: DashboardPeriod) => {
    setOpen(false);
    onPeriodChange(value);
    if (value === 'custom') setRangeOpen(true);
  };

  return (
    <div className="dash-head">
      <div className="dash-head__text">
        <h1 className="dash-greeting" aria-label={`${greeting}, ${name}`}>
          {words.map((word, i) => (
            <span key={`${word}-${i}`} className="dash-greeting__word" style={{ animationDelay: `${i * 90}ms` }} aria-hidden>
              {word}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          ))}
        </h1>
        <div className="dash-motto">
          <span key={mottoIndex} className={`dash-motto__text${mottoLeaving ? ' dash-motto__text--out' : ''}`}>
            {MOTTOS[mottoIndex]}
          </span>
        </div>
      </div>

      <div className="dash-head__controls">
        {period === 'custom' && canPickCustom && (
          <DatePicker.RangePicker
            className="dash-range"
            open={rangeOpen}
            onOpenChange={setRangeOpen}
            value={customRange}
            onChange={onCustomRange as (dates: unknown) => void}
            format="DD.MM.YYYY"
            allowClear={false}
            disabledDate={(current) => current && current > dayjs().endOf('day')}
          />
        )}
        <Dropdown
          open={open}
          onOpenChange={setOpen}
          trigger={['click']}
          placement="bottomRight"
          popupRender={() => <PeriodPanel items={items} current={period} onChoose={choose} />}
        >
          <button type="button" className="dash-period">
            <CalendarBlank size={18} />
            <span>{currentLabel}</span>
            <CaretDown size={14} className="dash-period__caret" />
          </button>
        </Dropdown>
      </div>
    </div>
  );
}

function PeriodPanel({
  items,
  current,
  onChoose,
}: {
  items: { value: DashboardPeriod; label: string }[];
  current: DashboardPeriod;
  onChoose: (value: DashboardPeriod) => void;
}) {
  const glider = useHoverGlider<HTMLDivElement>('.hdr-panel__row--action');
  return (
    <div className="hdr-panel dash-period-panel" ref={glider.ref}>
      <span className="hover-glider" style={glider.style} aria-hidden />
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className="hdr-panel__row hdr-panel__row--action"
          onClick={() => onChoose(item.value)}
        >
          <span className="hdr-panel__label">{item.label}</span>
          {item.value === current && <Check size={16} weight="bold" />}
        </button>
      ))}
    </div>
  );
}
