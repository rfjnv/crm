import type { ReactNode } from 'react';
import { Tooltip, type GlobalToken } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ActivityBucket } from '../../utils/activityPeriods';
import { formatFullNumber, formatShortNumber } from '../../utils/currency';

/** Если колонок мало, в ячейке видна сама сумма, а не точка. */
export const AMOUNT_COLUMNS_LIMIT = 8;

export function bucketColumnWidth(bucket: ActivityBucket, showAmounts: boolean): number {
  if (showAmounts) return 92;
  return bucket.sublabel ? 40 : 64;
}

export function heatColor(value: number, max: number, token: GlobalToken): string {
  if (value <= 0) return token.colorFillTertiary || '#2f2f2f';
  return `rgba(56,218,17,${0.2 + Math.min(value / Math.max(max, 1), 1) * 0.8})`;
}

export function heatTooltip(bucket: ActivityBucket, value: number, moneyHidden: boolean): string {
  if (value <= 0) return `${bucket.title}: ${bucket.future ? 'ещё не наступило' : 'покупок нет'}`;
  return `${bucket.title}: ${moneyHidden ? 'была покупка' : formatFullNumber(value)}`;
}

type HeatCellProps = {
  bucket: ActivityBucket;
  value: number;
  max: number;
  token: GlobalToken;
  moneyHidden: boolean;
  showAmount: boolean;
  onClick?: () => void;
};

export function renderHeatCell({ bucket, value, max, token, moneyHidden, showAmount, onClick }: HeatCellProps): ReactNode {
  const active = value > 0;
  const intensity = active ? Math.min(value / Math.max(max, 1), 1) : 0;
  return (
    <Tooltip title={heatTooltip(bucket, value, moneyHidden) + (active && onClick ? ' — нажмите, чтобы увидеть покупки' : '')}>
      <div
        onClick={active ? onClick : undefined}
        style={{
          width: showAmount ? '100%' : bucket.sublabel ? 26 : 32,
          minWidth: 26,
          height: 24,
          borderRadius: 5,
          margin: '0 auto',
          backgroundColor: bucket.future && !active ? 'transparent' : heatColor(value, max, token),
          border: bucket.future && !active ? `1px dashed ${token.colorBorderSecondary}` : undefined,
          color: intensity > 0.5 ? '#fff' : token.colorTextSecondary,
          fontSize: showAmount ? 11 : 10,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: active && onClick ? 'pointer' : 'default',
          whiteSpace: 'nowrap',
          padding: showAmount ? '0 4px' : undefined,
        }}
      >
        {active ? (showAmount && !moneyHidden ? formatShortNumber(value) : '●') : ''}
      </div>
    </Tooltip>
  );
}

function headerButton(label: ReactNode, hint: string | undefined, onClick: (() => void) | undefined, token: GlobalToken): ReactNode {
  if (!onClick) return label;
  return (
    <Tooltip title={hint}>
      <span
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        style={{ cursor: 'pointer', color: token.colorPrimary, borderBottom: `1px dashed ${token.colorPrimary}` }}
      >
        {label}
      </span>
    </Tooltip>
  );
}

export type ActivityColumnsOptions<T> = {
  buckets: ActivityBucket[];
  valueOf: (row: T, bucket: ActivityBucket) => number;
  max: number;
  token: GlobalToken;
  moneyHidden: boolean;
  onCellClick?: (row: T, bucket: ActivityBucket) => void;
  /** Клик по заголовку колонки — «провалиться» глубже (месяц → дни, неделя → её дни). */
  onBucketClick?: (bucket: ActivityBucket) => void;
  bucketClickHint?: string;
  /** Клик по заголовку группы (год / месяц / неделя). */
  onGroupClick?: (group: ActivityBucket[]) => void;
  groupClickHint?: string;
};

/**
 * Колонки периодов для antd Table, сгруппированные по году / месяцу / неделе.
 * Выходные подсвечены, сегодняшний период выделен цветом.
 */
export function buildActivityColumns<T extends object>(opts: ActivityColumnsOptions<T>): ColumnsType<T> {
  const { buckets, valueOf, max, token, moneyHidden, onCellClick, onBucketClick, bucketClickHint, onGroupClick, groupClickHint } = opts;
  const showAmounts = buckets.length <= AMOUNT_COLUMNS_LIMIT;

  const groups: ActivityBucket[][] = [];
  for (const b of buckets) {
    const last = groups[groups.length - 1];
    if (last && last[0].groupKey === b.groupKey) last.push(b);
    else groups.push([b]);
  }

  const leaf = (b: ActivityBucket, isGroupStart: boolean) => {
    const edge = isGroupStart ? { borderLeft: `2px solid ${token.colorBorder}` } : {};
    const shade = b.weekend ? { background: token.colorFillQuaternary } : {};
    const label = b.sublabel ? (
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontSize: 10, fontWeight: 400, color: b.weekend ? token.colorError : token.colorTextTertiary }}>{b.sublabel}</div>
        <div>{b.label}</div>
      </div>
    ) : b.label;
    const title = (
      <div style={{ color: b.current ? token.colorPrimary : undefined, fontWeight: b.current ? 700 : undefined }}>
        {headerButton(label, bucketClickHint, onBucketClick ? () => onBucketClick(b) : undefined, token)}
      </div>
    );
    return {
      title,
      key: `b_${b.key}`,
      width: bucketColumnWidth(b, showAmounts),
      align: 'center' as const,
      onHeaderCell: () => ({ style: { ...edge, ...shade, padding: '4px 2px' } }),
      onCell: () => ({ style: { ...edge, ...shade, padding: '4px 2px' } }),
      render: (_: unknown, row: T) => renderHeatCell({
        bucket: b,
        value: valueOf(row, b),
        max,
        token,
        moneyHidden,
        showAmount: showAmounts,
        onClick: onCellClick ? () => onCellClick(row, b) : undefined,
      }),
    };
  };

  return groups.map((g) => ({
    key: `g_${g[0].groupKey}`,
    title: headerButton(g[0].groupLabel, groupClickHint, onGroupClick ? () => onGroupClick(g) : undefined, token),
    align: 'center' as const,
    onHeaderCell: () => ({ style: { borderLeft: `2px solid ${token.colorBorder}` } }),
    children: g.map((b, i) => leaf(b, i === 0)),
  }));
}
