import { Steps, Tag, Progress, Typography } from 'antd';
import { useIsMobile } from '../hooks/useIsMobile';
import type { DealStatus } from '../types';

const pipelineSteps: { status: DealStatus; label: string }[] = [
  { status: 'NEW', label: 'Новая' },
  { status: 'WAITING_STOCK_CONFIRMATION', label: 'Склад' },
  { status: 'IN_PROGRESS', label: 'В работе' },
  { status: 'WAITING_FINANCE', label: 'Финансы' },
  { status: 'WAITING_WAREHOUSE_MANAGER', label: 'Зав. склада' },
  { status: 'PENDING_ADMIN', label: 'Админ' },
  { status: 'READY_FOR_LOADING', label: 'На отгрузку' },
  { status: 'LOADING_ASSIGNED', label: 'Отгрузка' },
  { status: 'IN_DELIVERY', label: 'Доставка' },
  { status: 'CLOSED', label: 'Закрыта' },
];

// Map intermediate statuses to their pipeline step position
const statusToStep: Partial<Record<DealStatus, DealStatus>> = {
  STOCK_CONFIRMED: 'WAITING_STOCK_CONFIRMATION',
  FINANCE_APPROVED: 'WAITING_FINANCE',
  READY_FOR_DELIVERY: 'IN_DELIVERY',
  ADMIN_APPROVED: 'PENDING_ADMIN',
  READY_FOR_SHIPMENT: 'LOADING_ASSIGNED',
};

function MobilePipeline({ status }: { status: DealStatus }) {
  if (status === 'CANCELED') {
    return <Tag color="error" style={{ fontSize: 14, padding: '4px 12px' }}>Отменена</Tag>;
  }
  if (status === 'REJECTED') {
    return <Tag color="error" style={{ fontSize: 14, padding: '4px 12px' }}>Отклонена</Tag>;
  }

  const mappedStatus = statusToStep[status] || status;
  let currentIndex = pipelineSteps.findIndex((s) => s.status === mappedStatus);
  if (currentIndex === -1) currentIndex = 0;
  const isClosed = status === 'CLOSED';
  const total = pipelineSteps.length;
  const step = isClosed ? total : currentIndex + 1;
  const percent = Math.round((step / total) * 100);
  const currentLabel = pipelineSteps[currentIndex]?.label || '';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Progress
        type="circle"
        percent={percent}
        size={44}
        format={() => `${step}/${total}`}
        status={isClosed ? 'success' : 'active'}
        strokeWidth={8}
      />
      <div>
        <Typography.Text strong style={{ fontSize: 14 }}>{currentLabel}</Typography.Text>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Этап {step} из {total}
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}

export default function DealPipeline({ status }: { status: DealStatus }) {
  const isMobile = useIsMobile();

  if (isMobile) return <MobilePipeline status={status} />;

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
