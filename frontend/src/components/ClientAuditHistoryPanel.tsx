import { Timeline, Typography, Tag, Spin, Empty, theme, Card, Space } from 'antd';
import type { AuditLog } from '../types';
import dayjs from 'dayjs';

/** Labels for client snapshot keys (backend clientAuditSnapshot). */
const CLIENT_FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  companyName: 'Компания',
  contactName: 'Контакт',
  phone: 'Телефон',
  email: 'Email',
  address: 'Адрес',
  notes: 'Примечания',
  inn: 'ИНН',
  bankName: 'Банк',
  bankAccount: 'Расчётный счёт',
  mfo: 'МФО',
  vatRegCode: 'Код НДС',
  oked: 'ОКЭД',
  managerId: 'Менеджер (ID)',
  isArchived: 'В архиве',
  createdAt: 'Создан',
  updatedAt: 'Обновлён',
};

const actionLabels: Record<string, { label: string; color: string }> = {
  CREATE: { label: 'Создание клиента', color: 'green' },
  UPDATE: { label: 'Изменение', color: 'blue' },
  UPDATE_CLIENT: { label: 'Редактирование клиента', color: 'blue' },
  ARCHIVE: { label: 'В архив', color: 'orange' },
  DELETE: { label: 'Удаление', color: 'red' },
};

function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return JSON.stringify(o, Object.keys(o).sort());
  }
  return JSON.stringify(v);
}

function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Да' : 'Нет';
  return String(v);
}

export type ClientAuditChange = { label: string; oldV: string; newV: string };

/** Only fields that differ between before and after (by value). */
export function getClientAuditChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): ClientAuditChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: ClientAuditChange[] = [];
  for (const key of keys) {
    const b = before?.[key];
    const a = after?.[key];
    if (stableStringify(b) === stableStringify(a)) continue;
    out.push({
      label: CLIENT_FIELD_LABELS[key] ?? key,
      oldV: formatAuditValue(b),
      newV: formatAuditValue(a),
    });
  }
  return out;
}

type Props = {
  logs: AuditLog[] | undefined;
  isLoading?: boolean;
};

export default function ClientAuditHistoryPanel({ logs, isLoading }: Props) {
  const { token } = theme.useToken();

  if (isLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />;
  }
  if (!logs || logs.length === 0) {
    return <Empty description="Нет записей в истории" />;
  }

  return (
    <Timeline
      items={logs.map((log) => {
        const cfg = actionLabels[log.action] || { label: log.action, color: 'default' };
        const changes = getClientAuditChanges(log.before, log.after);

        return {
          color: cfg.color,
          children: (
            <Card
              size="small"
              bordered
              style={{
                marginBottom: token.marginMD,
                maxWidth: 720,
                borderRadius: token.borderRadiusLG,
              }}
              styles={{ body: { paddingBottom: token.paddingSM } }}
            >
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <Typography.Text strong>{log.user?.fullName ?? 'Неизвестный пользователь'}</Typography.Text>
                  <Tag color={cfg.color}>{cfg.label}</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(log.createdAt).format('DD.MM.YYYY HH:mm')}
                  </Typography.Text>
                </div>

                {log.reason && (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    Причина: {log.reason}
                  </Typography.Text>
                )}

                {changes.length > 0 ? (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      listStyle: 'disc',
                    }}
                  >
                    {changes.map((c) => (
                      <li key={c.label} style={{ marginBottom: 6 }}>
                        <Typography.Text style={{ fontSize: 13 }}>
                          <Typography.Text strong>{c.label}</Typography.Text>
                          {': '}
                          <Typography.Text type="secondary">{c.oldV}</Typography.Text>
                          <Typography.Text type="secondary"> → </Typography.Text>
                          <Typography.Text>{c.newV}</Typography.Text>
                        </Typography.Text>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    Изменений по полям нет (или данные не сохранены)
                  </Typography.Text>
                )}
              </Space>
            </Card>
          ),
        };
      })}
    />
  );
}
