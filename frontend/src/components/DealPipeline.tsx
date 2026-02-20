import { Steps } from 'antd';
import type { DealStatus } from '../types';

const pipelineSteps: { status: DealStatus; label: string }[] = [
  { status: 'NEW', label: 'Новая' },
  { status: 'IN_PROGRESS', label: 'В работе' },
  { status: 'FINANCE_APPROVED', label: 'Финансы одобрены' },
  { status: 'ADMIN_APPROVED', label: 'Админ одобрил' },
  { status: 'READY_FOR_SHIPMENT', label: 'Готова к отгрузке' },
  { status: 'SHIPPED', label: 'Отгружена' },
  { status: 'CLOSED', label: 'Закрыта' },
];

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

  // Handle legacy statuses (WAITING_STOCK_CONFIRMATION, STOCK_CONFIRMED) — map to IN_PROGRESS position
  let currentIndex = pipelineSteps.findIndex((s) => s.status === status);
  if (currentIndex === -1) {
    // Legacy status: show at IN_PROGRESS step
    currentIndex = pipelineSteps.findIndex((s) => s.status === 'IN_PROGRESS');
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
