import { AppError } from '../../lib/errors';
import prisma from '../../lib/prisma';

export type TelephonyWebhookPayload = {
  eventType: 'ringing' | 'answered' | 'hangup' | 'recording_ready';
  externalCallId: string;
  direction?: 'INBOUND' | 'OUTBOUND' | 'INTERNAL';
  fromNumber?: string;
  toNumber?: string;
  extension?: string;
  managerUserId?: string;
  clientId?: string;
  startedAt?: string;
  answeredAt?: string;
  endedAt?: string;
  durationSec?: number;
  billSec?: number;
  recordingUrl?: string;
  recordingPath?: string;
  transcript?: string;
  rawEvent?: unknown;
};

function parseDateOrNow(value?: string): Date {
  if (!value) return new Date();
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return new Date();
  return dt;
}

function mapDirection(input?: string): 'INBOUND' | 'OUTBOUND' | 'INTERNAL' {
  if (input === 'OUTBOUND' || input === 'INTERNAL') return input;
  return 'INBOUND';
}

function mapStatus(eventType: TelephonyWebhookPayload['eventType'], billSec?: number) {
  if (eventType === 'ringing') return 'RINGING';
  if (eventType === 'answered') return 'ANSWERED';
  if (eventType === 'recording_ready') return undefined;
  if (eventType === 'hangup') {
    if (typeof billSec === 'number' && billSec > 0) return 'COMPLETED';
    return 'MISSED';
  }
  return undefined;
}

type UpsertResult = {
  id: string;
  externalCallId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export class TelephonyService {
  async ingestWebhook(payload: TelephonyWebhookPayload): Promise<UpsertResult> {
    if (!payload.externalCallId?.trim()) {
      throw new AppError(400, 'externalCallId обязателен');
    }

    const eventStatus = mapStatus(payload.eventType, payload.billSec);
    const startedAt = parseDateOrNow(payload.startedAt);
    const prismaAny = prisma as any;

    const existing = await prismaAny.callSession.findUnique({
      where: { externalCallId: payload.externalCallId.trim() },
      select: { id: true, rawEvents: true },
    });

    const nextRawEvents: unknown[] = Array.isArray(existing?.rawEvents) ? [...existing.rawEvents] : [];
    nextRawEvents.push({
      eventType: payload.eventType,
      at: new Date().toISOString(),
      payload: payload.rawEvent ?? payload,
    });

    const row = await prismaAny.callSession.upsert({
      where: { externalCallId: payload.externalCallId.trim() },
      create: {
        externalCallId: payload.externalCallId.trim(),
        direction: mapDirection(payload.direction),
        status: eventStatus ?? 'RINGING',
        fromNumber: payload.fromNumber?.trim() || null,
        toNumber: payload.toNumber?.trim() || null,
        managerUserId: payload.managerUserId?.trim() || null,
        clientId: payload.clientId?.trim() || null,
        startedAt,
        answeredAt: payload.answeredAt ? parseDateOrNow(payload.answeredAt) : null,
        endedAt: payload.endedAt ? parseDateOrNow(payload.endedAt) : null,
        durationSec: Number.isFinite(payload.durationSec) ? payload.durationSec : null,
        billSec: Number.isFinite(payload.billSec) ? payload.billSec : null,
        recordingUrl: payload.recordingUrl?.trim() || null,
        recordingPath: payload.recordingPath?.trim() || null,
        transcript: payload.transcript?.trim() || null,
        rawEvents: nextRawEvents,
      },
      update: {
        direction: mapDirection(payload.direction),
        ...(eventStatus ? { status: eventStatus } : {}),
        ...(payload.fromNumber !== undefined ? { fromNumber: payload.fromNumber?.trim() || null } : {}),
        ...(payload.toNumber !== undefined ? { toNumber: payload.toNumber?.trim() || null } : {}),
        ...(payload.managerUserId !== undefined ? { managerUserId: payload.managerUserId?.trim() || null } : {}),
        ...(payload.clientId !== undefined ? { clientId: payload.clientId?.trim() || null } : {}),
        ...(payload.answeredAt ? { answeredAt: parseDateOrNow(payload.answeredAt) } : {}),
        ...(payload.endedAt ? { endedAt: parseDateOrNow(payload.endedAt) } : {}),
        ...(Number.isFinite(payload.durationSec) ? { durationSec: payload.durationSec } : {}),
        ...(Number.isFinite(payload.billSec) ? { billSec: payload.billSec } : {}),
        ...(payload.recordingUrl !== undefined ? { recordingUrl: payload.recordingUrl?.trim() || null } : {}),
        ...(payload.recordingPath !== undefined ? { recordingPath: payload.recordingPath?.trim() || null } : {}),
        ...(payload.transcript !== undefined ? { transcript: payload.transcript?.trim() || null } : {}),
        rawEvents: nextRawEvents,
      },
      select: {
        id: true,
        externalCallId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return row;
  }
}

export const telephonyService = new TelephonyService();
