import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './__tests__/fakePrisma';

const state = vi.hoisted(() => ({ fake: null as any }));

vi.mock('../../lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, key) => state.fake.prisma[key] }),
}));
vi.mock('../telegram/telegram.service', () => ({ telegramService: { sendToUser: vi.fn(async () => {}) } }));

import { findClientByPhone, processNewMobileCall } from './mobile.processing';
import { telegramService } from '../telegram/telegram.service';

const NOW = new Date('2026-10-03T10:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

let seq = 0;
async function addCall(over: Record<string, unknown>) {
  seq += 1;
  return state.fake.prisma.callSession.create({
    data: {
      provider: 'MOBILE',
      externalCallId: `mobile:m1:${seq}`,
      direction: 'INBOUND',
      status: 'MISSED',
      managerUserId: 'm1',
      phone: '+998901234567',
      phoneKey: '901234567',
      mobileType: 'missed',
      durationSec: 0,
      startedAt: minutesAgo(30),
      ...over,
    },
  });
}

beforeEach(() => {
  state.fake = createFakePrisma();
  vi.mocked(telegramService.sendToUser).mockClear();
});

describe('поиск клиента по номеру', () => {
  it.each([
    '+998 90 123 45 67',
    '901234567',
    '998901234567',
    '(90) 123-45-67',
    '+998 91 222 33 44, +998 90 123 45 67',
    '91 222 33 44 / 90 123 45 67',
  ])('номер в поле клиента «%s» находится по E.164', async (phone) => {
    state.fake.db.client.push({ id: 'c1', phone, managerId: 'm1', companyName: 'Print House', isArchived: false });
    const match = await findClientByPhone('901234567', 'm1');
    expect(match.client?.id).toBe('c1');
  });

  it('не путает номер с номером, где эти цифры — часть другого', async () => {
    state.fake.db.client.push({ id: 'c1', phone: '+998 90 123 45 678', managerId: 'm1', companyName: 'X', isArchived: false });
    expect((await findClientByPhone('901234567', 'm1')).client).toBeNull();
  });

  it('архивный клиент не находится', async () => {
    state.fake.db.client.push({ id: 'c1', phone: '+998 90 123 45 67', managerId: 'm1', companyName: 'X', isArchived: true });
    expect((await findClientByPhone('901234567', 'm1')).client).toBeNull();
  });

  it('номер у нескольких клиентов — берётся клиент этого менеджера', async () => {
    state.fake.db.client.push(
      { id: 'c1', phone: '+998 90 123 45 67', managerId: 'm2', companyName: 'A', isArchived: false },
      { id: 'c2', phone: '+998 90 123 45 67', managerId: 'm1', companyName: 'B', isArchived: false },
    );
    expect((await findClientByPhone('901234567', 'm1')).client?.id).toBe('c2');
  });

  it('несколько чужих клиентов — никого, причина пишется в rawEvents', async () => {
    state.fake.db.client.push(
      { id: 'c1', phone: '+998 90 123 45 67', managerId: 'm2', companyName: 'A', isArchived: false },
      { id: 'c2', phone: '+998 90 123 45 67', managerId: 'm3', companyName: 'B', isArchived: false },
    );
    const s = await addCall({ mobileType: 'in', status: 'COMPLETED', durationSec: 60 });
    await processNewMobileCall(s, NOW);
    const row = state.fake.db.callSession[0];
    expect(row.clientId).toBeNull();
    expect(row.rawEvents.at(-1)).toMatchObject({ event: 'client_match', result: 'ambiguous', clientIds: ['c1', 'c2'] });
  });

  it('неизвестный номер — клиент не создаётся', async () => {
    const s = await addCall({});
    await processNewMobileCall(s, NOW);
    expect(state.fake.db.client).toHaveLength(0);
    expect(state.fake.db.callSession[0].clientId).toBeNull();
  });
});

describe('пропущенный звонок', () => {
  it('задача не ставится — только сообщение менеджеру в Telegram', async () => {
    state.fake.db.client.push({ id: 'c1', phone: '+998 90 123 45 67', managerId: 'm1', companyName: 'Print House', isArchived: false });
    const s = await addCall({ startedAt: minutesAgo(10) });
    await processNewMobileCall(s, NOW);

    expect(state.fake.db.callSession[0].clientId).toBe('c1');
    expect(state.fake.db.task).toHaveLength(0);
    expect(telegramService.sendToUser).toHaveBeenCalledWith('m1', expect.objectContaining({
      title: 'Пропущенный звонок',
      url: `/calls?call=${s.id}`,
      body: expect.stringContaining('Print House'),
    }));
  });

  it('rejected тоже сообщает, blocked и voicemail — нет', async () => {
    await processNewMobileCall(await addCall({ mobileType: 'blocked' }), NOW);
    await processNewMobileCall(await addCall({ mobileType: 'voicemail', phone: '+998911111111', phoneKey: '911111111' }), NOW);
    expect(telegramService.sendToUser).not.toHaveBeenCalled();
    await processNewMobileCall(await addCall({ mobileType: 'rejected' }), NOW);
    expect(telegramService.sendToUser).toHaveBeenCalledTimes(1);
    expect(state.fake.db.task).toHaveLength(0);
  });

  it('пачка не по порядку: пропущенный пришёл после разговора — без сообщения', async () => {
    await addCall({ mobileType: 'out', direction: 'OUTBOUND', status: 'COMPLETED', durationSec: 60, startedAt: minutesAgo(20) });
    await processNewMobileCall(await addCall({ startedAt: minutesAgo(40) }), NOW);
    expect(telegramService.sendToUser).not.toHaveBeenCalled();
  });

  it('старый пропущенный из импорта истории — без сообщения', async () => {
    await processNewMobileCall(await addCall({ startedAt: minutesAgo(3 * 24 * 60) }), NOW);
    expect(telegramService.sendToUser).not.toHaveBeenCalled();
  });
});

describe('задача «перезвонить», поставленная вручную', () => {
  async function manualTask(callId: string, assigneeId = 'm1') {
    state.fake.db.task.push({ id: `t-${callId}`, title: 'Перезвонить: Print House', status: 'TODO', assigneeId, callSessionId: callId });
  }

  it('исходящий разговор с этим номером закрывает её и отмечает пропущенный отработанным', async () => {
    const missed = await addCall({ startedAt: minutesAgo(40) });
    await processNewMobileCall(missed, NOW);
    await manualTask(missed.id);
    const out = await addCall({ mobileType: 'out', direction: 'OUTBOUND', status: 'COMPLETED', durationSec: 95, startedAt: minutesAgo(20) });
    await processNewMobileCall(out, NOW);

    expect(state.fake.db.task[0].status).toBe('DONE');
    expect(state.fake.db.callSession.find((c: any) => c.id === missed.id).calledBackAt).toEqual(out.startedAt);
  });

  it('недозвон (длительность 0) не закрывает, разговор другого менеджера — закрывает', async () => {
    const missed = await addCall({ startedAt: minutesAgo(40) });
    await processNewMobileCall(missed, NOW);
    await manualTask(missed.id);
    await processNewMobileCall(await addCall({ mobileType: 'out_unanswered', direction: 'OUTBOUND', status: 'FAILED', startedAt: minutesAgo(30) }), NOW);
    expect(state.fake.db.task[0].status).toBe('TODO');
    await processNewMobileCall(await addCall({ managerUserId: 'm2', mobileType: 'out', direction: 'OUTBOUND', status: 'COMPLETED', durationSec: 60, startedAt: minutesAgo(20) }), NOW);
    expect(state.fake.db.task[0].status).toBe('DONE');
  });
});
