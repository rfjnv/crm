import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import type { AuthUser } from '../../lib/scope';
import { releaseDealAfterDocs, syncDealTelegramGroupMessages } from '../telegram/telegram-deal-groups.service';

/**
 * Сделка на перечисление: бухгалтер отмечает, что документы (счёт-фактура и т.п.) готовы.
 * До отметки сделка не попадает в группы производства и отгрузки; после — уходит туда.
 * Отметку можно снять: тогда посты в этих группах снимаются снова.
 */
export async function setDealDocsReady(dealId: string, ready: boolean, user: AuthUser) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, title: true, paymentMethod: true, managerId: true, docsReadyAt: true },
  });
  if (!deal) throw new AppError(404, 'Сделка не найдена');
  if (deal.paymentMethod !== 'TRANSFER') {
    throw new AppError(400, 'Отметка о документах — только для сделок на перечисление');
  }
  if (!!deal.docsReadyAt === ready) {
    return { docsReadyAt: deal.docsReadyAt };
  }

  const docsReadyAt = ready ? new Date() : null;
  await prisma.deal.update({
    where: { id: dealId },
    data: { docsReadyAt, docsReadyById: ready ? user.userId : null },
  });

  await auditLog({
    userId: user.userId,
    action: 'UPDATE',
    entityType: 'deal',
    entityId: dealId,
    before: { docsReady: !ready },
    after: { docsReady: ready },
  });

  if (ready && deal.managerId !== user.userId) {
    await prisma.notification.create({
      data: {
        userId: deal.managerId,
        title: 'Документы по сделке готовы',
        body: `«${deal.title}»: бухгалтерия сделала документы`,
        severity: 'INFO',
        link: `/deals/${dealId}`,
        createdByUserId: user.userId,
      },
    }).catch((err) => console.error('[deals] docs-ready notify:', err));
  }

  void (ready ? releaseDealAfterDocs(dealId) : syncDealTelegramGroupMessages(dealId)).catch((err) => {
    console.error('[Telegram deal groups] docs-ready sync:', err);
  });

  return { docsReadyAt };
}
