import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { formatUzPhone } from '../../lib/phone';
import { callPhoneKey } from './mobile.mapping';

/**
 * Служебные номера: склад, сотрудники, курьеры. Звонки с ними — не клиенты и не «неизвестные»:
 * по ним не ставятся задачи «перезвонить», не идёт автоматический анализ, а в журнале их
 * можно скрыть. Список маленький и нужен на каждом звонке — держим его в памяти минуту.
 */

export interface ServicePhoneInfo {
  id: string;
  name: string;
}

const CACHE_MS = 60_000;
let cache: { map: Map<string, ServicePhoneInfo>; at: number } | null = null;

export async function servicePhoneMap(): Promise<Map<string, ServicePhoneInfo>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  const rows = await prisma.servicePhone.findMany({ select: { id: true, phoneKey: true, name: true } });
  const map = new Map(rows.map((r) => [r.phoneKey, { id: r.id, name: r.name }]));
  cache = { map, at: Date.now() };
  return map;
}

export function resetServicePhoneCache(): void {
  cache = null;
}

export async function isServicePhone(phoneKey: string | null | undefined): Promise<boolean> {
  return !!phoneKey && (await servicePhoneMap()).has(phoneKey);
}

/** Условие «номер не служебный». Скрытые номера (phoneKey null) — тоже не служебные. */
export async function notServiceWhere(): Promise<Prisma.CallSessionWhereInput> {
  const keys = [...(await servicePhoneMap()).keys()];
  if (keys.length === 0) return {};
  return { OR: [{ phoneKey: null }, { phoneKey: { notIn: keys } }] };
}

export async function onlyServiceWhere(): Promise<Prisma.CallSessionWhereInput> {
  return { phoneKey: { in: [...(await servicePhoneMap()).keys()] } };
}

export async function listServicePhones() {
  return prisma.servicePhone.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, phone: true, name: true, note: true, createdAt: true, createdBy: { select: { fullName: true } } },
  });
}

export async function addServicePhone(userId: string, data: { phone: string; name: string; note?: string }) {
  const phoneKey = callPhoneKey(data.phone);
  if (!phoneKey) throw new AppError(400, 'Номер слишком короткий — нужен полный номер телефона');
  try {
    const row = await prisma.servicePhone.create({
      data: {
        phone: formatUzPhone(data.phone) ?? data.phone.trim(),
        phoneKey,
        name: data.name.trim(),
        note: data.note?.trim() || null,
        createdById: userId,
      },
      select: { id: true, phone: true, name: true, note: true },
    });
    resetServicePhoneCache();
    return row;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'Этот номер уже в списке служебных');
    }
    throw err;
  }
}

export async function removeServicePhone(id: string) {
  const { count } = await prisma.servicePhone.deleteMany({ where: { id } });
  if (count === 0) throw new AppError(404, 'Номер не найден');
  resetServicePhoneCache();
}
