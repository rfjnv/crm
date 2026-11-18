import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import prisma from '../../lib/prisma';
import {
  buildInnReconciliation,
  getLegalNames,
  lookupInn,
  lookupMissing,
  normalizeInn,
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

/**
 * Юр. название по одному ИНН — подсказка при вводе (всем сотрудникам).
 * Сначала реестр; если там нет — один запрос на orginfo.uz (не чаще раза в сутки на ИНН).
 */
router.get('/name/:inn', asyncHandler(async (req, res) => {
  const inn = normalizeInn(req.params.inn as string);
  if (!/^\d{9}$|^\d{14}$/.test(inn)) {
    res.json({ inn, legalName: null, status: 'bad_format' });
    return;
  }
  const known = await prisma.innRegistry.findUnique({ where: { inn } });
  if (known?.legalName) {
    res.json({ inn, legalName: known.legalName, status: 'found' });
    return;
  }
  const recentlyChecked = known?.lookedUpAt && Date.now() - known.lookedUpAt.getTime() < 24 * 3600 * 1000
    && known.lookupStatus === 'not_found';
  if (recentlyChecked) {
    res.json({ inn, legalName: null, status: 'not_found' });
    return;
  }
  const row = await lookupInn(inn).catch(() => null);
  res.json({ inn, legalName: row?.legalName ?? null, status: row?.legalName ? 'found' : (row?.lookupStatus ?? 'error') });
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
