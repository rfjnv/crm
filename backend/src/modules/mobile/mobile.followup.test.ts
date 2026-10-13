import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './__tests__/fakePrisma';

const state = vi.hoisted(() => ({ fake: null as any }));

vi.mock('../../lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, key) => state.fake.prisma[key] }),
}));
vi.mock('../telegram/telegram.service', () => ({ telegramService: { sendToUser: vi.fn(async () => {}) } }));
vi.mock('./mobile.settings', () => ({
  getMobileSettings: vi.fn(async () => ({ autoAuditEnabled: true, minAuditDurationSec: 30 })),
}));
vi.mock('./mobile.storage', () => ({ signedUrl: vi.fn(async () => 'https://signed') }));

import { processNewMobileCall } from './mobile.processing';
import { listCalls, missedToday } from './calls.service';
import { addServicePhone, resetServicePhoneCache, updateServicePhone } from './mobile.service-phones';
import { autoAnalysisSkipReason } from './mobile.auto-analysis';
import { telegramService } from '../telegram/telegram.service';

const NOW = new Date();
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const boss = { userId: 'boss', role: 'SUPER_ADMIN', permissions: [] as string[] };
let seq = 0;

type CallOver = Record<string, unknown>;
const missed = (over: CallOver = {}) => ({ direction: 'INBOUND', status: 'MISSED', mobileType: 'missed', durationSec: 0, ...over });
const unanswered = (over: CallOver = {}) => ({ direction: 'OUTBOUND', status: 'FAILED', mobileType: 'out_unanswered', durationSec: 0, ...over });
const outTalk = (over: CallOver = {}) => ({ direction: 'OUTBOUND', status: 'COMPLETED', mobileType: 'out', durationSec: 90, ...over });
const inTalk = (over: CallOver = {}) => ({ direction: 'INBOUND', status: 'COMPLETED', mobileType: 'in', durationSec: 60, ...over });

/** Звонок «приходит с телефона»: запись + обработка, как в ingestCalls */
async function arrive(kind: CallOver, startedAt: Date, over: CallOver = {}) {
  seq += 1;
  const s = await state.fake.prisma.callSession.create({
    data: {
      provider: 'MOBILE',
      externalCallId: `mobile:m1:${seq}`,
      managerUserId: 'm1',
      phone: '+998901234567',
      phoneKey: '901234567',
      startedAt,
      ...kind,
      ...over,
    },
  });
  await processNewMobileCall(s, NOW);
  return state.fake.db.callSession.find((c: any) => c.id === s.id);
}

beforeEach(() => {
  state.fake = createFakePrisma();
  state.fake.db.user.push(
    { id: 'm1', fullName: 'Дилноза Каримова', isActive: true },
    { id: 'm2', fullName: 'Фарход Алиев', isActive: true },
  );
  resetServicePhoneCache();
  vi.mocked(telegramService.sendToUser).mockClear();
});

describe('кто перезвонил после несостоявшегося звонка', () => {
  it('пропущенный, потом исходящий разговор другого менеджера — «перезвонил менеджер»', async () => {
    const m = await arrive(missed(), minAgo(60));
    const back = await arrive(outTalk({ managerUserId: 'm2' }), minAgo(40));
    expect(m).toMatchObject({ followUpCallId: back.id, followUpDirection: 'OUTBOUND' });
    expect(m.followUpAt).toEqual(back.startedAt);
  });

  it('исходящий без ответа, потом клиент сам позвонил и поговорили — «клиент перезвонил»', async () => {
    const u = await arrive(unanswered(), minAgo(60));
    const back = await arrive(inTalk(), minAgo(30));
    expect(u).toMatchObject({ followUpCallId: back.id, followUpDirection: 'INBOUND' });
  });

  it('новый недозвон после пропущенного — ещё не «перезвонили»', async () => {
    const m = await arrive(missed(), minAgo(60));
    await arrive(unanswered(), minAgo(50));
    expect(m.followUpAt).toBeNull();
  });

  it('пачка не по порядку: разговор записан раньше пропущенного — связь всё равно есть', async () => {
    const back = await arrive(outTalk(), minAgo(20));
    const m = await arrive(missed(), minAgo(60));
    expect(m).toMatchObject({ followUpCallId: back.id, followUpDirection: 'OUTBOUND' });
  });

  it('берётся первый разговор после звонка, даже если пришёл позже', async () => {
    const m = await arrive(missed(), minAgo(60));
    await arrive(outTalk(), minAgo(10));
    const earlier = await arrive(inTalk(), minAgo(30));
    expect(m).toMatchObject({ followUpCallId: earlier.id, followUpDirection: 'INBOUND' });
  });

  it('другой номер — не в счёт', async () => {
    const m = await arrive(missed(), minAgo(60));
    await arrive(outTalk({ phone: '+998911111111', phoneKey: '911111111' }), minAgo(30));
    expect(m.followUpAt).toBeNull();
  });
});

describe('служебные номера', () => {
  it('добавить: номер в любом виде, дубль — 409, короткий — 400', async () => {
    const row = await addServicePhone('boss', { phone: '90 123 45 67', name: 'Склад — Бахтиёр' });
    expect(row).toMatchObject({ phone: '+998 90 123 45 67', name: 'Склад — Бахтиёр' });
    expect(state.fake.db.servicePhone[0].phoneKey).toBe('901234567');
    await expect(addServicePhone('boss', { phone: '+998901234567', name: 'ещё раз' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(addServicePhone('boss', { phone: '1050', name: 'короткий' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('пропущенный со служебного номера — без Telegram и без клиента', async () => {
    state.fake.db.client.push({ id: 'c1', phone: '+998 90 123 45 67', managerId: 'm1', companyName: 'Print House', isArchived: false });
    await addServicePhone('boss', { phone: '+998901234567', name: 'Склад' });
    const m = await arrive(missed({ startedAt: minAgo(5) }), minAgo(5));
    expect(state.fake.db.task).toHaveLength(0);
    expect(telegramService.sendToUser).not.toHaveBeenCalled();
    expect(m.clientId).toBeNull();
  });

  it('служебный номер не идёт в автоматический анализ', async () => {
    await addServicePhone('boss', { phone: '+998901234567', name: 'Склад' });
    await expect(autoAnalysisSkipReason({ durationSec: 300, phoneKey: '901234567' })).resolves.toMatch(/Служебный номер/);
    await expect(autoAnalysisSkipReason({ durationSec: 300, phoneKey: '912223344' })).resolves.toBeNull();
  });
});

describe('фильтры журнала', () => {
  beforeEach(async () => {
    // 901234567: пропущенный → менеджер перезвонил; 912223344: недозвон → клиент перезвонил;
    // 935556677: пропущенный, никто не перезвонил; 977778899 — склад
    await arrive(missed(), minAgo(90));
    await arrive(outTalk({ managerUserId: 'm2' }), minAgo(80));
    await arrive(unanswered({ phone: '+998912223344', phoneKey: '912223344' }), minAgo(70));
    await arrive(inTalk({ phone: '+998912223344', phoneKey: '912223344' }), minAgo(60));
    await arrive(missed({ phone: '+998935556677', phoneKey: '935556677' }), minAgo(50));
    await arrive(missed({ phone: '+998977778899', phoneKey: '977778899' }), minAgo(40));
    await addServicePhone('boss', { phone: '+998977778899', name: 'Склад — Бахтиёр' });
  });

  const phones = (r: { items: { phone: string | null }[] }) => r.items.map((i) => i.phone);

  it('«Не перезвонили» — только без последующего разговора и без служебных', async () => {
    const r = await listCalls(boss, { page: 1, pageSize: 30, outcome: 'none' });
    expect(phones(r)).toEqual(['+998935556677']);
  });

  it('«Перезвонил менеджер» и «Клиент перезвонил»', async () => {
    const byManager = await listCalls(boss, { page: 1, pageSize: 30, outcome: 'manager' });
    expect(phones(byManager)).toEqual(['+998901234567']);
    expect(byManager.items[0].followUp).toMatchObject({ by: 'manager', managerName: 'Фарход Алиев' });
    const byClient = await listCalls(boss, { page: 1, pageSize: 30, outcome: 'client' });
    expect(phones(byClient)).toEqual(['+998912223344']);
    expect(byClient.items[0].followUp).toMatchObject({ by: 'client', managerName: 'Дилноза Каримова' });
  });

  it('служебные: только они, без них, и «Неизвестные» их не включают', async () => {
    const only = await listCalls(boss, { page: 1, pageSize: 30, numbers: 'service' });
    expect(phones(only)).toEqual(['+998977778899']);
    expect(only.items[0].service).toMatchObject({ name: 'Склад — Бахтиёр' });
    const without = await listCalls(boss, { page: 1, pageSize: 30, numbers: 'clients' });
    expect(without.totalCount).toBe(5);
    const unknown = await listCalls(boss, { page: 1, pageSize: 30, unknownOnly: true });
    expect(phones(unknown)).not.toContain('+998977778899');
  });

  it('по длительности', async () => {
    const r = await listCalls(boss, { page: 1, pageSize: 30, minDuration: 61 });
    expect(r.items.map((i) => i.durationSec)).toEqual([90]);
  });

  it('пропущенные сегодня — без служебных', async () => {
    const r = await missedToday(boss, NOW);
    expect(r.items.map((i) => i.phone)).not.toContain('+998977778899');
  });
});

describe('служебные номера: сотрудник CRM и правка', () => {
  it('выбран сотрудник, подпись не написана — подпись = его ФИО', async () => {
    const row = await addServicePhone('boss', { phone: '+998977778899', userId: 'm2' });
    expect(row).toMatchObject({ name: 'Фарход Алиев' });
    expect(state.fake.db.servicePhone[0].userId).toBe('m2');
  });

  it('не сотрудник CRM и без подписи — 400; несуществующий сотрудник — 404', async () => {
    await expect(addServicePhone('boss', { phone: '+998977778899' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(addServicePhone('boss', { phone: '+998977778899', userId: 'nobody', name: 'Склад' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('исправить подпись и номер: звонки с новым номером сразу служебные', async () => {
    const row = await addServicePhone('boss', { phone: '+998977778899', name: 'Склад — Бахтияр' });
    await arrive(missed({ phone: '+998935556677', phoneKey: '935556677' }), minAgo(10));
    const fixed = await updateServicePhone(row!.id, { name: 'Склад — Бахтиёр', phone: '93 555 66 77' });
    expect(fixed).toMatchObject({ name: 'Склад — Бахтиёр', phone: '+998 93 555 66 77' });
    const r = await listCalls(boss, { page: 1, pageSize: 30, numbers: 'service' });
    expect(r.items.map((i) => i.phone)).toEqual(['+998935556677']);
  });

  it('новый номер уже есть в списке — 409', async () => {
    await addServicePhone('boss', { phone: '+998977778899', name: 'Склад' });
    const other = await addServicePhone('boss', { phone: '+998935556677', name: 'Курьер' });
    await expect(updateServicePhone(other!.id, { phone: '+998977778899' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('привязать к сотруднику без подписи — подпись меняется на ФИО, отвязать — подпись остаётся', async () => {
    const row = await addServicePhone('boss', { phone: '+998977778899', name: 'Склад' });
    expect(await updateServicePhone(row!.id, { userId: 'm1' })).toMatchObject({ name: 'Дилноза Каримова' });
    await updateServicePhone(row!.id, { userId: null });
    expect(state.fake.db.servicePhone[0]).toMatchObject({ userId: null, name: 'Дилноза Каримова' });
  });
});
