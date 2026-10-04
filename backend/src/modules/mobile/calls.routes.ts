import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Readable } from 'stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { downloadFromDrive } from './mobile.drive';
import { authenticate } from '../../middleware/authenticate';
import { authenticateDevice } from './mobile.device-auth';
import { callbackTaskDto, linkClientDto, listCallsQuery, parseOr400 } from './mobile.dto';
import { ingestCalls, MAX_AUDIO_BYTES, receiveAudio } from './mobile.service';
import { removeTempUpload, singleFileUpload } from './mobile.upload';
import {
  clientCalls,
  createCallbackTask,
  getAudioUrl,
  getCall,
  linkClient,
  listCalls,
  markCalledBack,
  missedToday,
  verifyAudioStreamToken,
} from './calls.service';

/** /api/calls — приём звонков с телефона (токен устройства) и журнал звонков в CRM (JWT). */
const router = Router();

// ─── Телефон ────────────────────────────────────────────────────────────────

router.post('/', authenticateDevice, asyncHandler(async (req: Request, res: Response) => {
  res.json(await ingestCalls(req.device!, req.body));
}));

router.post('/unmatched-audio', authenticateDevice, singleFileUpload('file', MAX_AUDIO_BYTES), asyncHandler(async (req: Request, res: Response) => {
  try {
    const out = await receiveAudio(req.device!, req.file, req.body, req.header('x-audio-sha256'), null);
    res.status(out.status).json(out.body);
  } finally {
    await removeTempUpload(req);
  }
}));

router.post('/:id/audio', authenticateDevice, singleFileUpload('file', MAX_AUDIO_BYTES), asyncHandler(async (req: Request, res: Response) => {
  try {
    const out = await receiveAudio(req.device!, req.file, req.body, req.header('x-audio-sha256'), String(req.params.id));
    res.status(out.status).json(out.body);
  } finally {
    await removeTempUpload(req);
  }
}));

// ─── CRM ────────────────────────────────────────────────────────────────────

router.get('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  res.json(await listCalls(req.user!, parseOr400(listCallsQuery, req.query)));
}));

router.get('/missed', authenticate, asyncHandler(async (req: Request, res: Response) => {
  res.json(await missedToday(req.user!));
}));

router.get('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCall(req.user!, String(req.params.id)));
}));

router.get('/:id/audio-url', authenticate, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getAudioUrl(req.user!, String(req.params.id), `${req.protocol}://${req.get('host')}`));
}));

/** Запись с Google Drive для плеера. Без JWT CRM: доступ по токену из audio-url (на час). */
router.get('/:id/audio-stream', asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  verifyAudioStreamToken(String(req.query.t ?? ''), id);
  const call = await prisma.callSession.findUnique({ where: { id }, select: { driveFileId: true } });
  if (!call?.driveFileId) throw new AppError(404, 'Записи на Google Drive нет');

  const upstream = await downloadFromDrive(call.driveFileId, req.header('range') ?? undefined);
  if (!upstream.ok || !upstream.body) throw new AppError(502, `Google Drive не отдал запись (${upstream.status})`);
  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('cache-control', 'private, max-age=3600');
  // Плеер CRM живёт на другом домене, общий helmet иначе запретит встраивание
  res.setHeader('cross-origin-resource-policy', 'cross-origin');
  Readable.fromWeb(upstream.body as unknown as NodeReadableStream).pipe(res);
}));

router.post('/:id/link-client', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const dto = parseOr400(linkClientDto, req.body);
  res.json(await linkClient(req.user!, String(req.params.id), dto.clientId, dto.savePhone));
}));

router.post('/:id/callback-task', authenticate, asyncHandler(async (req: Request, res: Response) => {
  res.json(await createCallbackTask(req.user!, String(req.params.id), parseOr400(callbackTaskDto, req.body) ?? {}));
}));

router.post('/:id/called-back', authenticate, asyncHandler(async (req: Request, res: Response) => {
  res.json(await markCalledBack(req.user!, String(req.params.id)));
}));

export default router;

// ─── /api/clients/:id/calls ─────────────────────────────────────────────────

const clientCallsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const clientCallsRouter = Router();

clientCallsRouter.get('/:id/calls', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const q = parseOr400(clientCallsQuery, req.query);
  res.json(await clientCalls(req.user!, String(req.params.id), q.page, q.pageSize));
}));
