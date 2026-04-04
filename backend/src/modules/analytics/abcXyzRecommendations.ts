/** Product-facing ABC/XYZ action hints (English, aligned with CRM ops). */
export const ABC_XYZ_RECOMMENDATIONS_PRODUCT: Record<string, string> = {
  AX: 'Top performer — keep in stock',
  AY: 'Stabilize demand',
  AZ: 'High revenue but unstable — risk',
  ANEW: 'High share, limited history — validate trend before deep stock',
  BX: 'Stable but medium value',
  BY: 'Medium value — reduce volatility',
  BZ: 'Medium value but erratic — tighten forecasting',
  BNEW: 'Medium share, limited history — monitor monthly',
  CX: 'Low share but stable — maintain if strategic',
  CY: 'Low share, variable — niche review',
  CZ: 'Low value and unstable — consider removing',
  CNEW: 'Low share, limited history — observe or deprioritize',
};

/** Client-facing wording (same logic, relationship-focused). */
export const ABC_XYZ_RECOMMENDATIONS_CLIENT: Record<string, string> = {
  AX: 'Top account — protect and grow relationship',
  AY: 'Stabilize order pattern',
  AZ: 'High revenue but volatile — risk',
  ANEW: 'High share, limited history — validate before committing capacity',
  BX: 'Stable mid-tier account',
  BY: 'Medium value — smooth demand',
  BZ: 'Medium value but erratic — tighten terms / forecasting',
  BNEW: 'Medium share, limited history — watch monthly',
  CX: 'Low share but stable — keep if strategic',
  CY: 'Low share, variable — niche review',
  CZ: 'Low value and unstable — consider phasing out',
  CNEW: 'Low share, limited history — observe or deprioritize',
};

export function recommendationFor(combined: string, kind: 'product' | 'client'): string {
  const map = kind === 'product' ? ABC_XYZ_RECOMMENDATIONS_PRODUCT : ABC_XYZ_RECOMMENDATIONS_CLIENT;
  return map[combined] ?? 'Review in next planning cycle';
}
