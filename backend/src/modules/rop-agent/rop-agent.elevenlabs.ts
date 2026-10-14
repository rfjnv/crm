import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';

/** Запросы к API ElevenLabs Agents: агенты звонков, их инструменты и сессии. */

const API = 'https://api.elevenlabs.io/v1';

export async function el<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'xi-api-key': config.elevenlabs.apiKey, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[rop-call] ElevenLabs ${method} ${path} → ${res.status}: ${text.slice(0, 1000)}`);
    const hint = res.status === 401 || res.status === 403 ? ' — у ключа ElevenLabs нет доступа к Agents (нужно право «ElevenAgents» у API-ключа)' : '';
    throw new AppError(502, `ElevenLabs ответил ${res.status}${hint}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

