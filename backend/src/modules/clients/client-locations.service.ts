import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { AuthUser, clientOwnerScope } from '../../lib/scope';
import { auditLog } from '../../lib/logger';
import type { ClientLocationDto, UpdateClientLocationDto } from './clients.dto';

/** Какие поля точки отдаём наружу — и в карточку клиента, и в форму сделки. */
export const clientLocationSelect = {
  id: true,
  clientId: true,
  name: true,
  address: true,
  latitude: true,
  longitude: true,
  contactName: true,
  phone: true,
  notes: true,
  createdAt: true,
} satisfies Prisma.ClientLocationSelect;

/** Читать точки может любой, кому виден клиент: они нужны при оформлении сделки. */
async function assertClientVisible(clientId: string, user: AuthUser) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, ...clientOwnerScope(user) },
    select: { id: true, managerId: true },
  });
  if (!client) throw new AppError(404, 'Клиент не найден');
  return client;
}

/** Менять — те же, кто может править карточку клиента. */
async function assertClientEditable(clientId: string, user: AuthUser): Promise<void> {
  const client = await assertClientVisible(clientId, user);
  const isElevated = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  if (!isElevated && !user.permissions.includes('edit_client') && client.managerId !== user.userId) {
    throw new AppError(403, 'Недостаточно прав для редактирования клиента');
  }
}

/** '' из формы — стереть необязательное поле. */
function toData<T extends UpdateClientLocationDto>(dto: T) {
  const blank = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
  return {
    ...(dto.name !== undefined ? { name: dto.name } : {}),
    address: blank(dto.address),
    contactName: blank(dto.contactName),
    phone: blank(dto.phone),
    notes: blank(dto.notes),
    latitude: dto.latitude,
    longitude: dto.longitude,
  };
}

export class ClientLocationsService {
  async list(clientId: string, user: AuthUser) {
    await assertClientVisible(clientId, user);
    return prisma.clientLocation.findMany({
      where: { clientId },
      select: clientLocationSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(clientId: string, dto: ClientLocationDto, user: AuthUser) {
    await assertClientEditable(clientId, user);
    const location = await prisma.clientLocation.create({
      data: { clientId, ...toData(dto), name: dto.name },
      select: clientLocationSelect,
    });
    await auditLog({
      userId: user.userId,
      action: 'UPDATE_CLIENT',
      entityType: 'client',
      entityId: clientId,
      after: { locationAdded: { id: location.id, name: location.name, address: location.address } },
    });
    return location;
  }

  async update(clientId: string, locationId: string, dto: UpdateClientLocationDto, user: AuthUser) {
    await assertClientEditable(clientId, user);
    const before = await prisma.clientLocation.findFirst({ where: { id: locationId, clientId }, select: clientLocationSelect });
    if (!before) throw new AppError(404, 'Точка доставки не найдена');
    const location = await prisma.clientLocation.update({
      where: { id: locationId },
      data: toData(dto),
      select: clientLocationSelect,
    });
    await auditLog({
      userId: user.userId,
      action: 'UPDATE_CLIENT',
      entityType: 'client',
      entityId: clientId,
      before: { location: before },
      after: { location },
    });
    return location;
  }

  /** Сделки, которые ехали в эту точку, остаются — у них просто пропадает привязка (ON DELETE SET NULL). */
  async remove(clientId: string, locationId: string, user: AuthUser) {
    await assertClientEditable(clientId, user);
    const location = await prisma.clientLocation.findFirst({ where: { id: locationId, clientId }, select: clientLocationSelect });
    if (!location) throw new AppError(404, 'Точка доставки не найдена');
    await prisma.clientLocation.delete({ where: { id: locationId } });
    await auditLog({
      userId: user.userId,
      action: 'UPDATE_CLIENT',
      entityType: 'client',
      entityId: clientId,
      before: { locationRemoved: location },
    });
  }
}

export const clientLocationsService = new ClientLocationsService();
