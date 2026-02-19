import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { createTaskDto, updateTaskDto, moveTaskDto } from './tasks.dto';

import { config } from '../../lib/config';

const router = Router();

// ──── Multer config ────
const uploadsDir = path.resolve(config.uploads.dir);
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${sanitized}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

router.use(authenticate);

// ──── Common include for task queries ────
const taskInclude = {
  assignee: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  attachments: true,
  _count: { select: { attachments: true } },
};

// ──── LIST ────
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const assigneeId = req.query.assigneeId as string | undefined;
    const status = req.query.status as string | undefined;
    const createdById = req.query.createdById as string | undefined;

    const where: Record<string, unknown> = {};
    if (assigneeId) where.assigneeId = assigneeId;
    if (status) where.status = status;
    if (createdById) where.createdById = createdById;

    const tasks = await prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: { createdAt: 'desc' },
    });

    res.json(tasks);
  }),
);

// ──── CREATE ────
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const data = createTaskDto.parse(req.body);

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        assigneeId: data.assigneeId,
        createdById: req.user!.userId,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      },
      include: taskInclude,
    });

    res.status(201).json(task);
  }),
);

// ──── UPDATE (title, description, dueDate) ────
router.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const data = updateTaskDto.parse(req.body);

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Задача не найдена');

    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    }

    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: taskInclude,
    });

    res.json(task);
  }),
);

// ──── MOVE STATUS ────
router.patch(
  '/:id/status',
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { status, report } = moveTaskDto.parse(req.body);
    const role = req.user!.role as Role;

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Задача не найдена');

    const from = existing.status;
    const to = status;

    // Validate allowed transitions
    const allowedTransitions: Record<string, string[]> = {
      TODO: ['IN_PROGRESS'],
      IN_PROGRESS: ['TODO', 'DONE'],
      DONE: ['IN_PROGRESS', 'APPROVED'],
      APPROVED: [],
    };

    if (!allowedTransitions[from]?.includes(to)) {
      throw new AppError(400, `Нельзя перевести задачу из "${from}" в "${to}"`);
    }

    // DONE requires report
    if (to === 'DONE') {
      const finalReport = report || existing.report;
      if (!finalReport || finalReport.trim().length === 0) {
        throw new AppError(400, 'Для завершения задачи необходимо заполнить отчёт');
      }
    }

    // APPROVED only by ADMIN or SUPER_ADMIN
    if (to === 'APPROVED') {
      if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) {
        throw new AppError(403, 'Только администратор может одобрять задачи');
      }
    }

    const updateData: Record<string, unknown> = { status: to };

    if (report !== undefined) {
      updateData.report = report;
    }

    if (to === 'APPROVED') {
      updateData.approvedById = req.user!.userId;
      updateData.approvedAt = new Date();
    }

    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: taskInclude,
    });

    res.json(task);
  }),
);

// ──── SET REPORT ────
router.patch(
  '/:id/report',
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { report } = req.body;

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Задача не найдена');

    const task = await prisma.task.update({
      where: { id },
      data: { report },
      include: taskInclude,
    });

    res.json(task);
  }),
);

// ──── UPLOAD ATTACHMENT ────
router.post(
  '/:id/attachments',
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Задача не найдена');

    if (!req.file) throw new AppError(400, 'Файл не загружен');

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId: id,
        filename: req.file.originalname,
        path: req.file.path,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    });

    res.status(201).json(attachment);
  }),
);

// ──── DOWNLOAD ATTACHMENT ────
router.get(
  '/:id/attachments/:attachmentId',
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.params.id as string;
    const attachmentId = req.params.attachmentId as string;

    const attachment = await prisma.taskAttachment.findFirst({
      where: {
        id: attachmentId,
        taskId,
      },
    });

    if (!attachment) throw new AppError(404, 'Вложение не найдено');

    if (!fs.existsSync(attachment.path)) {
      throw new AppError(404, 'Файл не найден на диске');
    }

    res.download(attachment.path, attachment.filename);
  }),
);

// ──── DELETE ────
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const role = req.user!.role as Role;

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Задача не найдена');

    // Only creator or ADMIN/SUPER_ADMIN can delete
    const isCreator = existing.createdById === req.user!.userId;
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(role);

    if (!isCreator && !isAdmin) {
      throw new AppError(403, 'Недостаточно прав для удаления задачи');
    }

    await prisma.task.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

export default router;
