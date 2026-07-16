/** Ссылка на чат в Telegram по номеру телефона (Telegram сам сопоставит номер с аккаунтом). */
export function telegramLinkFromPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://t.me/+${digits}`;
}
