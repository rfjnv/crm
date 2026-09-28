import type { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * На кого оформить сделку, которую создаёт этот сотрудник.
 *
 * Руководитель иногда заводит сделки за менеджера — у пользователя есть настройка
 * `dealsOwnerId`, и такие сделки сразу ложатся на указанного менеджера, а не на
 * создателя. Если получатель деактивирован, сделка остаётся на создателе: иначе она
 * повиснет на человеке, который её уже не увидит. Кто на самом деле создал сделку,
 * видно в журнале действий.
 */
export async function resolveDealOwnerId(
  creatorId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string> {
  const creator = await db.user.findUnique({
    where: { id: creatorId },
    select: { dealsOwner: { select: { id: true, isActive: true } } },
  });
  const owner = creator?.dealsOwner;
  return owner?.isActive ? owner.id : creatorId;
}
