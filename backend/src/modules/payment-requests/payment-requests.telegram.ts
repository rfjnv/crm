import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { telegramService } from '../telegram/telegram.service';
import { getLegalNames } from '../inn-registry/inn-registry.service';

/**
 * Пост заявки на оплату в группе финансов — туда же, куда приходят сделки «на проверку».
 * По перечислению бухгалтерии нужно сделать документы (счёт-фактуру), поэтому без поста
 * они узнавали о заявке только из уведомления в CRM. Когда бухгалтер решил, пост обновляется.
 */

const PAGE_LINK = '/finance/payment-requests';

const METHOD_LABEL: Record<string, string> = {
  TRANSFER: 'Перечисление',
  CASH: 'Наличные',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v: unknown) => Number(v ?? 0);
/** ИНН перечисления: указанный в заявке, иначе из сделки, иначе клиента. */
const innOf = (r: RequestForPost) =>
  r.transferInn?.trim() || r.deal?.transferInn?.trim() || r.client.inn?.trim() || null;
const sum = (v: unknown) => `${new Intl.NumberFormat('ru-RU').format(num(v))} сум`;
const qty = (v: unknown) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(num(v));
const day = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('.');
const dateTime = (d: Date) => d.toLocaleString('ru-RU', {
  timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

async function loadRequest(id: string) {
  return prisma.paymentRequest.findUnique({
    where: { id },
    include: {
      client: { select: { companyName: true, inn: true } },
      deal: { select: { title: true, transferInn: true } },
      createdBy: { select: { fullName: true } },
      decidedBy: { select: { fullName: true } },
      docsReadyBy: { select: { fullName: true } },
      items: { include: { product: { select: { name: true, sku: true, unit: true } } } },
    },
  });
}
type RequestForPost = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

async function legalNameOf(inn: string | null): Promise<string | null> {
  if (!inn) return null;
  try {
    return Object.values(await getLegalNames([inn]))[0] ?? null;
  } catch {
    return null;
  }
}

function statusLine(r: RequestForPost): string {
  switch (r.status) {
    case 'ACCEPTED':
      return `✅ <b>Оплата принята</b>${r.decidedBy ? `: ${esc(r.decidedBy.fullName)}` : ''}${r.paidAt ? `, дата оплаты ${day(r.paidAt)}` : ''}`;
    case 'REJECTED':
      return `❌ <b>Отклонена</b>${r.decidedBy ? `: ${esc(r.decidedBy.fullName)}` : ''}${r.decisionNote ? ` — ${esc(r.decisionNote)}` : ''}`;
    case 'CANCELED':
      return '↩️ <b>Отозвана менеджером</b>';
    default:
      if (r.method === 'TRANSFER' && r.docsReadyAt) {
        return `📄 <b>Документы готовы</b>${r.docsReadyBy ? `: ${esc(r.docsReadyBy.fullName)}` : ''} — ждём оплату`;
      }
      return r.method === 'TRANSFER' ? '⏳ <b>Ждёт документов от бухгалтерии</b>' : '⏳ <b>Ждёт бухгалтера</b>';
  }
}

export function buildPaymentRequestHtml(r: RequestForPost, legalName: string | null): string {
  const isTransfer = r.method === 'TRANSFER';
  const inn = innOf(r);
  const docs = r.transferDocuments ?? [];
  const items = r.items.map((i) =>
    `• ${esc(i.product.sku)} — ${qty(i.qty)} ${esc(i.product.unit)} × ${sum(i.price)} = <b>${sum(i.lineTotal)}</b>`);

  return [
    `🧾 <b>Заявка на оплату №${r.number}</b> — ${esc(METHOD_LABEL[r.method] ?? r.method)}`,
    ...(isTransfer
      ? [`Нужны документы: <b>${esc(docs.length ? docs.join(', ') : 'счёт-фактура')}</b>${r.transferType ? ` (${r.transferType === 'ANNUAL' ? 'годовой' : 'разовый'})` : ''}`]
      : []),
    '',
    `Клиент: <b>${esc(r.client.companyName)}</b>`,
    ...(isTransfer ? [`ИНН: <b>${esc(inn ?? '—')}</b>${legalName ? ` — ${esc(legalName)}` : ''}`] : []),
    r.deal ? `Сделка: <b>${esc(r.deal.title)}</b>` : `Период: <b>${day(r.periodFrom)} — ${day(r.periodTo)}</b>`,
    `Менеджер: <b>${esc(r.createdBy.fullName)}</b>, ${dateTime(r.createdAt)}`,
    '',
    '<b>Товары:</b>',
    ...items,
    '',
    `Итого: <b>${sum(r.amount)}</b>`,
    ...(r.note ? ['', `Комментарий: ${esc(r.note)}`] : []),
    '',
    statusLine(r),
  ].join('\n');
}

/** Новая заявка: пост в группу финансов. Ошибки только в лог — заявка уже создана. */
export async function postPaymentRequestToGroup(id: string): Promise<void> {
  const chatId = config.telegram.groupFinanceChatId;
  if (!chatId) return;
  const r = await loadRequest(id);
  if (!r) return;
  const html = buildPaymentRequestHtml(r, await legalNameOf(innOf(r)));
  const messageId = await telegramService.sendGroupHtmlMessage(chatId, html, PAGE_LINK);
  if (messageId != null) {
    await prisma.paymentRequest.update({ where: { id }, data: { telegramMessageId: String(messageId) } });
  }
}

/** Бухгалтер принял или отклонил, менеджер отозвал — дописываем итог в тот же пост. */
export async function updatePaymentRequestPost(id: string): Promise<void> {
  const chatId = config.telegram.groupFinanceChatId;
  if (!chatId) return;
  const r = await loadRequest(id);
  const messageId = Number(r?.telegramMessageId);
  if (!r || !Number.isFinite(messageId) || messageId <= 0) return;
  const html = buildPaymentRequestHtml(r, await legalNameOf(innOf(r)));
  await telegramService.editGroupHtmlMessage(chatId, messageId, html, PAGE_LINK);
}
