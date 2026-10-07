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

const updateDeliveryRouteDto = z.object({
  clientIds: z.array(z.string().uuid()).max(MAX_STOPS),
  startBase: z.enum(['WAREHOUSE', 'OFFICE']),
  roundtrip: z.boolean(),
});

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

/** Маршрут вместе с данными остановок: водителю нужен адрес и телефон без доступа к карточкам. */
async function loadRoute() {
  const route = await prisma.deliveryRoute.findUnique({ where: { id: ROUTE_ID } });
  const ids = route?.clientIds ?? [];
  const [clients, updatedBy] = await Promise.all([
    ids.length
      ? prisma.client.findMany({
        where: { id: { in: ids }, isArchived: false, latitude: { not: null }, longitude: { not: null } },
        select: {
          id: true, companyName: true, contactName: true, phone: true,
          address: true, latitude: true, longitude: true,
        },
      })
      : [],
    route?.updatedById
      ? prisma.user.findUnique({ where: { id: route.updatedById }, select: { fullName: true } })
      : null,
  ]);
  const byId = new Map(clients.map((c) => [c.id, c]));
  return {
    clientIds: ids,
    startBase: (route?.startBase === 'OFFICE' ? 'OFFICE' : 'WAREHOUSE') as 'WAREHOUSE' | 'OFFICE',
    roundtrip: route?.roundtrip ?? true,
    updatedAt: route?.updatedAt ?? null,
    updatedByName: updatedBy?.fullName ?? null,
    // Удалённые, архивные и клиенты без точки выпадают, порядок — как в маршруте
    stops: ids.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c),
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
    clientIds: [...new Set(dto.clientIds)],
    startBase: dto.startBase,
    roundtrip: dto.roundtrip,
    updatedById: req.user!.userId,
  };
  await prisma.deliveryRoute.upsert({ where: { id: ROUTE_ID }, create: { id: ROUTE_ID, ...data }, update: data });
  res.json(await loadRoute());
}));

export default router;
