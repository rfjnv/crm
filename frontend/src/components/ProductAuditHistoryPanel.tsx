import { useQuery } from '@tanstack/react-query';
import { Timeline, Typography, Tag, Spin, Collapse, Empty, theme } from 'antd';
import { adminApi } from '../api/admin.api';
import { useIsMobile } from '../hooks/useIsMobile';
import type { AuditLog } from '../types';
import dayjs from 'dayjs';
import { getAuditActionLabel } from '../lib/auditActionLabels';
import { renderJsonDiff } from '../lib/auditDiff';

export default function ProductAuditHistoryPanel({ productId }: { productId?: string }) {
  const { token: tk } = theme.useToken();
  const isMobile = useIsMobile();
  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ['product-audit', productId],
    queryFn: () => adminApi.getProductAudit(productId),
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />;
  if (!auditLogs || auditLogs.length === 0) return <Empty description="Нет записей аудита" />;

  return (
    <Timeline
      items={auditLogs.map((entry: AuditLog) => {
        const cfg = getAuditActionLabel(entry.action);

        return {
          color: cfg.color,
          children: (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Typography.Text strong>{entry.user?.fullName || '—'}</Typography.Text>
                {entry.user?.role && <Tag>{entry.user.role}</Tag>}
                <Tag color={cfg.color}>{cfg.label}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(entry.createdAt).format('DD.MM.YYYY HH:mm:ss')}
                </Typography.Text>
              </div>

              {entry.reason && (
                <div style={{ marginTop: 6 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Причина: {entry.reason}
                  </Typography.Text>
                </div>
              )}

              <Collapse
                ghost
                size="small"
                style={{ marginTop: 4 }}
                items={[{
                  key: 'diff',
                  label: <Typography.Text type="secondary" style={{ fontSize: 11 }}>Показать изменения (before/after)</Typography.Text>,
                  children: (
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
                      {renderJsonDiff('До', entry.before, tk.colorFillTertiary)}
                      {renderJsonDiff('После', entry.after, tk.colorFillTertiary)}
                    </div>
                  ),
                }]}
              />
            </div>
          ),
        };
      })}
    />
  );
}
