import prisma from '../../lib/prisma';
import { deviceProblems, problemLabels } from './mobile.alerts';
import { isWorkingTime, workingMsBetween } from './mobile.mapping';
import { getMobileSettings } from './mobile.settings';

const SILENT_AFTER_MS = 2 * 60 * 60 * 1000;

/** Телефоны для админки: активные сверху, с подсветкой «молчит» и проблем с разрешениями. */
export async function listDevices(now: Date = new Date()) {
  const [devices, models, settings] = await Promise.all([
    prisma.mobileDevice.findMany({
      orderBy: [{ active: 'desc' }, { lastSeenAt: { sort: 'desc', nulls: 'last' } }],
      take: 300,
      select: {
        id: true,
        model: true,
        androidVersion: true,
        sdkInt: true,
        appVersion: true,
        active: true,
        revokedAt: true,
        lastSeenAt: true,
        lastSyncAt: true,
        lastCallAt: true,
        queueCalls: true,
        queueFiles: true,
        queueBytes: true,
        failedCalls: true,
        simSlot: true,
        permissions: true,
        recordingsDirFound: true,
        recordingsPathOverride: true,
        uploadLogsRequested: true,
        lastLogPath: true,
        lastLogAt: true,
        createdAt: true,
        user: { select: { id: true, fullName: true } },
      },
    }),
    prisma.mobileDeviceModelConfig.findMany({ select: { model: true, recordingsPath: true } }),
    getMobileSettings(),
  ]);
  const modelPaths = new Map(models.map((m) => [m.model, m.recordingsPath]));
  const workingNow = isWorkingTime(now, settings);

  return {
    workingNow,
    devices: devices.map((d) => {
      const problems = d.active ? deviceProblems(d) : [];
      const since = d.lastSeenAt ?? d.createdAt;
      return {
        ...d,
        hasLog: !!d.lastLogPath,
        lastLogPath: undefined,
        modelRecordingsPath: d.model ? modelPaths.get(d.model) ?? null : null,
        effectiveRecordingsPath: d.recordingsPathOverride || (d.model ? modelPaths.get(d.model) : null) || null,
        /** Молчит больше 2 часов рабочего времени */
        silent: d.active && workingMsBetween(since, now, settings) >= SILENT_AFTER_MS,
        problems,
        problemsText: problems.length > 0 ? problemLabels(problems) : null,
      };
    }),
  };
}

/** Модели телефонов: с настроенным путём и все, что встречались у устройств. */
export async function listDeviceModels() {
  const [configs, seen] = await Promise.all([
    prisma.mobileDeviceModelConfig.findMany({ orderBy: { model: 'asc' } }),
    prisma.mobileDevice.groupBy({ by: ['model'], where: { model: { not: null } }, _count: { _all: true } }),
  ]);
  const byModel = new Map<string, { model: string; recordingsPath: string | null; devicesCount: number }>();
  for (const c of configs) byModel.set(c.model, { model: c.model, recordingsPath: c.recordingsPath, devicesCount: 0 });
  for (const s of seen) {
    if (!s.model) continue;
    const row = byModel.get(s.model) ?? { model: s.model, recordingsPath: null, devicesCount: 0 };
    row.devicesCount = s._count._all;
    byModel.set(s.model, row);
  }
  return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
}
