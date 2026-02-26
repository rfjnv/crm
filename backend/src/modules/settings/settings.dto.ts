import { z } from 'zod';

export const updateCompanySettingsDto = z.object({
  companyName: z.string().optional(),
  inn: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  mfo: z.string().optional(),
  director: z.string().optional(),
});

export type UpdateCompanySettingsDto = z.infer<typeof updateCompanySettingsDto>;
