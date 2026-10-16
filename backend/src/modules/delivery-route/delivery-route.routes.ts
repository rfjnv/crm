import { Router, Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';

const ROUTE_ID = 'current';
/** В одном запросе к сервису дорог — до 100 точек, две уходят на склад/офис. */
const MAX_STOPS = 98;
/** Кто везёт или собирает отгрузку — видят маршрут, хотя карточки клиентов им закрыты. */
const SHIPPING_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE', 'DRIVER', 'LOADER'];

const updateDeliveryRouteDto = z.preprocess(
  // Вкладки, открытые до обновления, ещё шлют прежнее поле clientIds
  (v) => (v && typeof v === 'object' && !('stopIds' in v) && 'clientIds' in v
    ? { ...v, stopIds: (v as { clientIds: unknown }).clientIds }
    : v),
  z.object({
    /** id клиентов (основной адрес) и/или их точек доставки, по порядку объезда */
    stopIds: z.array(z.string().uuid()).max(MAX_STOPS),
    startBase: z.enum(['WAREHOUSE', 'OFFICE']),
    roundtrip: z.boolean(),
  }),
);

const markDeliveredDto = z.object({ delivered: z.boolean() });

export interface DeliveredMark {
  at: string;
  byId: string;
  byName: string;
}

function canEdit(req: Request): boolean {
  return req.user!.role === 'SUPER_ADMIN' || (req.user!.permissions ?? []).includes('view_all_clients');
}

function requireView(req: Request, _res: Response, next: NextFunction): void {
  if (canEdit(req) || SHIPPING_ROLES.includes(req.user!.role as Role)) return next();
  throw new AppError(403, 'Недостаточно прав');
}

function requireEdit(req: Request, _res: Response, next: NextFunction): void {
  if (canEdit(req)) return next();
  throw new AppError(403, 'Маршрут меняют менеджеры на карте клиентов');
}

/**
 * Остановка — id клиента (едем на его основной адрес) или id его точки ClientLocation (филиал).
 * Оба — uuid, поэтому в одном списке не пересекаются.
 */
async function resolveStops(ids: string[]) {
  if (!ids.length) return [];
  const [clients, locations] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: ids }, isArchived: false, latitude: { not: null }, longitude: { not: null } },
      select: {
        id: true, companyName: true, contactName: true, phone: true,
        address: true, latitude: true, longitude: true,
      },
    }),
    prisma.clientLocation.findMany({
      where: { id: { in: ids }, client: { isArchived: false }, latitude: { not: null }, longitude: { not: null } },
      select: {
        id: true, name: true, address: true, latitude: true, longitude: true, contactName: true, phone: true,
        client: { select: { id: true, companyName: true, contactName: true, phone: true } },
      },
    }),
  ]);
  const byId = new Map<string, {
    id: string; clientId: string; locationName: string | null; companyName: string; contactName: string;
    phone: string | null; address: string | null; latitude: number; longitude: number;
  }>();
  for (const c of clients) {
    byId.set(c.id, { ...c, clientId: c.id, locationName: null, latitude: c.latitude!, longitude: c.longitude! });
  }
  for (const l of locations) {
    byId.set(l.id, {
      id: l.id,
      clientId: l.client.id,
      locationName: l.name,
      companyName: l.client.companyName,
      // На филиале свой человек и телефон; если не указаны — те, что в карточке клиента
      contactName: l.contactName || l.client.contactName,
      phone: l.phone || l.client.phone,
      address: l.address,
      latitude: l.latitude!,
      longitude: l.longitude!,
    });
  }
  // Удалённые, архивные и точки без координат выпадают, порядок — как в маршруте
  return ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
}

/** Маршрут вместе с данными остановок: водителю нужен адрес и телефон без доступа к карточкам. */
async function loadRoute() {
  const route = await prisma.deliveryRoute.findUnique({ where: { id: ROUTE_ID } });
  const ids = route?.clientIds ?? [];
  const [stops, updatedBy] = await Promise.all([
    resolveStops(ids),
    route?.updatedById
      ? prisma.user.findUnique({ where: { id: route.updatedById }, select: { fullName: true } })
      : null,
  ]);
  return {
    stopIds: ids,
    startBase: (route?.startBase === 'OFFICE' ? 'OFFICE' : 'WAREHOUSE') as 'WAREHOUSE' | 'OFFICE',
    roundtrip: route?.roundtrip ?? true,
    updatedAt: route?.updatedAt ?? null,
    updatedByName: updatedBy?.fullName ?? null,
    delivered: (route?.delivered ?? {}) as unknown as Record<string, DeliveredMark>,
    stops,
  };
}

const router = Router();
router.use(authenticate);

router.get('/', requireView, asyncHandler(async (_req, res) => {
  res.json(await loadRoute());
}));

router.put('/', requireEdit, validate(updateDeliveryRouteDto), asyncHandler(async (req, res) => {
  const dto = req.body as z.infer<typeof updateDeliveryRouteDto>;
  const data = {
    clientIds: [...new Set(dto.stopIds)],
    startBase: dto.startBase,
    roundtrip: dto.roundtrip,
    updatedById: req.user!.userId,
  };
  await prisma.$transaction([
    prisma.deliveryRoute.upsert({ where: { id: ROUTE_ID }, create: { id: ROUTE_ID, ...data }, update: data }),
    // Убранные из маршрута остановки забирают с собой и отметку «доставлено»
    prisma.$executeRaw`
      UPDATE delivery_routes
      SET delivered = COALESCE(
        (SELECT jsonb_object_agg(key, value) FROM jsonb_each(delivered) WHERE key = ANY(client_ids)),
        '{}'::jsonb)
      WHERE id = ${ROUTE_ID}`,
  ]);
  res.json(await loadRoute());
}));

/** Водитель отмечает остановку доставленной (или снимает отметку, если ошибся). */
router.post('/stops/:stopId/delivered', requireView, validate(markDeliveredDto), asyncHandler(async (req, res) => {
  const stopId = req.params.stopId as string;
  const { delivered } = req.body as z.infer<typeof markDeliveredDto>;
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { fullName: true } });
  const mark: DeliveredMark = { at: new Date().toISOString(), byId: req.user!.userId, byName: user?.fullName ?? '' };
  // Точечно в jsonb, чтобы одновременные отметки и правки маршрута не затирали друг друга
  const updated = delivered
    ? await prisma.$executeRaw`
      UPDATE delivery_routes
      SET delivered = delivered || jsonb_build_object(${stopId}::text, ${JSON.stringify(mark)}::jsonb)
      WHERE id = ${ROUTE_ID} AND ${stopId} = ANY(client_ids)`
    : await prisma.$executeRaw`
      UPDATE delivery_routes SET delivered = delivered - ${stopId}::text
      WHERE id = ${ROUTE_ID} AND ${stopId} = ANY(client_ids)`;
  if (updated === 0) throw new AppError(404, 'Этой остановки уже нет в маршруте');
  res.json(await loadRoute());
}));

export default router;
