import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
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
  res.json(await getAudioUrl(req.user!, String(req.params.id)));
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
