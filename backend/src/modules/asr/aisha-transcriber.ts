import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// AISHA AI Speech-to-Text (v2)
// Docs: https://aisha.group/en/api-documentation/speech-to-text
// Base URL: https://back.aisha.group
// Auth: x-api-key header (NOT Bearer)
// Upload: POST /api/v2/stt/post/   multipart: audio, language, has_diarization
//   → { "id": 142, "task_id": "...", "status": "PENDING" }
// Poll:   GET  /api/v2/stt/get/{id}/
//   → { "id": 142, "status": "SUCCESS"|"PENDING"|"FAILURE",
//       "transcript": "...", "duration": 125.4, "diarization": [...] }
// ============================================================

const DEFAULT_BASE_URL = 'https://back.aisha.group';
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS = 8 * 60 * 1000;

export type AishaLanguage = 'uz' | 'ru' | 'en';

export interface AishaDiarizationSegment {
  speaker?: string | number;
  start?: number;
  end?: number;
  text?: string;
  [k: string]: unknown;
}

export interface AishaTranscribeResult {
  text: string;
  taskId: string | null;
  resultId: number | null;
  durationSec: number | null;
  diarization: AishaDiarizationSegment[];
  durationMs: number;
}

interface AishaSttSubmitResponse {
  id?: number;
  task_id?: string;
  status?: string;
  transcript?: string;
  detail?: string;
  error?: string;
  message?: string;
}

interface AishaSttResultResponse {
  id?: number;
  status?: string;
  transcript?: string;
  duration?: number;
  diarization?: AishaDiarizationSegment[];
  detail?: string;
  error?: string;
  message?: string;
}

function resolveAishaLang(languageMode: string): AishaLanguage {
  // AISHA requires explicit uz/ru/en — no 'auto'.
  // For mixed/auto we default to Uzbek (their strongest model).
  switch (languageMode) {
    case 'ru': return 'ru';
    case 'en': return 'en';
    case 'uz':
    case 'auto':
    case 'mixed':
    default:
      return 'uz';
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

function buildDialogueFromDiarization(segments: AishaDiarizationSegment[]): string {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  const speakerLabels: Record<string, string> = {};
  const lines: string[] = [];

  const ordered = [...segments].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  for (const seg of ordered) {
    const speakerKey = String(seg.speaker ?? 'unknown');
    if (!speakerLabels[speakerKey]) {
      const idx = Object.keys(speakerLabels).length;
      speakerLabels[speakerKey] = idx === 0 ? 'Menedjer' : idx === 1 ? 'Mijoz' : `Spiker ${idx + 1}`;
    }
    const text = (seg.text ?? '').toString().trim();
    if (text) {
      lines.push(`${speakerLabels[speakerKey]}: ${text}`);
    }
  }
  return lines.join('\n');
}

export async function transcribeWithAisha(
  audioPath: string,
  apiKey: string,
  opts: { languageMode?: string; baseUrl?: string; hasDiarization?: boolean } = {},
): Promise<AishaTranscribeResult> {
  const startedAt = Date.now();
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const lang = resolveAishaLang(opts.languageMode ?? 'auto');
  const hasDiarization = opts.hasDiarization ?? true;

  const fileBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);

  const formData = new FormData();
  formData.append(
    'audio',
    new Blob([fileBuffer], { type: detectMimeType(fileName) }),
    fileName,
  );
  formData.append('language', lang);
  formData.append('has_diarization', hasDiarization ? 'true' : 'false');

  // ── 1. Upload ───────────────────────────────────────────────
  const submitResp = await fetch(`${baseUrl}/api/v2/stt/post/`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: formData,
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => String(submitResp.status));
    throw new Error(`AISHA STT submit ${submitResp.status}: ${errText}`);
  }

  const submitData = (await submitResp.json()) as AishaSttSubmitResponse;
  const status = (submitData.status || '').toUpperCase();

  // Sometimes API returns SUCCESS immediately (very short audio, cached)
  if (status === 'SUCCESS' && typeof submitData.transcript === 'string') {
    return {
      text: submitData.transcript.trim(),
      taskId: submitData.task_id ?? null,
      resultId: submitData.id ?? null,
      durationSec: null,
      diarization: [],
      durationMs: Date.now() - startedAt,
    };
  }

  const resultId = submitData.id;
  if (typeof resultId !== 'number') {
    throw new Error(`AISHA STT: missing id in response: ${JSON.stringify(submitData)}`);
  }

  // ── 2. Poll for result ──────────────────────────────────────
  while (true) {
    if (Date.now() - startedAt > MAX_POLL_MS) {
      throw new Error(`AISHA STT polling timed out after ${MAX_POLL_MS / 1000}s for id ${resultId}`);
    }
    await sleep(POLL_INTERVAL_MS);

    const resultResp = await fetch(`${baseUrl}/api/v2/stt/get/${resultId}/`, {
      headers: { 'x-api-key': apiKey },
    });

    if (!resultResp.ok) {
      const errText = await resultResp.text().catch(() => String(resultResp.status));
      // Some APIs return 202/204 while processing — only throw for hard errors.
      if (resultResp.status >= 500) {
        throw new Error(`AISHA get-result ${resultResp.status}: ${errText}`);
      }
      // Otherwise treat as still processing
      continue;
    }

    const resultData = (await resultResp.json()) as AishaSttResultResponse;
    const resultStatus = (resultData.status || '').toUpperCase();

    if (resultStatus === 'SUCCESS' || resultStatus === 'COMPLETED' || resultStatus === 'DONE') {
      const transcript = (resultData.transcript ?? '').trim();
      const diarization = Array.isArray(resultData.diarization) ? resultData.diarization : [];
      const dialogueText = buildDialogueFromDiarization(diarization);
      return {
        text: dialogueText || transcript,
        taskId: null,
        resultId,
        durationSec: typeof resultData.duration === 'number' ? resultData.duration : null,
        diarization,
        durationMs: Date.now() - startedAt,
      };
    }

    if (resultStatus === 'FAILURE' || resultStatus === 'FAILED' || resultStatus === 'ERROR') {
      throw new Error(
        `AISHA STT failed: ${resultData.message || resultData.error || resultData.detail || JSON.stringify(resultData)}`,
      );
    }
    // PENDING / PROCESSING / STARTED → loop
  }
}
