import type { ReactNode } from 'react';
import { Button, DatePicker, Segmented, Tooltip, theme } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  GRANULARITY_LABELS,
  addMonths,
  monthTitle,
  weeksOfMonth,
  type ActivityGranularity,
} from '../../utils/activityPeriods';

type Props = {
  granularity: ActivityGranularity;
  onGranularityChange: (g: ActivityGranularity) => void;
  /** Режим недоступен — причина показывается в подсказке. */
  disabled?: Partial<Record<ActivityGranularity, string>>;
  /** Справа от переключателя: выбор периода для месяцев и недель. */
  extra?: ReactNode;
  /** Режим «Дни»: месяц `YYYY-MM` и, если выбрана, неделя (её первый день). */
  dayMonth?: string;
  dayWeek?: string | null;
  onDayChange?: (month: string, week: string | null) => void;
  minMonth?: string;
  maxMonth?: string;
};

/**
 * Переключатель «Месяцы / Недели / Дни» и навигация по дням:
 * ‹ Сентябрь 2026 › и под ним недели месяца — «Весь месяц», «1–6», «7–13», …
 */
export default function ActivityPeriodBar({
  granularity, onGranularityChange, disabled, extra,
  dayMonth, dayWeek = null, onDayChange, minMonth, maxMonth,
}: Props) {
  const { token } = theme.useToken();
  const showDayNav = granularity === 'day' && !!dayMonth && !!onDayChange;
  const weeks = showDayNav ? weeksOfMonth(dayMonth) : [];
  const canPrev = showDayNav && (!minMonth || addMonths(dayMonth, -1) >= minMonth);
  const canNext = showDayNav && (!maxMonth || addMonths(dayMonth, 1) <= maxMonth);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented
          value={granularity}
          onChange={(v) => onGranularityChange(v as ActivityGranularity)}
          options={(['month', 'week', 'day'] as const).map((g) => ({
            value: g,
            disabled: !!disabled?.[g],
            label: disabled?.[g]
              ? <Tooltip title={disabled[g]}><span>{GRANULARITY_LABELS[g]}</span></Tooltip>
              : GRANULARITY_LABELS[g],
          }))}
        />
        {extra}
      </div>

      {showDayNav && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Button
              icon={<LeftOutlined />}
              disabled={!canPrev}
              onClick={() => onDayChange(addMonths(dayMonth, -1), null)}
              aria-label="Предыдущий месяц"
            />
            <DatePicker
              picker="month"
              allowClear={false}
              value={dayjs(`${dayMonth}-01`)}
              format={() => monthTitle(dayMonth)}
              disabledDate={(d) => {
                const ym = d.format('YYYY-MM');
                return (!!minMonth && ym < minMonth) || (!!maxMonth && ym > maxMonth);
              }}
              onChange={(d) => { if (d) onDayChange(d.format('YYYY-MM'), null); }}
              style={{ width: 160 }}
            />
            <Button
              icon={<RightOutlined />}
              disabled={!canNext}
              onClick={() => onDayChange(addMonths(dayMonth, 1), null)}
              aria-label="Следующий месяц"
            />
          </div>
          <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>Неделя:</span>
          <Segmented
            size="small"
            value={dayWeek ?? 'all'}
            onChange={(v) => onDayChange(dayMonth, v === 'all' ? null : String(v))}
            options={[
              { label: 'Весь месяц', value: 'all' },
              ...weeks.map((w) => ({ label: w.label, value: w.key, title: w.title })),
            ]}
          />
        </div>
      )}
    </div>
  );
}

/** Легенда цвета ячеек. */
export function ActivityLegend({ children }: { children?: ReactNode }) {
  const { token } = theme.useToken();
  const swatch = (bg: string, border?: string) => (
    <span style={{ width: 16, height: 16, borderRadius: 3, background: bg, border, display: 'inline-block' }} />
  );
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{swatch('rgba(56,218,17,0.2)')} Мало</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{swatch('rgba(56,218,17,1)')} Много</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{swatch(token.colorFillTertiary || '#2f2f2f')} Нет покупок</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{swatch('transparent', `1px dashed ${token.colorBorderSecondary}`)} Ещё не наступило</span>
      {children}
    </div>
  );
}
