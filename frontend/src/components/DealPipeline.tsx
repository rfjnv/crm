import { Steps } from 'antd';
import type { DealStatus } from '../types';

const pipelineSteps: { status: DealStatus; label: string }[] = [
  { status: 'NEW', label: 'Новая' },
  { status: 'WAITING_STOCK_CONFIRMATION', label: 'Склад' },
  { status: 'IN_PROGRESS', label: 'В работе' },
  { status: 'WAITING_FINANCE', label: 'Финансы' },
  { status: 'ADMIN_APPROVED', label: 'Админ' },
  { status: 'READY_FOR_SHIPMENT', label: 'Отгрузка' },
  { status: 'CLOSED', label: 'Закрыта' },
];

// Map intermediate statuses to their pipeline step position
const statusToStep: Partial<Record<DealStatus, DealStatus>> = {
  STOCK_CONFIRMED: 'WAITING_STOCK_CONFIRMATION',
  FINANCE_APPROVED: 'WAITING_FINANCE',
};

export default function DealPipeline({ status }: { status: DealStatus }) {
  if (status === 'CANCELED') {
    return (
      <Steps
        size="small"
        status="error"
        current={0}
        items={[{ title: 'Отменена', status: 'error' }]}
      />
    );
  }

  if (status === 'REJECTED') {
    return (
      <Steps
        size="small"
        status="error"
        current={0}
        items={[{ title: 'Отклонена', status: 'error', description: 'Возврат в работу' }]}
      />
    );
  }

  // Map intermediate statuses (STOCK_CONFIRMED → same step as WAITING_STOCK_CONFIRMATION)
  const mappedStatus = statusToStep[status] || status;
  let currentIndex = pipelineSteps.findIndex((s) => s.status === mappedStatus);
  if (currentIndex === -1) {
    currentIndex = 0;
  }

  return (
    <Steps
      size="small"
      current={currentIndex}
      status={status === 'CLOSED' ? 'finish' : 'process'}
      items={pipelineSteps.map((step) => ({
        title: step.label,
      }))}
      style={{ marginBottom: 16 }}
    />
  );
}
