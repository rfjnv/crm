import { z } from 'zod';

const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;

/**
 * TimePay's web app keeps its session in localStorage as JSON
 * ({"state":{"accessToken":"…"}}), and that is what people copy from DevTools.
 * Accept that blob, a "Bearer …" header or a quoted string, and keep only the token.
 */
export function extractTimePayToken(input: string): string {
  const raw = input.trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const token = parsed?.state?.accessToken ?? parsed?.accessToken ?? parsed?.access_token ?? parsed?.access;
      return typeof token === 'string' ? token.trim() : '';
    } catch {
      // not valid JSON — fall through to the pattern search
    }
  }
  const jwt = raw.match(JWT_RE);
  if (jwt) return jwt[0];
  return raw.replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '').trim();
}

export const setTimePayTokenDto = z.object({
  accessToken: z.string().transform(extractTimePayToken).pipe(z.string().min(10, 'Токен слишком короткий')),
});

export type SetTimePayTokenDto = z.infer<typeof setTimePayTokenDto>;

export const updateTimePaySettingsDto = z.object({
  branches: z.array(z.string().max(100)).max(50).optional(),
  hiddenEmployeeIds: z.array(z.string().max(50)).max(1000).optional(),
});
