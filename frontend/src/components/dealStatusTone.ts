import type { DealStatus } from '../types';
import type { StatusTone } from './ui/StatusPill';

/**
 * Тон статуса сделки по смыслу (DASHBOARD.md §5): закрыта — positive; отменена и
 * отклонена — negative; всё, что ждёт чьего-то решения или приостановлено, — warning;
 * остальные этапы — neutral. Новый дизайн красит теги по тону, классика — по `color`.
 */
const TONE: Partial<Record<DealStatus, StatusTone>> = {
  CLOSED: 'positive',
  CANCELED: 'negative',
  REJECTED: 'negative',
  WAITING_STOCK_CONFIRMATION: 'warning',
  WAITING_FINANCE: 'warning',
  WAITING_WAREHOUSE_MANAGER: 'warning',
  PENDING_ADMIN: 'warning',
  SHIPMENT_ON_HOLD: 'warning',
  REOPENED: 'warning',
};

export function dealStatusTone(status: DealStatus): StatusTone {
  return TONE[status] ?? 'neutral';
}
