import { z } from 'zod';

export const reportActivityEventDto = z.object({
  type: z.enum(['PAGE_VIEW', 'HEARTBEAT']),
  path: z.string().min(1).max(300),
});

/** Пачка событий: фронт копит их и шлёт раз в ~15 с, а не запросом на каждый переход. */
export const reportActivityBatchDto = z.object({
  events: z
    .array(reportActivityEventDto.extend({ at: z.string().datetime().optional() }))
    .min(1)
    .max(100),
});

/** Старые вкладки (до обновления фронта) ещё шлют по одному событию. */
export const reportActivityDto = z.union([reportActivityBatchDto, reportActivityEventDto]);

export type ReportActivityEventDto = z.infer<typeof reportActivityEventDto>;
export type ReportActivityBatchDto = z.infer<typeof reportActivityBatchDto>;
