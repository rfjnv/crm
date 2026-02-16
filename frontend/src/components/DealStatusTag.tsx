import { type DealStatus } from '../types';
import { Tag } from 'antd';

const statusConfig: Record<DealStatus, { color: string; label: string }> = {
  NEW: { color: 'blue', label: 'Новая' },
  IN_PROGRESS: { color: 'processing', label: 'В работе' },
  WAITING_STOCK_CONFIRMATION: { color: 'gold', label: 'Ожидает подтв. склада' },
  STOCK_CONFIRMED: { color: 'cyan', label: 'Склад подтверждён' },
  FINANCE_APPROVED: { color: 'lime', label: 'Финансы одобрены' },
  ADMIN_APPROVED: { color: 'geekblue', label: 'Админ одобрил' },
  READY_FOR_SHIPMENT: { color: 'purple', label: 'Готова к отгрузке' },
  SHIPMENT_ON_HOLD: { color: 'warning', label: 'Отгрузка приостановлена' },
  SHIPPED: { color: 'orange', label: 'Отгружена' },
  CLOSED: { color: 'success', label: 'Закрыта' },
  CANCELED: { color: 'volcano', label: 'Отменена' },
  REJECTED: { color: 'red', label: 'Отклонена' },
};

export default function DealStatusTag({ status }: { status: DealStatus }) {
  const cfg = statusConfig[status] || { color: 'default', label: status };
  return <Tag color={cfg.color}>{cfg.label}</Tag>;
}

export { statusConfig };
