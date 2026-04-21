import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { AppError } from '../../lib/errors';
import {
  listMyEditRequestsQueryDto,
  listNotesBoardQueryDto,
  createNotesBoardDto,
  requestNotesBoardEditDto,
  updateNotesBoardDto,
} from './notes-board.dto';
import { notesBoardService } from './notes-board.service';

const router = Router();

router.use(authenticate);

function assertAccess(role: Role) {
  if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR'].includes(role)) {
    throw new AppError(403, 'Недостаточно прав');
  }
}

function assertAdmin(role: Role) {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
    throw new AppError(403, 'Доступно только администраторам');
  }
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const query = listNotesBoardQueryDto.parse(req.query);
    const data = await notesBoardService.list(query);
    res.json(data);
  }),
);

router.post(
  '/',
  validate(createNotesBoardDto),
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const row = await notesBoardService.create(req.body, {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    });
    res.status(201).json(row);
  }),
);

router.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response) => {
    assertAdmin(req.user!.role as Role);
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const data = await notesBoardService.stats({ from, to });
    res.json(data);
  }),
);

router.get(
  '/edit-requests/mine',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const q = listMyEditRequestsQueryDto.parse(req.query);
    const data = await notesBoardService.listMyRequests(
      {
        userId: req.user!.userId,
        role: req.user!.role as Role,
        permissions: req.user!.permissions || [],
      },
      q.page,
      q.pageSize,
    );
    res.json(data);
  }),
);

router.patch(
  '/:id',
  validate(updateNotesBoardDto),
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const row = await notesBoardService.update(req.params.id as string, req.body, {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    });
    res.json(row);
  }),
);

router.post(
  '/:id/edit-request',
  validate(requestNotesBoardEditDto),
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const row = await notesBoardService.requestEdit(req.params.id as string, req.body, {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    });
    res.json(row);
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const result = await notesBoardService.remove(req.params.id as string, {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    });
    res.json(result);
  }),
);

export default router;
