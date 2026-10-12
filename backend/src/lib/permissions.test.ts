import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSIONS } from './permissions';

describe('DEFAULT_PERMISSIONS', () => {
  // HR работает и в отделе ВЭД на полставки: всё, что открыто ВЭД, должно быть открыто и HR
  it('HR has every VED (FOREIGN_TRADE) permission', () => {
    const missing = DEFAULT_PERMISSIONS.FOREIGN_TRADE.filter((p) => !DEFAULT_PERMISSIONS.HR.includes(p));
    expect(missing).toEqual([]);
  });
});
