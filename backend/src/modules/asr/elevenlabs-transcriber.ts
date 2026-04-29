import * as fs from 'node:fs';
import * as path from 'node:path';

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

// ── ElevenLabs API response types ─────────────────────────────────────────────

interface ElevenLabsWord {
  text: string;
  type: 'word' | 'spacing' | 'audio_event';
  start: number;
  end: number;
  speaker_id?: string;
}

interface ElevenLabsSTTResponse {
  language_code: string;
  language_probability: number;
  text: string;
  words: ElevenLabsWord[];
}

// ── Language code mapping ─────────────────────────────────────────────────────
// ElevenLabs uses ISO 639-1 codes; 'auto' = omit the param (auto-detect)

function resolveElevenLabsLang(languageMode: string): string | null {
  switch (languageMode) {
    case 'ru': return 'ru';
    case 'uz': return 'uz';
    default:   return null; // auto-detect
  }
}

// ── Build dialogue text from word-level diarization ──────────────────────────
// ElevenLabs returns speaker_id per word; we group consecutive same-speaker
// utterances into lines: "Menedjer: ..." / "Mijoz: ..."

function buildDialogueFromWords(words: ElevenLabsWord[]): string {
  const utterances: { speaker: string; text: string }[] = [];

  for (const w of words) {
    if (w.type !== 'word' && w.type !== 'spacing') continue;

    const speaker = w.speaker_id ?? 'unknown';
    const last = utterances[utterances.length - 1];

    if (last && last.speaker === speaker) {
      last.text += w.text;
    } else {
      utterances.push({ speaker, text: w.text });
    }
  }

  if (utterances.length === 0) return '';

  // Determine which speaker_id is "manager" vs "client"
  // Heuristic: the speaker who spoke first is the manager (they answer the phone)
  const firstSpeaker = utterances[0].speaker;
  const speakerLabels: Record<string, string> = {};

  const uniqueSpeakers = [...new Set(utterances.map((u) => u.speaker))];
  uniqueSpeakers.forEach((id, idx) => {
    if (id === firstSpeaker) {
      speakerLabels[id] = 'Menedjer';
    } else if (idx === 1 || uniqueSpeakers.length === 2) {
      speakerLabels[id] = 'Mijoz';
    } else {
      speakerLabels[id] = `Spiker ${idx + 1}`;
    }
  });

  return utterances
    .map((u) => {
      const label = speakerLabels[u.speaker] ?? u.speaker;
      return `${label}: ${u.text.trim()}`;
    })
    .filter((line) => line.length > 10)
    .join('\n');
}

// ── Main transcription function ───────────────────────────────────────────────

export interface ElevenLabsTranscribeResult {
  text: string;
  rawText: string;
  dialogueText: string;
  languageCode: string;
  languageProbability: number;
  hasDiarization: boolean;
  words: ElevenLabsWord[];
}

export async function transcribeWithElevenLabs(
  audioPath: string,
  apiKey: string,
  opts: { languageMode?: string } = {},
): Promise<ElevenLabsTranscribeResult> {
  const fileBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([fileBuffer], { type: detectMimeType(fileName) }),
    fileName,
  );
  formData.append('model_id', 'scribe_v1');
  formData.append('diarize', 'true');
  formData.append('tag_audio_events', 'false');

  const langCode = resolveElevenLabsLang(opts.languageMode ?? 'auto');
  if (langCode) {
    formData.append('language_code', langCode);
  }

  const response = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => String(response.status));
    throw new Error(`ElevenLabs STT error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as ElevenLabsSTTResponse;

  const rawText = (data.text ?? '').trim();
  const hasDiarization = data.words?.some((w) => w.speaker_id) ?? false;
  const dialogueText = hasDiarization
    ? buildDialogueFromWords(data.words ?? [])
    : '';

  return {
    text: dialogueText || rawText,
    rawText,
    dialogueText,
    languageCode: data.language_code ?? '',
    languageProbability: data.language_probability ?? 0,
    hasDiarization,
    words: data.words ?? [],
  };
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
