import { useQuery } from '@tanstack/react-query';
import { Timeline, Typography, Tag, Spin, Collapse, Empty } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { adminApi } from '../api/admin.api';
import DealStatusTag from './DealStatusTag';
import type { AuditLog, DealStatus } from '../types';
import dayjs from 'dayjs';

const actionLabels: Record<string, { label: string; color: string }> = {
  CREATE: { label: 'Создание', color: 'green' },
  UPDATE: { label: 'Изменение', color: 'blue' },
  STATUS_CHANGE: { label: 'Смена статуса', color: 'blue' },
  ARCHIVE: { label: 'Архивирование', color: 'gray' },
  PAYMENT_CREATE: { label: 'Платёж', color: 'cyan' },
  STOCK_WRITE_OFF: { label: 'Списание', color: 'orange' },
  OVERRIDE_UPDATE: { label: 'OVERRIDE', color: 'red' },
  OVERRIDE_DELETE: { label: 'УДАЛЕНИЕ', color: 'red' },
};

function renderJsonDiff(label: string, data: Record<string, unknown> | null | undefined) {
  if (!data) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{label}:</Typography.Text>
      <pre style={{
        fontSize: 11,
        background: '#fafafa',
        padding: 6,
        borderRadius: 4,
        maxHeight: 200,
        overflow: 'auto',
        margin: '2px 0 0 0',
      }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default function AuditHistoryPanel({ dealId }: { dealId: string }) {
  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ['deal-audit', dealId],
    queryFn: () => adminApi.getDealAudit(dealId),
    enabled: !!dealId,
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />;
  if (!auditLogs || auditLogs.length === 0) return <Empty description="Нет записей аудита" />;

  return (
    <Timeline
      items={auditLogs.map((entry: AuditLog) => {
        const cfg = actionLabels[entry.action] || { label: entry.action, color: 'gray' };
        const isOverride = entry.action === 'OVERRIDE_UPDATE' || entry.action === 'OVERRIDE_DELETE';

        return {
          color: cfg.color,
          dot: isOverride ? <WarningOutlined style={{ color: '#ff4d4f' }} /> : undefined,
          children: (
            <div style={isOverride ? { background: '#fff2f0', padding: 8, borderRadius: 6, border: '1px solid #ffccc7' } : undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Typography.Text strong>{entry.user?.fullName || '—'}</Typography.Text>
                {entry.user?.role && <Tag>{entry.user.role}</Tag>}
                <Tag color={cfg.color}>{cfg.label}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(entry.createdAt).format('DD.MM.YYYY HH:mm:ss')}
                </Typography.Text>
              </div>

              {isOverride && entry.reason && (
                <div style={{ marginTop: 6 }}>
                  <Typography.Text type="danger" strong style={{ fontSize: 12 }}>
                    Причина: {entry.reason}
                  </Typography.Text>
                </div>
              )}

              {entry.action === 'STATUS_CHANGE' && entry.before && entry.after && (
                <div style={{ marginTop: 4 }}>
                  <DealStatusTag status={entry.before.status as DealStatus} />
                  {' → '}
                  <DealStatusTag status={entry.after.status as DealStatus} />
                </div>
              )}

              {isOverride && (
                <Collapse
                  ghost
                  size="small"
                  style={{ marginTop: 4 }}
                  items={[{
                    key: 'diff',
                    label: <Typography.Text type="secondary" style={{ fontSize: 11 }}>Показать before/after</Typography.Text>,
                    children: (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {renderJsonDiff('До', entry.before)}
                        {renderJsonDiff('После', entry.after)}
                      </div>
                    ),
                  }]}
                />
              )}

              {!isOverride && entry.action !== 'STATUS_CHANGE' && entry.after && (
                <Collapse
                  ghost
                  size="small"
                  style={{ marginTop: 4 }}
                  items={[{
                    key: 'details',
                    label: <Typography.Text type="secondary" style={{ fontSize: 11 }}>Детали</Typography.Text>,
                    children: renderJsonDiff('Данные', entry.after),
                  }]}
                />
              )}
            </div>
          ),
        };
      })}
    />
  );
}
