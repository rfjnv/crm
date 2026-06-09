import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import {
  generateNoteAudit,
  generateNoteAuditForAll,
  tashkentWeekRange,
} from './note-audit.service';

export const noteAuditRoutes = Router();
noteAuditRoutes.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJsonArray(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeReport(r: {
  id: string;
  managerId: string;
  manager: { fullName: string; role: string };
  periodStart: Date;
  periodEnd: Date;
  scoreSpecificity: number;
  scoreFollowUp: number;
  scoreNextStep: number;
  scoreTone: number;
  scoreOverall: number;
  summary: string;
  feedbackSpecificity: string;
  feedbackFollowUp: string;
  feedbackNextStep: string;
  feedbackTone: string;
  goodExamples: unknown;
  badExamples: unknown;
  notesCount: number;
  status: string;
  errorMessage: string | null;
  isCorrected: boolean;
  correctedById: string | null;
  correctedBy: { fullName: string } | null;
  correctedAt: Date | null;
  correctionReason: string | null;
  correctedScoreSpecificity: number | null;
  correctedScoreFollowUp: number | null;
  correctedScoreNextStep: number | null;
  correctedScoreTone: number | null;
  correctedScoreOverall: number | null;
  correctedSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    managerId: r.managerId,
    managerName: r.manager.fullName,
    managerRole: r.manager.role,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    scoreSpecificity: r.scoreSpecificity,
    scoreFollowUp: r.scoreFollowUp,
    scoreNextStep: r.scoreNextStep,
    scoreTone: r.scoreTone,
    scoreOverall: r.scoreOverall,
    summary: r.summary,
    feedbackSpecificity: r.feedbackSpecificity,
    feedbackFollowUp: r.feedbackFollowUp,
    feedbackNextStep: r.feedbackNextStep,
    feedbackTone: r.feedbackTone,
    goodExamples: safeParseJsonArray(r.goodExamples),
    badExamples: safeParseJsonArray(r.badExamples),
    notesCount: r.notesCount,
    status: r.status,
    errorMessage: r.errorMessage,
    isCorrected: r.isCorrected,
    correctedById: r.correctedById,
    correctedByName: r.correctedBy?.fullName ?? null,
    correctedAt: r.correctedAt,
    correctionReason: r.correctionReason,
    correctedScoreSpecificity: r.correctedScoreSpecificity,
    correctedScoreFollowUp: r.correctedScoreFollowUp,
    correctedScoreNextStep: r.correctedScoreNextStep,
    correctedScoreTone: r.correctedScoreTone,
    correctedScoreOverall: r.correctedScoreOverall,
    correctedSummary: r.correctedSummary,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const REPORT_INCLUDE = {
  manager: { select: { fullName: true, role: true } },
  correctedBy: { select: { fullName: true } },
};

// ─── POST /generate ───────────────────────────────────────────────────────────

const generateSchema = z.object({
  managerId: z.string().optional(),
  weekOffset: z.number().int().default(-1),
});

noteAuditRoutes.post(
  '/generate',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = generateSchema.safeParse(req.body);
    if (!body.success) throw new AppError(400, 'Неверные параметры');
    const { managerId, weekOffset } = body.data;

    if (managerId) {
      const reportId = await generateNoteAudit(managerId, weekOffset);
      const report = await prisma.noteAuditReport.findUniqueOrThrow({
        where: { id: reportId },
        include: REPORT_INCLUDE,
      });
      res.json({ report: serializeReport(report as any) });
    } else {
      // All managers — run in background, return immediately
      generateNoteAuditForAll(weekOffset).catch((e) =>
        console.error('[NoteAudit] generateAll error:', e),
      );
      const { start, end } = tashkentWeekRange(weekOffset);
      res.json({
        message: 'Запуск анализа для всех менеджеров...',
        periodStart: start,
        periodEnd: end,
      });
    }
  }),
);

// ─── GET /reports ─────────────────────────────────────────────────────────────

noteAuditRoutes.get(
  '/reports',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const weekOffset = req.query.weekOffset !== undefined ? Number(req.query.weekOffset) : -1;
    const managerId = req.query.managerId ? String(req.query.managerId) : undefined;

    const { start, end } = tashkentWeekRange(weekOffset);

    const where: Record<string, unknown> = { periodStart: start, periodEnd: end };
    if (managerId) where.managerId = managerId;

    const reports = await prisma.noteAuditReport.findMany({
      where,
      include: REPORT_INCLUDE,
      orderBy: [{ scoreOverall: 'desc' }],
    });

    res.json({ reports: reports.map((r) => serializeReport(r as any)) });
  }),
);

// ─── GET /reports/:id ─────────────────────────────────────────────────────────

noteAuditRoutes.get(
  '/reports/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const report = await prisma.noteAuditReport.findUnique({
      where: { id: String(req.params.id) },
      include: REPORT_INCLUDE,
    });
    if (!report) throw new AppError(404, 'Отчёт не найден');
    res.json({ report: serializeReport(report as any) });
  }),
);

// ─── PATCH /reports/:id/correct ───────────────────────────────────────────────

const correctSchema = z.object({
  correctionReason: z.string().min(1, 'Укажите причину корректировки'),
  correctedScoreSpecificity: z.number().min(0).max(10).optional(),
  correctedScoreFollowUp: z.number().min(0).max(10).optional(),
  correctedScoreNextStep: z.number().min(0).max(10).optional(),
  correctedScoreTone: z.number().min(0).max(10).optional(),
  correctedSummary: z.string().optional(),
  saveAsMemory: z.boolean().default(true),
  memoryScope: z.enum(['manager', 'global']).default('manager'),
});

noteAuditRoutes.patch(
  '/reports/:id/correct',
  authorize('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const body = correctSchema.safeParse(req.body);
    if (!body.success) {
      throw new AppError(400, body.error.errors[0]?.message ?? 'Неверные параметры');
    }

    const report = await prisma.noteAuditReport.findUnique({ where: { id: String(req.params.id) } });
    if (!report) throw new AppError(404, 'Отчёт не найден');

    const {
      correctionReason,
      correctedScoreSpecificity,
      correctedScoreFollowUp,
      correctedScoreNextStep,
      correctedScoreTone,
      correctedSummary,
      saveAsMemory,
      memoryScope,
    } = body.data;

    // Compute corrected overall
    const sp = correctedScoreSpecificity ?? report.scoreSpecificity;
    const fu = correctedScoreFollowUp ?? report.scoreFollowUp;
    const ns = correctedScoreNextStep ?? report.scoreNextStep;
    const to = correctedScoreTone ?? report.scoreTone;
    const correctedScoreOverall = Math.round((sp * 0.3 + fu * 0.2 + ns * 0.3 + to * 0.2) * 10) / 10;

    const updated = await prisma.noteAuditReport.update({
      where: { id: String(req.params.id) },
      data: {
        isCorrected: true,
        correctedById: req.user!.userId,
        correctedAt: new Date(),
        correctionReason,
        correctedScoreSpecificity: correctedScoreSpecificity ?? null,
        correctedScoreFollowUp: correctedScoreFollowUp ?? null,
        correctedScoreNextStep: correctedScoreNextStep ?? null,
        correctedScoreTone: correctedScoreTone ?? null,
        correctedScoreOverall,
        correctedSummary: correctedSummary ?? null,
      },
      include: REPORT_INCLUDE,
    });

    // Optionally store as memory for future analyses
    if (saveAsMemory) {
      const managerName = (updated as any).manager.fullName;
      const contextLines: string[] = [
        `Корректировка для ${memoryScope === 'global' ? 'всех менеджеров' : `менеджера ${managerName}`}:`,
        `Причина: ${correctionReason}`,
      ];
      if (correctedScoreSpecificity !== undefined)
        contextLines.push(`• Конкретность: AI дал ${report.scoreSpecificity} → правильно ${correctedScoreSpecificity}`);
      if (correctedScoreFollowUp !== undefined)
        contextLines.push(`• Недозвоны: AI дал ${report.scoreFollowUp} → правильно ${correctedScoreFollowUp}`);
      if (correctedScoreNextStep !== undefined)
        contextLines.push(`• Следующий шаг: AI дал ${report.scoreNextStep} → правильно ${correctedScoreNextStep}`);
      if (correctedScoreTone !== undefined)
        contextLines.push(`• Тон: AI дал ${report.scoreTone} → правильно ${correctedScoreTone}`);
      if (correctedSummary)
        contextLines.push(`Правильная оценка: ${correctedSummary}`);

      await prisma.noteAuditMemory.create({
        data: {
          managerId: memoryScope === 'global' ? '*' : report.managerId,
          context: contextLines.join('\n'),
          createdById: req.user!.userId,
        },
      });
    }

    res.json({ report: serializeReport(updated as any) });
  }),
);

// ─── GET /memory ──────────────────────────────────────────────────────────────

noteAuditRoutes.get(
  '/memory',
  authorize('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const managerId = req.query.managerId ? String(req.query.managerId) : undefined;

    const memories = await prisma.noteAuditMemory.findMany({
      where: managerId ? { managerId: { in: [managerId, '*'] } } : {},
      include: {
        createdBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      memories: memories.map((m) => ({
        id: m.id,
        managerId: m.managerId,
        context: m.context,
        createdById: m.createdById,
        createdByName: (m as any).createdBy.fullName,
        createdAt: m.createdAt,
      })),
    });
  }),
);

// ─── DELETE /memory/:id ───────────────────────────────────────────────────────

noteAuditRoutes.delete(
  '/memory/:id',
  authorize('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const mem = await prisma.noteAuditMemory.findUnique({ where: { id: String(req.params.id) } });
    if (!mem) throw new AppError(404, 'Запись памяти не найдена');
    await prisma.noteAuditMemory.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  }),
);
