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
  vatRegCode: z.string().optional(),
  oked: z.string().optional(),
  monthlyRevenueGoal: z.coerce.number().min(0).optional(),
  dailyRevenueGoal: z.coerce.number().min(0).nullable().optional(),
  balanceStartDate: z.coerce.date().nullable().optional(),
  initialBalance: z.coerce.number().min(0).optional(),
  officeAddress: z.string().nullable().optional(),
  officeLatitude: z.number().min(-90).max(90).nullable().optional(),
  officeLongitude: z.number().min(-180).max(180).nullable().optional(),
  warehouseAddress: z.string().nullable().optional(),
  warehouseLatitude: z.number().min(-90).max(90).nullable().optional(),
  warehouseLongitude: z.number().min(-180).max(180).nullable().optional(),
});

export type UpdateCompanySettingsDto = z.infer<typeof updateCompanySettingsDto>;
