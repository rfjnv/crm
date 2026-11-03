import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { authenticate } from '../../middleware/authenticate';
import { canSeeAllHrCalls, canUseHrCalls } from './mobile.access';
import { callbackTaskDto, listCallsQuery, parseOr400 } from './mobile.dto';
import { deleteCalls } from './calls.manage';
import {
  createCallbackTask,
  getAudioUrl,
  getCall,
  listCalls,
  markCalledBack,
  missedToday,
  phoneHistory,
} from './calls.service';
import { hrSummary } from './hr-calls.summary';

/**
 * /api/hr-calls — «Звонки HR»: телефон HR (кандидаты, сотрудники). Отдельный поток: в журнал
 * продаж, KPI, аналитику и РОП-агента эти звонки не попадают. Видят: сама HR — свои,
 * директор и сотрудники с правом view_hr_calls — все. ADMIN и РОП — нет (без права).
 * Запись слушается через тот же поток /api/calls/:id/audio-stream — по токену, который
 * выдаёт только audio-url отсюда, после проверки доступа.
 */
const router = Router();

function requireHrCalls(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user || !canUseHrCalls(req.user)) {
    next(new AppError(403, 'Нет доступа к звонкам HR'));
    return;
  }
  next();
}

router.use(authenticate, requireHrCalls);

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listCalls(req.user!, parseOr400(listCallsQuery, req.query), 'HR'));
}));

/** Сводка сверху раздела: со сколькими поговорила, минуты, пропущенные. Период — как в фильтре, по умолчанию сегодня */
router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
  const q = parseOr400(listCallsQuery, req.query);
  res.json(await hrSummary(req.user!, { from: q.from, to: q.to }));
}));

/** Пропущенные за сегодня — виджет на главной у HR */
router.get('/missed', asyncHandler(async (req: Request, res: Response) => {
  res.json(await missedToday(req.user!, new Date(), 'HR'));
}));

/** Удалить звонки HR — директор и с правом view_hr_calls */
router.post('/delete', asyncHandler(async (req: Request, res: Response) => {
  if (!canSeeAllHrCalls(req.user!)) throw new AppError(403, 'Удалять звонки HR может директор');
  const dto = parseOr400(z.object({ callIds: z.array(z.string().min(1)).min(1, 'Выберите звонки').max(200) }), req.body);
  res.json(await deleteCalls(req.user!, dto.callIds, 'HR'));
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCall(req.user!, String(req.params.id), 'HR'));
}));

router.get('/:id/history', asyncHandler(async (req: Request, res: Response) => {
  res.json(await phoneHistory(req.user!, String(req.params.id), 'HR'));
}));

router.get('/:id/audio-url', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getAudioUrl(req.user!, String(req.params.id), `${req.protocol}://${req.get('host')}`, 'HR'));
}));

router.post('/:id/callback-task', asyncHandler(async (req: Request, res: Response) => {
  res.json(await createCallbackTask(req.user!, String(req.params.id), parseOr400(callbackTaskDto, req.body) ?? {}, 'HR'));
}));

router.post('/:id/called-back', asyncHandler(async (req: Request, res: Response) => {
  res.json(await markCalledBack(req.user!, String(req.params.id), 'HR'));
}));

export default router;
