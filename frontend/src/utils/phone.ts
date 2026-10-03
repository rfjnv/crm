/** Ссылка на чат в Telegram по номеру телефона (Telegram сам сопоставит номер с аккаунтом). */
export function telegramLinkFromPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://t.me/+${digits}`;
}

/** 9 цифр узбекского номера без кода страны или null (как uzPhoneDigits на бэкенде). */
function uzPhoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) return digits;
  if (digits.length === 12 && digits.startsWith('998')) return digits.slice(3);
  return null;
}

/** «+998 XX XXX XX XX»; иностранный или неполный номер — как есть. */
export function formatUzPhone(raw: string | null | undefined): string {
  const d = uzPhoneDigits(raw);
  if (!d) return raw ?? '';
  return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}
