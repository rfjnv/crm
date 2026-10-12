import { describe, expect, it } from 'vitest';
import { extractTimePayToken, setTimePayTokenDto } from './timepay.dto';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxNDR9.abc_DEF-123';

describe('extractTimePayToken', () => {
  it('takes the token out of the localStorage blob', () => {
    const blob = JSON.stringify({
      state: { accessToken: TOKEN, refreshToken: null, user: { company_name: 'Polygraph' } },
      version: 0,
    });
    expect(extractTimePayToken(blob)).toBe(TOKEN);
  });

  it('accepts the blob wrapped in quotes as copied from DevTools', () => {
    const blob = `"${JSON.stringify({ state: { accessToken: TOKEN } })}"`;
    expect(extractTimePayToken(blob)).toBe(TOKEN);
  });

  it('strips Bearer and quotes', () => {
    expect(extractTimePayToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(extractTimePayToken(`  "${TOKEN}"\n`)).toBe(TOKEN);
  });

  it('keeps a plain non-JWT token as is', () => {
    expect(extractTimePayToken('  plain-token-12345 ')).toBe('plain-token-12345');
  });

  it('validates the extracted token, not the raw input', () => {
    expect(setTimePayTokenDto.parse({ accessToken: JSON.stringify({ state: { accessToken: TOKEN } }) }).accessToken).toBe(TOKEN);
    expect(setTimePayTokenDto.safeParse({ accessToken: '{"state":{"accessToken":null}}' }).success).toBe(false);
    expect(setTimePayTokenDto.safeParse({ accessToken: '"short"' }).success).toBe(false);
  });
});
