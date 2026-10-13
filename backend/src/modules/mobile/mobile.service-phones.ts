import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { formatUzPhone } from '../../lib/phone';
import { callPhoneKey } from './mobile.mapping';

/**
 * Служебные номера: склад, сотрудники, курьеры. Звонки с ними — не клиенты и не «неизвестные»:
 * по ним не приходят уведомления о пропущенных, не идёт автоматический анализ, а в журнале их
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

const servicePhoneSelect = {
  id: true,
  phone: true,
  name: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, fullName: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.ServicePhoneSelect;

export async function listServicePhones() {
  return prisma.servicePhone.findMany({ orderBy: { name: 'asc' }, select: servicePhoneSelect });
}

export interface ServicePhoneInput {
  phone: string;
  /** Подпись. Можно не писать, если выбран сотрудник CRM — тогда его ФИО */
  name?: string;
  note?: string;
  /** Сотрудник CRM, чей это номер; null — не сотрудник CRM */
  userId?: string | null;
}

/** Номер → «+998 …» и ключ для сравнения со звонками */
function normalizePhone(raw: string): { phone: string; phoneKey: string } {
  const phoneKey = callPhoneKey(raw);
  if (!phoneKey) throw new AppError(400, 'Номер слишком короткий — нужен полный номер телефона');
  return { phone: formatUzPhone(raw) ?? raw.trim(), phoneKey };
}

async function employeeName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  if (!user) throw new AppError(404, 'Сотрудник не найден');
  return user.fullName;
}

function rethrowDuplicate(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new AppError(409, 'Этот номер уже в списке служебных');
  }
  throw err;
}

export async function addServicePhone(createdById: string, data: ServicePhoneInput) {
  const { phone, phoneKey } = normalizePhone(data.phone);
  const fullName = data.userId ? await employeeName(data.userId) : null;
  const name = data.name?.trim() || fullName;
  if (!name) throw new AppError(400, 'Выберите сотрудника или напишите, чей это номер');
  try {
    const row = await prisma.servicePhone.create({
      data: { phone, phoneKey, name, note: data.note?.trim() || null, userId: data.userId || null, createdById },
      select: servicePhoneSelect,
    });
    resetServicePhoneCache();
    return row;
  } catch (err) {
    rethrowDuplicate(err);
  }
}

/** Исправить номер, подпись, заметку или сотрудника. Звонки с новым номером станут служебными сразу. */
export async function updateServicePhone(id: string, data: Partial<ServicePhoneInput>) {
  const current = await prisma.servicePhone.findUnique({ where: { id }, select: { id: true } });
  if (!current) throw new AppError(404, 'Номер не найден');
  const update: Prisma.ServicePhoneUncheckedUpdateInput = {};
  if (data.phone !== undefined) Object.assign(update, normalizePhone(data.phone));
  if (data.userId !== undefined) update.userId = data.userId || null;
  const fullName = data.userId ? await employeeName(data.userId) : null;
  if (data.name !== undefined) {
    const name = data.name.trim() || fullName;
    if (!name) throw new AppError(400, 'Выберите сотрудника или напишите, чей это номер');
    update.name = name;
  } else if (fullName) {
    update.name = fullName;
  }
  if (data.note !== undefined) update.note = data.note.trim() || null;
  try {
    const row = await prisma.servicePhone.update({ where: { id }, data: update, select: servicePhoneSelect });
    resetServicePhoneCache();
    return row;
  } catch (err) {
    rethrowDuplicate(err);
  }
}

export async function removeServicePhone(id: string) {
  const { count } = await prisma.servicePhone.deleteMany({ where: { id } });
  if (count === 0) throw new AppError(404, 'Номер не найден');
  resetServicePhoneCache();
}
