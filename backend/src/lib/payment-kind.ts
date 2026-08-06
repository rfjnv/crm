import { PaymentKind } from '@prisma/client';

/**
 * Различение денежных и служебных проводок.
 *
 * В таблице `payments` лежат две принципиально разные вещи:
 *  - реальное поступление денег в кассу (`CASH_IN`);
 *  - служебные движения внутри учёта — зачёт переплаты, выравнивание, сторно.
 *
 * Кассовые и балансовые итоги обязаны считать только `CASH_IN`, иначе зачёт переплаты
 * выглядит как второй приход тех же денег.
 */

/** Проводки, которые считаются реальным движением денег в кассе. */
export const CASH_KINDS: PaymentKind[] = ['CASH_IN', 'REVERSAL'];

/** Prisma-фильтр «только денежные проводки». */
export const cashOnlyFilter = { kind: { in: CASH_KINDS } } as const;

/** Префикс примечания у проводки зачёта переплаты. */
export const CLIENT_CREDIT_NOTE_PREFIX = '[Зачёт переплаты]';

/** Прежний текст примечания — до введения префикса. Нужен для старых записей. */
const LEGACY_CLIENT_CREDIT_NOTE = 'Зачёт переплаты с других сделок клиента';

/**
 * Проводка — внутренний зачёт переплаты, а не поступление денег.
 *
 * Смотрит на `kind`, если он есть. Fallback по примечанию оставлен для записей,
 * прочитанных без этого поля (частичные `select`).
 */
export function isClientCreditTransfer(
  payment: { kind?: PaymentKind | null; note?: string | null } | string | null | undefined,
): boolean {
  if (payment == null) return false;
  if (typeof payment === 'string') {
    return payment.startsWith(CLIENT_CREDIT_NOTE_PREFIX)
      || payment.startsWith(LEGACY_CLIENT_CREDIT_NOTE);
  }
  if (payment.kind) return payment.kind === 'CREDIT_TRANSFER';
  const note = payment.note;
  if (!note) return false;
  return note.startsWith(CLIENT_CREDIT_NOTE_PREFIX) || note.startsWith(LEGACY_CLIENT_CREDIT_NOTE);
}

/** Проводка не является поступлением денег — исключается из кассовых итогов. */
export function isNonCashKind(kind: PaymentKind | null | undefined): boolean {
  return !!kind && !CASH_KINDS.includes(kind);
}

/** Собирает примечание зачёта с перечнем сделок-источников. */
export function buildClientCreditNote(
  sources: { title: string | null; amount: number }[],
  userNote?: string,
): string {
  const list = sources
    .map((s) => `${s.title || 'без названия'} — ${s.amount.toLocaleString('ru-RU')}`)
    .join('; ');
  const base = `${CLIENT_CREDIT_NOTE_PREFIX} источники: ${list || 'не определены'}`;
  return userNote?.trim() ? `${base}. ${userNote.trim()}` : base;
}
