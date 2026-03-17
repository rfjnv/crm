export const VAT_RATE = 0.12;

export function addVat(base: number): {
  base: number;
  vatAmount: number;
  totalWithVat: number;
} {
  const vatAmount = Math.round(base * VAT_RATE * 100) / 100;
  return { base, vatAmount, totalWithVat: base + vatAmount };
}

export function formatVatSummary(subtotal: number): {
  subtotal: number;
  vatAmount: number;
  totalWithVat: number;
} {
  const vatAmount = Math.round(subtotal * VAT_RATE * 100) / 100;
  return { subtotal, vatAmount, totalWithVat: subtotal + vatAmount };
}
