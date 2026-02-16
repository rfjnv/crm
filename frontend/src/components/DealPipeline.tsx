import { Steps } from 'antd';
import type { DealStatus } from '../types';

const pipelineSteps: { status: DealStatus; label: string }[] = [
  { status: 'NEW', label: 'Новая' },
  { status: 'IN_PROGRESS', label: 'В работе' },
  { status: 'WAITING_STOCK_CONFIRMATION', label: 'Подтв. склада' },
  { status: 'STOCK_CONFIRMED', label: 'Склад подтв.' },
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

  const currentIndex = pipelineSteps.findIndex((s) => s.status === status);

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
