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

const HOTWORDS_PRODUCTS =
  'Polygraph Business, Pbtrade, HI-KOTE, NINGBO FOLD, FASSON, LIANG DU, '
  + 'BRANCHER, POWER-BRANCHER, FOCUS-BRANCHER, INNAVTION, LANER, TEKNOVA, '
  + 'TETANAL, ELEPHANT, NOVAFIX, ALFA PLUS, WASH, '
  + 'самоклейка, мелованная, целлюлозный картон, фольга, ламинация, '
  + 'офсетная резина, пластины CTP, пантонные краски, биговальный канал, '
  + 'Марзан, гребёнки, термоклей, тальк, проявитель, увлажнение';

const PROMPT_RU =
  'Телефонный разговор менеджера по продажам полиграфической продукции. '
  + 'Обсуждаются товары, цены в сумах, доставка по Ташкенту. '
  + `Упоминаются товары: ${HOTWORDS_PRODUCTS}.`;

const PROMPT_UZ =
  "Poligrafiya mahsulotlari sotuvchi menejerning telefon suhbati. "
  + "Tovarlar, narxlar so'mda, Toshkent bo'yicha yetkazib berish muhokama qilinadi. "
  + `Mahsulotlar: ${HOTWORDS_PRODUCTS}.`;

const PROMPT_MIXED =
  "Telefon suhbati. Menejer va mijoz aralash til ishlatadi: o'zbekcha va ruscha "
  + '(uzbek va russkiy yazyk vmeste). Poligrafiya tovarlari muhokamasi. '
  + `Tovarlar / товары: ${HOTWORDS_PRODUCTS}.`;

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

  await execFile('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', inputPath,
    '-ar', String(targetSr),
    '-ac', '1',
    '-af', 'highpass=f=80,lowpass=f=7500,dynaudnorm',
    outputPath,
  ]);

  return outputPath;
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
  static readonly MODEL = 'gpt-4o-transcribe';

  private client: OpenAI;
  private autoUpsample: boolean;
  private upsampleWorkdir: string;

  constructor(opts: TranscriberOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.autoUpsample = opts.autoUpsample ?? true;
    this.upsampleWorkdir = opts.upsampleWorkdir ?? path.join(process.cwd(), 'uploads', 'asr_resampled');
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

    let actualPath = audioPath;
    let resampledPath: string | null = null;

    if (this.autoUpsample && quality.sampleRate > 0 && quality.sampleRate < 16000) {
      try {
        const baseName = path.basename(audioPath, path.extname(audioPath));
        const resampled = path.join(this.upsampleWorkdir, `${baseName}_16k.wav`);
        actualPath = await upsampleIfNeeded(audioPath, resampled);
        resampledPath = actualPath;
      } catch {
        // ffmpeg missing or failed — fall back to original file
        actualPath = audioPath;
        resampledPath = null;
        quality.warnings.push('ffmpeg_upsample_failed');
      }
    }

    const apiParams = resolveApiParams(config);

    const response = await this.client.audio.transcriptions.create({
      model: PolygraphTranscriber.MODEL,
      file: fs.createReadStream(actualPath),
      response_format: 'json',
      ...(apiParams.language && { language: apiParams.language }),
      ...(apiParams.prompt && { prompt: apiParams.prompt }),
      temperature: apiParams.temperature,
    });

    const transcriptText = (response as { text?: string }).text || '';

    const { score, needsReview } = calculateQualityScore(
      transcriptText,
      quality.durationSec || 0,
      quality,
    );

    if (resampledPath && resampledPath !== audioPath) {
      fs.unlink(resampledPath, () => {});
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
