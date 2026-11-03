import type { CallChannel } from '@prisma/client';
import { getMobileSettings } from './mobile.settings';
import { isServicePhone } from './mobile.service-phones';

/**
 * Почему запись не идёт в автоматический анализ (null — идёт). Ручной запуск руководителем
 * эти правила не проверяет: анализ платный, поэтому автоматически — только то, что нужно.
 */
export async function autoAnalysisSkipReason(call: { durationSec: number | null; phoneKey: string | null; channel?: CallChannel }): Promise<string | null> {
  // Промпт аудита написан под продажи — разговоры HR с кандидатами им не разбираем
  if (call.channel === 'HR') return 'Звонок HR — не анализируем';
  const settings = await getMobileSettings();
  if (!settings.autoAuditEnabled) return 'Анализ не запускали';
  if (await isServicePhone(call.phoneKey)) return 'Служебный номер — не анализируем автоматически';
  if ((call.durationSec ?? 0) < settings.minAuditDurationSec) {
    return `Звонок короче ${settings.minAuditDurationSec} с — не анализируем автоматически`;
  }
  return null;
}
