import { z } from 'zod';

const siteTypeEnum = z.enum(['FACTORY', 'WAREHOUSE', 'PORT', 'OFFICE', 'OTHER']);

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

export const createSupplierSiteDto = z.object({
  supplierId: z.string().uuid(),
  name: z.string().min(1).max(255),
  siteType: siteTypeEnum.optional().default('FACTORY'),
  address: z.string().max(500).optional().nullable(),
  country: z.string().max(120).optional().nullable(),
  latitude: latSchema,
  longitude: lngSchema,
  notes: z.string().optional().nullable(),
});

export const updateSupplierSiteDto = createSupplierSiteDto
  .omit({ supplierId: true })
  .partial()
  .extend({
    supplierId: z.string().uuid().optional(),
  });

const routePointDto = z.object({
  siteId: z.string().uuid().optional().nullable(),
  label: z.string().max(255).optional().nullable(),
  latitude: latSchema,
  longitude: lngSchema,
});

export const createVedMapRouteDto = z.object({
  name: z.string().min(1).max(255),
  supplierId: z.string().uuid().optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  notes: z.string().optional().nullable(),
  points: z.array(routePointDto).min(2, 'Маршрут должен содержать минимум 2 точки'),
});

export const updateVedMapRouteDto = z.object({
  name: z.string().min(1).max(255).optional(),
  supplierId: z.string().uuid().optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  notes: z.string().optional().nullable(),
  points: z.array(routePointDto).min(2).optional(),
});

export type CreateSupplierSiteDto = z.infer<typeof createSupplierSiteDto>;
export type UpdateSupplierSiteDto = z.infer<typeof updateSupplierSiteDto>;
export type CreateVedMapRouteDto = z.infer<typeof createVedMapRouteDto>;
export type UpdateVedMapRouteDto = z.infer<typeof updateVedMapRouteDto>;
