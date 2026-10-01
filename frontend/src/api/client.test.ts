// @vitest-environment jsdom
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import client from './client';
import { useAuthStore } from '../store/authStore';

/** Неподписанный JWT с нужным exp — клиенту важен только срок. */
function jwt(name: string, expInSec = 900): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ sub: name, exp: Math.floor(Date.now() / 1000) + expInSec })}.x`;
}

const OLD = jwt('old');
const NEW = jwt('new');
let validToken = NEW;
let refreshCalls = 0;
const seenTokens: (string | undefined)[] = [];

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  const response = { data, status, statusText: String(status), headers: {}, config };
  if (status >= 400) {
    return Promise.reject(Object.assign(new Error(String(status)), { config, response, isAxiosError: true }));
  }
  return Promise.resolve(response);
}

const adapter: AxiosAdapter = async (config) => {
  const url = config.url ?? '';
  if (url.endsWith('/auth/refresh')) {
    refreshCalls++;
    await new Promise((r) => setTimeout(r, 20));
    return reply(config, 200, { accessToken: validToken, refreshToken: 'rt' });
  }
  if (url.endsWith('/auth/me')) return reply(config, 200, { id: 'u1', role: 'ADMIN', permissions: [] });
  const auth = String((config.headers as Record<string, unknown>)?.Authorization ?? '');
  if (url.endsWith('/slow')) {
    // Пока запрос в пути, вкладка успела продлить сессию
    await new Promise((r) => setTimeout(r, 10));
    useAuthStore.setState({ accessToken: NEW });
  }
  seenTokens.push(auth.replace('Bearer ', ''));
  return auth === `Bearer ${validToken}` ? reply(config, 200, { ok: true }) : reply(config, 401, { error: 'expired' });
};

const originalAdapter = axios.defaults.adapter;

beforeEach(() => {
  axios.defaults.adapter = adapter;
  client.defaults.adapter = adapter;
  validToken = NEW;
  refreshCalls = 0;
  seenTokens.length = 0;
  localStorage.setItem('crm_access_token', OLD);
  useAuthStore.setState({ accessToken: OLD });
});

afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  localStorage.clear();
});

describe('client: продление сессии', () => {
  it('параллельные 401 в одной вкладке — одно продление на всех', async () => {
    const results = await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    expect(results.every((r) => r.data.ok)).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('соседняя вкладка уже продлила сессию — берём её токен, без второго продления', async () => {
    localStorage.setItem('crm_access_token', NEW); // другая вкладка записала свежий токен
    const r = await client.get('/a');
    expect(r.data.ok).toBe(true);
    expect(refreshCalls).toBe(0);
    expect(useAuthStore.getState().accessToken).toBe(NEW);
  });

  it('просроченный токен соседней вкладки не берём — продлеваем сами', async () => {
    const stale = jwt('stale', -60);
    localStorage.setItem('crm_access_token', stale);
    const r = await client.get('/a');
    expect(r.data.ok).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('поздний 401 со старым токеном после продления — повтор без нового продления', async () => {
    const r = await client.get('/slow');
    expect(r.data.ok).toBe(true);
    expect(refreshCalls).toBe(0);
    expect(seenTokens).toEqual([OLD, NEW]);
  });
});
