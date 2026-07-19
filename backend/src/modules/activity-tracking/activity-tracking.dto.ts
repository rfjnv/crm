import { z } from 'zod';

export const reportActivityEventDto = z.object({
  type: z.enum(['PAGE_VIEW', 'HEARTBEAT']),
  path: z.string().min(1).max(300),
});

export type ReportActivityEventDto = z.infer<typeof reportActivityEventDto>;
