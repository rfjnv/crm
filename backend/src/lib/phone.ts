/**
 * Телефоны клиентов в CRM хранятся как «+998 XX XXX XX XX» (так их вводит форма на фронте).
 * Исторически встречаются и другие записи: «94 620 90 92», «998946209092», «(90) 442-99-97».
 */

/** 9 цифр узбекского номера без кода страны или null, если номер не узбекский/неполный. */
export function uzPhoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) return digits;
  if (digits.length === 12 && digits.startsWith('998')) return digits.slice(3);
  return null;
}

/** «+998 XX XXX XX XX» или null — тогда номер оставляем как ввели (иностранный, неполный). */
export function formatUzPhone(raw: string | null | undefined): string | null {
  const d = uzPhoneDigits(raw);
  if (!d) return null;
  return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}

/**
 * Значение для сохранения: узбекский номер — в едином формате, иначе как ввели (без лишних пробелов).
 * Пустая строка → null.
 */
export function canonicalClientPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  // Пустое поле формы — это «+998» без цифр номера
  const digits = trimmed.replace(/\D/g, '');
  if (!digits || digits === '998') return null;
  return formatUzPhone(trimmed) ?? trimmed;
}

/** Ключ для сравнения номеров: 9 цифр для узбекских, все цифры для остальных. */
export function phoneMatchKey(raw: string | null | undefined): string {
  if (!raw) return '';
  return uzPhoneDigits(raw) ?? raw.replace(/\D/g, '');
}
