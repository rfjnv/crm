import OpenAI from 'openai';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';

const execFile = promisify(execFileCb);

// ============================================================
// HOTWORDS / PROMPT BANK
// Передаются в OpenAI как параметр `prompt` — это сильно
// улучшает узнавание редких слов. Лимит ~224 токена,
// поэтому держим списки компактными.
// ============================================================

// ── Brands & product names ──────────────────────────────────────────────────
const HOTWORDS_BRANDS =
  'Polygraph Business, Pbtrade, HI-KOTE, NINGBO FOLD, FASSON, LIANG DU, '
  + 'BRANCHER, POWER-BRANCHER, FOCUS-BRANCHER, LANER, TEKNOVA, INNAVTION, '
  + 'TETANAL, ELEPHANT, NOVAFIX, ALFA PLUS, WASH, IRIDESSE, INDIGO, HP Indigo';

// ── Material & process terms ─────────────────────────────────────────────────
const HOTWORDS_MATERIALS =
  'самоклейка, самоклеящаяся, мелованная бумага, целлюлозный картон, '
  + 'фольга, ламинация, матовая ламинация, глянцевая ламинация, '
  + 'офсетная резина, пластины CTP, пантонные краски, биговальный канал, '
  + 'марзан, гребёнки, термоклей, тальк, проявитель, увлажнение, '
  + 'трафаретная печать, УФ-лак, выборочный лак, тиснение, конгрев';

// ── Business terms ────────────────────────────────────────────────────────────
const HOTWORDS_BUSINESS =
  'накладная, счёт-фактура, доверенность, договор, спецификация, '
  + 'перечисление, предоплата, наличные, безнал, долг, остаток, '
  + 'ИНН, НДС, сумма, скидка, партия, заказ, доставка, склад, '
  + 'Ташкент, Юнусабад, Чиланзар, Сергели, Мирзо Улугбек';

// ── Uzbek business terms ──────────────────────────────────────────────────────
const HOTWORDS_UZ =
  "hisob-faktura, shartnoma, spetsifikatsiya, naqd, o'tkazma, qarz, "
  + "buyurtma, yetkazib berish, ombor, chegirma, to'lov, oldindan to'lov";

const HOTWORDS_ALL = `${HOTWORDS_BRANDS}, ${HOTWORDS_MATERIALS}, ${HOTWORDS_BUSINESS}`;

const PROMPT_RU =
  'Запись телефонного звонка менеджера по продажам полиграфической компании. '
  + 'Собеседники: менеджер и клиент. Обсуждают товары, цены в узбекских сумах, '
  + 'условия оплаты, доставку по Ташкенту. '
  + `Термины и названия: ${HOTWORDS_ALL}.`;

const PROMPT_UZ =
  "Poligrafiya kompaniyasi menejerining telefon suhbati yozuvi. "
  + "Suhbatdoshlar: menejer va mijoz. Tovarlar, narxlar so'm hisobida, "
  + "to'lov shartlari, Toshkent bo'yicha yetkazib berish muhokama qilinadi. "
  + `Atamalar: ${HOTWORDS_ALL}, ${HOTWORDS_UZ}.`;

const PROMPT_MIXED =
  "Telefon suhbati yozuvi. Menejer va mijoz aralash gaplashadi: "
  + "o'zbek va rus tillari birgalikda ishlatiladi. "
  + 'Поли­гра­фи­чес­кая продажа: цены в сумах, условия, доставка. '
  + `Товары / tovarlar: ${HOTWORDS_ALL}, ${HOTWORDS_UZ}.`;

// ============================================================
// TYPES
// ============================================================

export type LanguageMode = 'ru' | 'uz' | 'auto' | 'mixed';

export interface TranscriptionConfig {
  languageMode: LanguageMode;
  customPrompt?: string;
  temperature?: number;
}

export interface AudioQuality {
  sampleRate: number;
  channels: number;
  durationSec: number;
  isLowQuality: boolean;
  warnings: string[];
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  speaker: string;
  speakerRole: 'manager' | 'client' | null;
  text: string;
  language: string | null;
  confidence: number | null;
}

export interface TranscriptionResult {
  text: string;
  languageMode: LanguageMode;
  audioQuality: AudioQuality;
  qualityScore: number;
  needsHumanReview: boolean;
  model: string;
  segments: TranscriptSegment[];
  auditRecommended?: boolean;
  auditSkipReason?: string;
}

// ============================================================
// LANGUAGE MODE → API PARAMS
// ============================================================

interface ApiParams {
  language?: string;
  prompt?: string;
  temperature: number;
}

function resolveApiParams(config: TranscriptionConfig): ApiParams {
  const temperature = config.temperature ?? 0.0;

  switch (config.languageMode) {
    case 'ru':
      return {
        language: 'ru',
        prompt: config.customPrompt ?? PROMPT_RU,
        temperature,
      };

    case 'uz':
      return {
        language: 'uz',
        prompt: config.customPrompt ?? PROMPT_UZ,
        temperature,
      };

    case 'auto':
      return {
        prompt: config.customPrompt ?? PROMPT_MIXED,
        temperature,
      };

    case 'mixed':
      return {
        prompt: config.customPrompt ?? PROMPT_MIXED,
        temperature,
      };
  }
}

// ============================================================
// AUDIO QUALITY ASSESSMENT
// ============================================================

export async function probeAudio(audioPath: string): Promise<AudioQuality> {
  const { stdout } = await execFile('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=sample_rate,channels:format=duration',
    '-of', 'json',
    audioPath,
  ]);

  const data = JSON.parse(stdout) as { streams?: Array<{ sample_rate?: string; channels?: string }>; format?: { duration?: string } };
  const stream = data.streams?.[0];
  const sampleRate = stream?.sample_rate ? parseInt(stream.sample_rate, 10) : 0;
  const channels = stream?.channels ? parseInt(stream.channels, 10) : 0;
  const durationSec = data.format?.duration ? parseFloat(data.format.duration) : 0;

  const warnings: string[] = [];
  let isLowQuality = false;

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    warnings.push('unknown_sample_rate');
    isLowQuality = true;
  } else if (sampleRate < 16000) {
    warnings.push(`low_sample_rate_${sampleRate}hz`);
    isLowQuality = true;
  }

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    warnings.push('unknown_duration');
  } else if (durationSec < 3.0) {
    warnings.push('audio_too_short');
  }

  return { sampleRate, channels, durationSec, isLowQuality, warnings };
}

export async function upsampleIfNeeded(
  inputPath: string,
  outputPath: string,
  targetSr = 16000,
): Promise<string> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Audio filter chain (order matters):
  // 1. highpass — убираем низкочастотный гул (вентиляторы, фон)
  // 2. afftdn   — спектральное шумоподавление (телефонный шум, шипение)
  // 3. lowpass  — убираем высокочастотный мусор выше 8 kHz
  // 4. loudnorm — нормализация громкости по EBU R128 (Whisper чувствителен к тихой речи)
  // 5. dynaudnorm — динамическая нормализация для выравнивания тихих участков
  const audioFilter = [
    'highpass=f=80',
    'afftdn=nf=-25',
    'lowpass=f=8000',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    'dynaudnorm=p=0.9:m=100',
  ].join(',');

  await execFile('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', inputPath,
    '-ar', String(targetSr),
    '-ac', '1',
    '-af', audioFilter,
    outputPath,
  ]);

  return outputPath;
}

// Конвертирует любой аудио/видео в 16 kHz mono WAV с полной цепочкой фильтров,
// даже если оригинальный sample rate уже >= 16 kHz.
export async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  targetSr = 16000,
): Promise<string> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const audioFilter = [
    'highpass=f=80',
    'afftdn=nf=-25',
    'lowpass=f=8000',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    'dynaudnorm=p=0.9:m=100',
  ].join(',');

  await execFile('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', inputPath,
    '-ar', String(targetSr),
    '-ac', '1',
    '-af', audioFilter,
    outputPath,
  ]);

  return outputPath;
}

// ============================================================
// CHUNKED SPLITTING
// Long calls (> CHUNK_THRESHOLD sec) are split into overlapping
// segments, transcribed in parallel, then merged.
// ============================================================

const CHUNK_THRESHOLD_SEC = 180;  // apply chunking if audio > 3 min
const CHUNK_SIZE_SEC      = 90;   // each chunk = 90 sec
const CHUNK_OVERLAP_SEC   = 5;    // 5 sec overlap between chunks

export interface AudioChunk {
  index: number;
  startSec: number;
  endSec: number;
  filePath: string;
}

export async function splitIntoChunks(
  inputPath: string,
  workdir: string,
  chunkSizeSec = CHUNK_SIZE_SEC,
  overlapSec   = CHUNK_OVERLAP_SEC,
): Promise<AudioChunk[]> {
  const quality = await probeAudio(inputPath).catch(() => null);
  const duration = quality?.durationSec ?? 0;

  if (duration <= 0 || duration <= chunkSizeSec) return [];

  fs.mkdirSync(workdir, { recursive: true });

  const chunks: AudioChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < duration) {
    const end = Math.min(start + chunkSizeSec, duration);
    const outPath = path.join(workdir, `chunk_${index}.wav`);

    await execFile('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', inputPath,
      '-ss', String(start),
      '-to', String(end),
      '-c', 'copy',
      outPath,
    ]);

    chunks.push({ index, startSec: start, endSec: end, filePath: outPath });
    index++;

    if (end >= duration) break;
    start = end - overlapSec;
  }

  return chunks;
}

function mergeChunkTranscripts(chunks: Array<{ startSec: number; text: string }>): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0].text.trim();

  // Simple merge: deduplicate overlap by checking if end of prev matches start of next
  const parts: string[] = [chunks[0].text.trim()];

  for (let i = 1; i < chunks.length; i++) {
    const prev = parts[parts.length - 1];
    const curr = chunks[i].text.trim();
    if (!curr) continue;

    // Look for a short overlap string in the boundary area (last 60 chars of prev)
    const boundary = prev.slice(-120);
    const currWords = curr.split(/\s+/);
    let mergeAt = 0;

    // Find longest suffix of prev that is a prefix of curr
    for (let w = Math.min(currWords.length, 15); w >= 2; w--) {
      const candidate = currWords.slice(0, w).join(' ');
      if (boundary.includes(candidate)) {
        mergeAt = w;
        break;
      }
    }

    parts.push(currWords.slice(mergeAt).join(' '));
  }

  return parts.filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
}

// ============================================================
// QUALITY SCORING
// ============================================================

export function calculateQualityScore(
  transcriptText: string,
  audioDurationSec: number,
  audioQuality: AudioQuality,
): { score: number; needsReview: boolean } {
  let score = 10.0;

  const words = transcriptText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const expectedWords = Math.max(audioDurationSec, 1) * 2.0;

  if (wordCount < expectedWords * 0.3) {
    score -= 4.0;
  } else if (wordCount < expectedWords * 0.6) {
    score -= 1.5;
  }

  if (wordCount > 20) {
    const uniqueRatio = new Set(words).size / wordCount;
    if (uniqueRatio < 0.3) {
      score -= 3.0;
    }
  }

  if (audioQuality.isLowQuality) score -= 1.0;
  if (audioQuality.warnings.includes('audio_too_short')) score -= 2.0;

  score = Math.max(0, Math.min(10, score));
  return { score, needsReview: score < 7.0 };
}

// ============================================================
// MAIN TRANSCRIBER
// ============================================================

export interface TranscriberOptions {
  apiKey: string;
  autoUpsample?: boolean;
  upsampleWorkdir?: string;
}

export class PolygraphTranscriber {
  static readonly MODEL_PRIMARY = 'gpt-4o-transcribe';
  static readonly MODEL_FALLBACK = 'whisper-1';
  /** @deprecated use MODEL_PRIMARY */
  static readonly MODEL = PolygraphTranscriber.MODEL_PRIMARY;

  private client: OpenAI;
  private autoUpsample: boolean;
  private upsampleWorkdir: string;

  constructor(opts: TranscriberOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.autoUpsample = opts.autoUpsample ?? true;
    this.upsampleWorkdir = opts.upsampleWorkdir ?? path.join(process.cwd(), 'uploads', 'asr_resampled');
  }

  private async transcribeWithModel(
    filePath: string,
    model: string,
    apiParams: ApiParams,
  ): Promise<string> {
    const response = await this.client.audio.transcriptions.create({
      model,
      file: fs.createReadStream(filePath),
      response_format: 'json',
      ...(apiParams.language && { language: apiParams.language }),
      // whisper-1 does not support prompt parameter for gpt-4o-transcribe style prompts
      ...(model !== PolygraphTranscriber.MODEL_FALLBACK && apiParams.prompt && { prompt: apiParams.prompt }),
      temperature: apiParams.temperature,
    });
    return (response as { text?: string }).text || '';
  }

  private async transcribeSingleFile(
    filePath: string,
    apiParams: ApiParams,
  ): Promise<string> {
    try {
      return await this.transcribeWithModel(filePath, PolygraphTranscriber.MODEL_PRIMARY, apiParams);
    } catch (primaryErr) {
      const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      // Fall back to whisper-1 if gpt-4o-transcribe is unavailable (model access, 404, etc.)
      if (/404|model|not found|not available|no access/i.test(msg)) {
        console.warn(`[OpenAI ASR] ${PolygraphTranscriber.MODEL_PRIMARY} unavailable (${msg}), falling back to ${PolygraphTranscriber.MODEL_FALLBACK}`);
        return await this.transcribeWithModel(filePath, PolygraphTranscriber.MODEL_FALLBACK, apiParams);
      }
      throw primaryErr;
    }
  }

  async transcribe(
    audioPath: string,
    config: TranscriptionConfig = { languageMode: 'auto' },
  ): Promise<TranscriptionResult> {
    let quality: AudioQuality = {
      sampleRate: 0,
      channels: 0,
      durationSec: 0,
      isLowQuality: true,
      warnings: ['ffprobe_unavailable'],
    };

    try {
      quality = await probeAudio(audioPath);
    } catch {
      // ffprobe missing or failed — keep conservative defaults
    }

    const apiParams = resolveApiParams(config);

    // ── Normalize audio (always): noise reduction + loudnorm ──────────────
    let normalizedPath: string | null = null;
    let actualPath = audioPath;

    if (this.autoUpsample) {
      try {
        const baseName = path.basename(audioPath, path.extname(audioPath));
        const outPath = path.join(this.upsampleWorkdir, `${baseName}_norm.wav`);
        actualPath = await normalizeAudio(audioPath, outPath);
        normalizedPath = actualPath;
        // Re-probe after normalization to get accurate duration
        quality = await probeAudio(actualPath).catch(() => quality);
      } catch {
        actualPath = audioPath;
        quality.warnings.push('ffmpeg_normalize_failed');
      }
    }

    // ── Chunked transcription for long audio (> CHUNK_THRESHOLD_SEC) ──────
    let transcriptText = '';

    if (quality.durationSec > CHUNK_THRESHOLD_SEC) {
      const chunkWorkdir = path.join(this.upsampleWorkdir, `chunks_${Date.now()}`);
      let chunks: AudioChunk[] = [];

      try {
        chunks = await splitIntoChunks(actualPath, chunkWorkdir);
      } catch {
        quality.warnings.push('chunk_split_failed');
      }

      if (chunks.length > 0) {
        // Transcribe all chunks in parallel (max 5 concurrent)
        const PARALLEL = 5;
        const chunkResults: Array<{ startSec: number; text: string }> = [];

        for (let i = 0; i < chunks.length; i += PARALLEL) {
          const batch = chunks.slice(i, i + PARALLEL);
          const results = await Promise.all(
            batch.map(async (chunk) => ({
              startSec: chunk.startSec,
              text: await this.transcribeSingleFile(chunk.filePath, apiParams).catch(() => ''),
            })),
          );
          chunkResults.push(...results);
        }

        transcriptText = mergeChunkTranscripts(chunkResults);

        // Cleanup chunk files
        for (const chunk of chunks) {
          fs.unlink(chunk.filePath, () => {});
        }
        fs.rmdir(chunkWorkdir, () => {});
      }
    }

    // Fall back to single-file transcription if chunking didn't run or failed
    if (!transcriptText) {
      transcriptText = await this.transcribeSingleFile(actualPath, apiParams);
    }

    const { score, needsReview } = calculateQualityScore(
      transcriptText,
      quality.durationSec || 0,
      quality,
    );

    if (normalizedPath && normalizedPath !== audioPath) {
      fs.unlink(normalizedPath, () => {});
    }

    return {
      text: transcriptText,
      languageMode: config.languageMode,
      audioQuality: quality,
      qualityScore: Math.round(score * 10) / 10,
      needsHumanReview: needsReview,
      model: PolygraphTranscriber.MODEL,
      segments: [
        {
          id: 0,
          start: 0,
          end: quality.durationSec || 0,
          speaker: 'unknown',
          speakerRole: null,
          text: transcriptText,
          language: apiParams.language ?? null,
          confidence: null,
        },
      ],
    };
  }

  async transcribeWithQualityGate(
    audioPath: string,
    config: TranscriptionConfig = { languageMode: 'auto' },
    minScoreForAudit = 5.0,
  ): Promise<TranscriptionResult> {
    const result = await this.transcribe(audioPath, config);
    result.auditRecommended = result.qualityScore >= minScoreForAudit;

    if (!result.auditRecommended) {
      result.auditSkipReason =
        `Quality score ${result.qualityScore} < ${minScoreForAudit}. `
        + 'Прослушай звонок вручную перед использованием транскрипта.';
    }
    return result;
  }
}
