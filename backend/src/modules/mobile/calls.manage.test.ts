import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './__tests__/fakePrisma';

const state = vi.hoisted(() => ({
  fake: null as any,
  settings: { autoAuditEnabled: false, minAuditDurationSec: 30 },
  claimQueue: [] as string[],
  claudeCreate: null as any,
}));

vi.mock('../../lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, key) => state.fake.prisma[key] }),
}));
vi.mock('../telegram/telegram.service', () => ({ telegramService: { sendToUser: vi.fn(async () => {}) } }));
vi.mock('./mobile.settings', () => ({ getMobileSettings: vi.fn(async () => state.settings) }));
vi.mock('./mobile.storage', () => ({
  audioExt: () => 'm4a',
  audioMime: () => 'audio/mp4',
  downloadToTemp: vi.fn(async () => 'C:/nonexistent/rec.m4a'),
  removeFiles: vi.fn(async () => {}),
  signedUrl: vi.fn(async () => 'https://signed'),
}));
vi.mock('./mobile.drive', () => ({
  isDriveConnected: vi.fn(async () => true),
  deleteFromDrive: vi.fn(async () => {}),
  downloadDriveToFile: vi.fn(async () => {}),
}));
vi.mock('fs/promises', () => ({
  default: { stat: vi.fn(async () => ({ size: 100 })), unlink: vi.fn(async () => {}) },
}));
vi.mock('../ai-assistant/ai-assistant.service', () => ({
  transcribeAudioFile: vi.fn(async () => ({ text: 'Менеджер: Здравствуйте. Клиент: Нужна бумага.' })),
  analyzeSalesCallTranscript: vi.fn(async () => ({ auditId: 'audit-new', score: 8 })),
}));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    messages = { create: (...args: unknown[]) => state.claudeCreate(...args) };
  }
  return { default: Anthropic };
});
vi.mock('../../lib/config', () => ({
  config: { claude: { apiKey: 'test-key', model: 'test-model' }, jwt: { accessSecret: 's' }, mobile: {}, telegram: {} },
  isSupabaseConfigured: false,
}));

import { buildReportPrompt, callsWord, createGroupReport, deleteCalls, processCallReports, reassignCalls, requestAnalysis } from './calls.manage';
import { drainAudioQueue } from './mobile.audio-queue';
import { listCalls } from './calls.service';
import { analyzeSalesCallTranscript, transcribeAudioFile } from '../ai-assistant/ai-assistant.service';
import { removeFiles } from './mobile.storage';
import { deleteFromDrive } from './mobile.drive';

const boss = { userId: 'boss', role: 'SUPER_ADMIN', permissions: [] as string[] };
let seq = 0;

async function addCall(over: Record<string, unknown> = {}) {
  seq += 1;
  return state.fake.prisma.callSession.create({
    data: {
      provider: 'MOBILE',
      externalCallId: `mobile:m1:${seq}`,
      direction: 'INBOUND',
      status: 'COMPLETED',
      mobileType: 'in',
      managerUserId: 'm1',
      durationSec: 12,
      startedAt: new Date(`2026-10-03T0${seq % 10}:00:00Z`),
      phone: '+998901234567',
      recordingPath: `m1/2026/10/${seq}.m4a`,
      audioStatus: 'SKIPPED',
      audioError: 'Анализ не запускали',
      ...over,
    },
  });
}

beforeEach(() => {
  state.fake = createFakePrisma();
  state.settings = { autoAuditEnabled: false, minAuditDurationSec: 30 };
  state.claimQueue = [];
  // Атомарный захват записи в очереди: отдаём по одной, как UPDATE … RETURNING
  state.fake.prisma.$queryRaw = vi.fn(async () => {
    const id = state.claimQueue.shift();
    if (!id) return [];
    const row = state.fake.db.callSession.find((c: any) => c.id === id);
    Object.assign(row, { audioStatus: 'TRANSCRIBING', audioAttempts: row.audioAttempts + 1 });
    return [{ id }];
  });
  state.claudeCreate = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '## Общая картина\nВсё хорошо' }] }));
  vi.mocked(transcribeAudioFile).mockClear();
  vi.mocked(analyzeSalesCallTranscript).mockClear();
  vi.mocked(removeFiles).mockClear();
  vi.mocked(deleteFromDrive).mockClear();
});

describe('анализ по выбору', () => {
  it('ставит в очередь только звонки с записью и без готового аудита', async () => {
    const a = await addCall();
    const b = await addCall({ recordingPath: null });
    const c = await addCall({ auditId: 'done', audioStatus: 'ANALYZED' });
    const res = await requestAnalysis(boss, [a.id, b.id, c.id]);
    expect(res).toEqual({ queued: 1, alreadyDone: 1, noRecording: 1, inProgress: 0 });
    expect(state.fake.db.callSession[0]).toMatchObject({ analysisRequest: 'AUDIT', audioStatus: 'UPLOADED', audioAttempts: 0, analysisRequestedById: 'boss' });
  });

  it('постоянный анализ выключен — без запроса запись не разбирается и денег не тратит', async () => {
    const a = await addCall({ audioStatus: 'UPLOADED', durationSec: 300 });
    state.claimQueue.push(a.id);
    await drainAudioQueue();
    expect(transcribeAudioFile).not.toHaveBeenCalled();
    expect(state.fake.db.callSession[0]).toMatchObject({ audioStatus: 'SKIPPED', audioError: 'Анализ не запускали' });
  });

  it('ручной запрос разбирает даже короткий звонок при выключенном постоянном анализе', async () => {
    const a = await addCall({ durationSec: 12 });
    await requestAnalysis(boss, [a.id]);
    state.claimQueue.push(a.id);
    await drainAudioQueue();
    expect(transcribeAudioFile).toHaveBeenCalledTimes(1);
    expect(analyzeSalesCallTranscript).toHaveBeenCalledTimes(1);
    expect(state.fake.db.callSession[0]).toMatchObject({ audioStatus: 'ANALYZED', auditId: 'audit-new', analysisRequest: null });
  });

  it('для общего анализа — только расшифровка, без отдельного аудита', async () => {
    const a = await addCall();
    await requestAnalysis(boss, [a.id], 'TRANSCRIPT');
    state.claimQueue.push(a.id);
    await drainAudioQueue();
    expect(transcribeAudioFile).toHaveBeenCalledTimes(1);
    expect(analyzeSalesCallTranscript).not.toHaveBeenCalled();
    expect(state.fake.db.callSession[0]).toMatchObject({ audioStatus: 'TRANSCRIBED', analysisRequest: null });
  });
});

describe('смена менеджера', () => {
  it('переписывает звонки, их аудиты и открытые задачи на выбранного сотрудника', async () => {
    state.fake.db.user.push({ id: 'm2', fullName: 'Фарход Алиев', isActive: true });
    const a = await addCall({ auditId: 'au1' });
    state.fake.db.callAudit.push({ id: 'au1', managerId: 'm1', managerName: 'Дилноза' });
    state.fake.db.task.push(
      { id: 't1', callSessionId: a.id, assigneeId: 'm1', status: 'TODO' },
      { id: 't2', callSessionId: a.id, assigneeId: 'm1', status: 'DONE' },
    );
    const res = await reassignCalls([a.id], 'm2');
    expect(res).toEqual({ updated: 1, managerName: 'Фарход Алиев' });
    expect(state.fake.db.callSession[0].managerUserId).toBe('m2');
    expect(state.fake.db.callAudit[0]).toMatchObject({ managerId: 'm2', managerName: 'Фарход Алиев' });
    expect(state.fake.db.task.map((t: any) => t.assigneeId)).toEqual(['m2', 'm1']);
  });

  it('неактивный сотрудник — 404', async () => {
    const a = await addCall();
    state.fake.db.user.push({ id: 'gone', fullName: 'Уволен', isActive: false });
    await expect(reassignCalls([a.id], 'gone')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('удаление', () => {
  it('стирает записи и аудит, прячет звонок из журнала, но строку оставляет', async () => {
    const a = await addCall({ auditId: 'au1', transcript: 'личный разговор' });
    await addCall();
    state.fake.db.callRecording.push({ id: 'r1', callSessionId: a.id, storagePath: 'm1/x.m4a', driveFileId: 'drive-1' });
    state.fake.db.callAudit.push({ id: 'au1' });
    state.fake.db.task.push({ id: 't1', callSessionId: a.id, assigneeId: 'm1', status: 'TODO' });

    expect(await deleteCalls(boss, [a.id])).toEqual({ deleted: 1 });
    expect(removeFiles).toHaveBeenCalledWith(['m1/x.m4a']);
    expect(deleteFromDrive).toHaveBeenCalledWith('drive-1');
    expect(state.fake.db.callAudit).toHaveLength(0);
    expect(state.fake.db.task).toHaveLength(0);
    expect(state.fake.db.callSession[0]).toMatchObject({ transcript: null, recordingPath: null, deletedById: 'boss' });
    expect(state.fake.db.callSession[0].deletedAt).toBeInstanceOf(Date);

    const list = await listCalls(boss, { page: 1, pageSize: 30 });
    expect(list.totalCount).toBe(1);
  });
});

describe('общий анализ по выбранным', () => {
  it('ждёт расшифровок, затем один запрос к Claude и сохраняет отчёт', async () => {
    const a = await addCall();
    const b = await addCall({ transcript: 'Менеджер: Добрый день. Клиент: Сколько стоит ламинация?' });
    const c = await addCall({ recordingPath: null });

    const report = await createGroupReport(boss, [a.id, b.id, c.id]);
    expect(report.title).toMatch(/^Общий анализ: 2 звонка, /);
    expect(state.fake.db.callGroupReport[0].callIds).toEqual([a.id, b.id]);
    expect(state.fake.db.callSession[0]).toMatchObject({ analysisRequest: 'TRANSCRIPT', audioStatus: 'UPLOADED' });

    // Первый звонок ещё не расшифрован — Claude не вызываем
    await processCallReports();
    expect(state.claudeCreate).not.toHaveBeenCalled();

    state.claimQueue.push(a.id);
    await drainAudioQueue();
    await processCallReports();
    expect(state.claudeCreate).toHaveBeenCalledTimes(1);
    const req = state.claudeCreate.mock.calls[0][0];
    expect(req.model).toBe('test-model');
    expect(req.messages[0].content).toContain('### Звонок 2');
    expect(state.fake.db.callGroupReport[0]).toMatchObject({ status: 'DONE', result: '## Общая картина\nВсё хорошо' });
  });

  it('ошибка Claude — отчёт FAILED с причиной', async () => {
    const a = await addCall({ transcript: 'Менеджер: Алло.' });
    await createGroupReport(boss, [a.id]);
    state.claudeCreate = vi.fn(async () => { throw new Error('overloaded'); });
    await processCallReports();
    expect(state.fake.db.callGroupReport[0]).toMatchObject({ status: 'FAILED', error: 'overloaded' });
  });

  it('звонки без записей — 400', async () => {
    const a = await addCall({ recordingPath: null });
    await expect(createGroupReport(boss, [a.id])).rejects.toMatchObject({ statusCode: 400 });
  });

  it('склонение «звонок»', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 101].map(callsWord)).toEqual([
      '1 звонок', '2 звонка', '5 звонков', '11 звонков', '12 звонков', '21 звонок', '22 звонка', '25 звонков', '101 звонок',
    ]);
  });

  it('длинная расшифровка сокращается с пометкой, а не молча', () => {
    const prompt = buildReportPrompt([{
      id: 'x', startedAt: new Date('2026-10-03T09:25:00Z'), durationSec: 600, mobileType: 'out', phone: '+998901234567',
      transcript: 'а'.repeat(7000), audioError: null, manager: { fullName: 'Дилноза' }, client: null, auditId: null,
    }], new Map());
    expect(prompt).toContain('### Звонок 1 — 03.10 14:25, Исходящий, 10:00');
    expect(prompt).toContain('расшифровка сокращена: показаны первые 6000 знаков из 7000');
  });
});
