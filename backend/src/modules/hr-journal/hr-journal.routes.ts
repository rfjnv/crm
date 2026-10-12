import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { getHrJournal, type JournalType } from './hr-journal.service';

const router = Router();

router.use(authenticate);
// Журнал читает руководство — сама HR свои записи видит в разделах, где их оставила.
router.use(authorize('SUPER_ADMIN', 'ADMIN'));

const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
const TYPES: JournalType[] = ['attendance', 'review', 'staff', 'goal'];

/** YYYY-MM-DD по календарю Ташкента → момент начала этого дня. */
function dayStart(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new AppError(400, 'Некорректная дата (ожидается YYYY-MM-DD)');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - TASHKENT_OFFSET);
}

// GET /api/hr-journal?from=&to=&type=&employeeId=&authorId=&onlyHr=
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const to = q.to ? new Date(dayStart(q.to).getTime() + 86400000) : new Date();
    const from = q.from ? dayStart(q.from) : new Date(to.getTime() - 30 * 86400000);
    const type = q.type && TYPES.includes(q.type as JournalType) ? (q.type as JournalType) : undefined;
    res.json(await getHrJournal({
      from,
      to,
      type,
      employeeId: q.employeeId || undefined,
      authorId: q.authorId || undefined,
      onlyHr: q.onlyHr !== 'false',
    }));
  }),
);

export default router;
