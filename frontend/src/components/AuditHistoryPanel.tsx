import { useQuery } from '@tanstack/react-query';
import { Timeline, Typography, Tag, Spin, Collapse, Empty, theme } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { adminApi } from '../api/admin.api';
import { useIsMobile } from '../hooks/useIsMobile';
import AuditChanges, { hasAuditChanges, type AuditNames } from './AuditChanges';
import type { AuditLog } from '../types';
import dayjs from 'dayjs';
import { getAuditActionLabel } from '../lib/auditActionLabels';
import { renderJsonDiff } from '../lib/auditDiff';
import { getFirstName } from '../lib/name-utils';

export default function AuditHistoryPanel({ dealId, names }: { dealId: string; names?: AuditNames }) {
  const { token: tk } = theme.useToken();
  const isMobile = useIsMobile();
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
        const cfg = getAuditActionLabel(entry.action);
        const isOverride = entry.action === 'OVERRIDE_UPDATE' || entry.action === 'OVERRIDE_DELETE';

        return {
          color: cfg.color,
          dot: isOverride ? <WarningOutlined style={{ color: '#ff4d4f' }} /> : undefined,
          children: (
            <div style={isOverride ? { background: tk.colorErrorBg, padding: 8, borderRadius: 6, border: `1px solid ${tk.colorErrorBorder}` } : undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Typography.Text strong>{getFirstName(entry.user?.fullName) || '—'}</Typography.Text>
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

              {hasAuditChanges(entry.before, entry.after) && (
                <AuditChanges before={entry.before} after={entry.after} names={names} />
              )}

              {(entry.before || entry.after) && (
                <Collapse
                  ghost
                  size="small"
                  style={{ marginTop: 4 }}
                  items={[{
                    key: 'raw',
                    label: <Typography.Text type="secondary" style={{ fontSize: 11 }}>Исходные данные (JSON)</Typography.Text>,
                    children: (
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile || !entry.before || !entry.after ? '1fr' : '1fr 1fr', gap: 8 }}>
                        {renderJsonDiff('До', entry.before, tk.colorFillTertiary)}
                        {renderJsonDiff('После', entry.after, tk.colorFillTertiary)}
                      </div>
                    ),
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
