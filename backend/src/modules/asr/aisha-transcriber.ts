import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// AISHA / KotibAI STT API
// Docs: https://developer.kotib.ai/docs/stt/
// - POST /stt (multipart) → {status: 'processing', id: 'stt_...'} or {status: 'success', text: '...'}
// - GET /get-status?task_id=... → {status: 'completed'|'processing'|'failed', text?: '...'}
// - Audio < 2 min: blocking=true returns text immediately
// - Audio > 2 min: must be async; we poll every POLL_INTERVAL_MS up to MAX_POLL_MS
// ============================================================

const DEFAULT_BASE_URL = 'https://developer.kotib.ai/api/v1';
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS = 8 * 60 * 1000;

export type AishaLanguage = 'uz' | 'ru' | 'en' | 'auto';

export interface AishaTranscribeResult {
  text: string;
  taskId: string | null;
  durationMs: number;
}

interface AishaSttSubmitResponse {
  status: 'processing' | 'success' | 'failed' | 'error' | string;
  id?: string;
  task_id?: string;
  text?: string;
  message?: string;
  error?: string;
}

interface AishaStatusResponse {
  status: 'completed' | 'processing' | 'pending' | 'failed' | 'error' | string;
  text?: string;
  task_id?: string;
  processing_time?: string;
  message?: string;
  error?: string;
}

function resolveAishaLang(languageMode: string): AishaLanguage {
  switch (languageMode) {
    case 'ru': return 'ru';
    case 'uz': return 'uz';
    case 'en': return 'en';
    default: return 'auto';
  }
}

function detectMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
    '.aac': 'audio/aac',
    '.oga': 'audio/ogg',
  };
  return map[ext] ?? 'audio/mpeg';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function transcribeWithAisha(
  audioPath: string,
  apiKey: string,
  opts: { languageMode?: string; baseUrl?: string } = {},
): Promise<AishaTranscribeResult> {
  const startedAt = Date.now();
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const lang = resolveAishaLang(opts.languageMode ?? 'auto');

  const fileBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);

  const formData = new FormData();
  formData.append(
    'audio',
    new Blob([fileBuffer], { type: detectMimeType(fileName) }),
    fileName,
  );
  if (lang !== 'auto') {
    formData.append('language', lang);
  }
  // Always async — works for any duration; we poll.
  formData.append('blocking', 'false');

  const submitResp = await fetch(`${baseUrl}/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => String(submitResp.status));
    throw new Error(`AISHA STT submit ${submitResp.status}: ${errText}`);
  }

  const submitData = (await submitResp.json()) as AishaSttSubmitResponse;

  // Sometimes for short audio API may return success synchronously
  if (submitData.status === 'success' && typeof submitData.text === 'string') {
    return {
      text: submitData.text.trim(),
      taskId: submitData.id ?? submitData.task_id ?? null,
      durationMs: Date.now() - startedAt,
    };
  }

  const taskId = submitData.id ?? submitData.task_id;
  if (!taskId) {
    throw new Error(`AISHA STT: missing task_id in response: ${JSON.stringify(submitData)}`);
  }

  // ── Poll until completed/failed/timeout ──
  while (true) {
    if (Date.now() - startedAt > MAX_POLL_MS) {
      throw new Error(`AISHA STT polling timed out after ${MAX_POLL_MS / 1000}s for task ${taskId}`);
    }
    await sleep(POLL_INTERVAL_MS);

    const statusResp = await fetch(
      `${baseUrl}/get-status?task_id=${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!statusResp.ok) {
      const errText = await statusResp.text().catch(() => String(statusResp.status));
      throw new Error(`AISHA get-status ${statusResp.status}: ${errText}`);
    }

    const statusData = (await statusResp.json()) as AishaStatusResponse;
    const status = (statusData.status || '').toLowerCase();

    if (status === 'completed' || status === 'success' || status === 'done') {
      return {
        text: (statusData.text ?? '').trim(),
        taskId,
        durationMs: Date.now() - startedAt,
      };
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(
        `AISHA STT failed: ${statusData.message || statusData.error || JSON.stringify(statusData)}`,
      );
    }
    // else: still processing → loop
  }
}
