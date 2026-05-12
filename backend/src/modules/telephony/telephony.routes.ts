import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { config } from '../../lib/config';
import { telephonyService, type TelephonyWebhookPayload } from './telephony.service';

const router = Router();

function assertWebhookAccess(req: Request): void {
  if (!config.telephony.enabled) {
    throw new AppError(503, 'Telephony integration disabled');
  }

  const expected = config.telephony.webhookSecret;
  if (!expected) {
    throw new AppError(503, 'TELEPHONY_WEBHOOK_SECRET is not configured');
  }

  const provided = String(req.header('x-telephony-secret') || '');
  if (!provided) {
    throw new AppError(401, 'Invalid telephony secret');
  }

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.alloc(expectedBuf.length);
  providedBuf.write(provided.slice(0, expectedBuf.length));
  if (!timingSafeEqual(expectedBuf, providedBuf) || provided.length !== expected.length) {
    throw new AppError(401, 'Invalid telephony secret');
  }
}

function parsePayload(body: unknown): TelephonyWebhookPayload {
  const payload = (body ?? {}) as Record<string, unknown>;
  return {
    eventType: String(payload.eventType || '').toLowerCase() as TelephonyWebhookPayload['eventType'],
    externalCallId: String(payload.externalCallId || payload.uniqueid || ''),
    direction: payload.direction as TelephonyWebhookPayload['direction'],
    fromNumber: typeof payload.fromNumber === 'string' ? payload.fromNumber : undefined,
    toNumber: typeof payload.toNumber === 'string' ? payload.toNumber : undefined,
    extension: typeof payload.extension === 'string' ? payload.extension : undefined,
    managerUserId: typeof payload.managerUserId === 'string' ? payload.managerUserId : undefined,
    clientId: typeof payload.clientId === 'string' ? payload.clientId : undefined,
    startedAt: typeof payload.startedAt === 'string' ? payload.startedAt : undefined,
    answeredAt: typeof payload.answeredAt === 'string' ? payload.answeredAt : undefined,
    endedAt: typeof payload.endedAt === 'string' ? payload.endedAt : undefined,
    durationSec: typeof payload.durationSec === 'number' ? payload.durationSec : undefined,
    billSec: typeof payload.billSec === 'number' ? payload.billSec : undefined,
    recordingUrl: typeof payload.recordingUrl === 'string' ? payload.recordingUrl : undefined,
    recordingPath: typeof payload.recordingPath === 'string' ? payload.recordingPath : undefined,
    transcript: typeof payload.transcript === 'string' ? payload.transcript : undefined,
    rawEvent: payload,
  };
}

router.post(
  '/webhook/asterisk',
  asyncHandler(async (req: Request, res: Response) => {
    assertWebhookAccess(req);
    const payload = parsePayload(req.body);
    const supportedEventTypes = new Set(['ringing', 'answered', 'hangup', 'recording_ready']);
    if (!supportedEventTypes.has(payload.eventType)) {
      throw new AppError(400, 'Unsupported eventType');
    }
    const saved = await telephonyService.ingestWebhook(payload);
    res.json({ ok: true, call: saved });
  }),
);

export default router;
