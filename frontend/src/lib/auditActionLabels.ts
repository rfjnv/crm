export const auditActionLabels: Record<string, { label: string; color: string }> = {
  CREATE: { label: 'Создание', color: 'green' },
  UPDATE: { label: 'Изменение', color: 'blue' },
  UPDATE_CLIENT: { label: 'Изменение клиента', color: 'blue' },
  DELETE: { label: 'Удаление', color: 'red' },
  ARCHIVE: { label: 'Архивирование', color: 'gray' },
  RESTORE: { label: 'Восстановление', color: 'cyan' },
  STATUS_CHANGE: { label: 'Смена статуса', color: 'blue' },
  LOGIN: { label: 'Вход', color: 'green' },
  LOGOUT: { label: 'Выход', color: 'gray' },
  LOGIN_FAILED: { label: 'Неудачный вход', color: 'volcano' },
  SUSPICIOUS_ACTIVITY: { label: 'Подозрительная активность', color: 'red' },
  NOTIFICATION_BROADCAST: { label: 'Рассылка', color: 'purple' },
  PAYMENT_CREATE: { label: 'Платёж создан', color: 'cyan' },
  PAYMENT_UPDATE: { label: 'Платёж изменён', color: 'blue' },
  PAYMENT_DELETE: { label: 'Платёж удалён', color: 'red' },
  STOCK_WRITE_OFF: { label: 'Списание', color: 'orange' },
  OVERRIDE_UPDATE: { label: 'OVERRIDE', color: 'red' },
  OVERRIDE_DELETE: { label: 'УДАЛЕНИЕ (override)', color: 'red' },
};

export function getAuditActionLabel(action: string): { label: string; color: string } {
  return auditActionLabels[action] || { label: action, color: 'default' };
}
