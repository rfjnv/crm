import { type DealStatus } from '../types';
import { Tag } from 'antd';

const statusConfig: Record<DealStatus, { color: string; label: string }> = {
  NEW: { color: 'blue', label: 'Новая' },
  IN_PROGRESS: { color: 'processing', label: 'В работе' },
  WAITING_STOCK_CONFIRMATION: { color: 'gold', label: 'Ожидает подтв. склада' },
  STOCK_CONFIRMED: { color: 'cyan', label: 'Склад подтверждён' },
  WAITING_FINANCE: { color: 'orange', label: 'Ожидает финансы' },
  FINANCE_APPROVED: { color: 'lime', label: 'Финансы одобрены' },
  ADMIN_APPROVED: { color: 'geekblue', label: 'Ожидает потв. Админа' },
  READY_FOR_SHIPMENT: { color: 'purple', label: 'Отгрузка' },
  SHIPMENT_ON_HOLD: { color: 'warning', label: 'Отгрузка приостановлена' },
  CLOSED: { color: 'success', label: 'Закрыта' },
  CANCELED: { color: 'volcano', label: 'Отменена' },
  REJECTED: { color: 'red', label: 'Отклонена' },
  REOPENED: { color: 'magenta', label: 'Возвращена' },
  WAITING_WAREHOUSE_MANAGER: { color: 'gold', label: 'У зав. склада' },
  PENDING_ADMIN: { color: 'geekblue', label: 'Ожидает админа' },
  READY_FOR_LOADING: { color: 'purple', label: 'Готова к отгрузке' },
  LOADING_ASSIGNED: { color: 'processing', label: 'На отгрузке' },
  READY_FOR_DELIVERY: { color: 'orange', label: 'Ожидает водителя' },
  IN_DELIVERY: { color: 'cyan', label: 'В доставке' },
};

export default function DealStatusTag({ status }: { status: DealStatus }) {
  const cfg = statusConfig[status] || { color: 'default', label: status };
  return <Tag color={cfg.color}>{cfg.label}</Tag>;
}

export { statusConfig };
