import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import {
  buildInnReconciliation,
  getLegalNames,
  lookupInn,
  lookupMissing,
  setLegalName,
} from './inn-registry.service';

const router = Router();
router.use(authenticate);

/** Юр. названия для списка ИНН (подсказки в сделках) — всем сотрудникам. */
router.get('/names', asyncHandler(async (req, res) => {
  const raw = String(req.query.inn ?? '');
  const inns = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  res.json(await getLegalNames(inns));
}));

router.get('/', authorize('SUPER_ADMIN', 'ADMIN'), asyncHandler(async (_req, res) => {
  res.json(await buildInnReconciliation());
}));

const setNameDto = z.object({ legalName: z.string().max(500).nullable() });

router.put('/:inn', authorize('SUPER_ADMIN', 'ADMIN'), asyncHandler(async (req, res) => {
  const parsed = setNameDto.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'Неверные данные');
  res.json(await setLegalName(req.params.inn as string, parsed.data.legalName));
}));

router.post('/:inn/lookup', authorize('SUPER_ADMIN', 'ADMIN'), asyncHandler(async (req, res) => {
  res.json(await lookupInn(req.params.inn as string, { overwriteManual: req.query.overwrite === '1' }));
}));

router.post('/lookup-missing', authorize('SUPER_ADMIN', 'ADMIN'), asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.body?.limit) || 20, 1), 40);
  res.json(await lookupMissing(limit));
}));

export default router;
