import { z } from 'zod';

const currencyEnum = z.enum(['USD', 'EUR', 'CNY', 'RUB', 'UZS']);
const incotermsEnum = z.enum(['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP']);

export const createSupplierDto = z.object({
  companyName: z.string().min(1, 'Название компании обязательно').max(255),
  country: z.string().max(120).optional().nullable(),
  contactPerson: z.string().max(255).optional().nullable(),
  email: z.string().email('Некорректный email').optional().nullable().or(z.literal('').transform(() => null)),
  phone: z.string().max(50).optional().nullable(),
  currency: currencyEnum.optional().default('USD'),
  incoterms: incotermsEnum.optional().nullable(),
  paymentTerms: z.string().max(255).optional().nullable(),
  bankSwift: z.string().max(50).optional().nullable(),
  iban: z.string().max(64).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateSupplierDto = createSupplierDto.partial().extend({
  isArchived: z.boolean().optional(),
});

export type CreateSupplierDto = z.infer<typeof createSupplierDto>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierDto>;
