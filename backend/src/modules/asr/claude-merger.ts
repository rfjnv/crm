import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// Claude Merger
// Берёт транскрипты от 3 STT-движков (AISHA / ElevenLabs / OpenAI),
// сравнивает слово в слово и собирает один финальный диалог.
// Принцип: majority vote по словам + приоритет узбекского STT для uz-частей,
// диаризация на роли "Menedjer" / "Mijoz", запрет выдумывать факты.
// ============================================================

export interface CandidateTranscript {
  engine: 'aisha' | 'elevenlabs' | 'openai';
  text: string;
  hasDiarization?: boolean;
}

export interface ClaudeMergeResult {
  mergedText: string;
  disputedNote: string;
  modelUsed: string;
  durationMs: number;
}

const SYSTEM_PROMPT = `Ты — строгий корректор транскриптов телефонных звонков для CRM полиграфической компании Polygraph Business.

ВХОД: до 3 независимых транскрипций ОДНОГО И ТОГО ЖЕ аудио, сделанных разными STT движками:
- AISHA — узбекская модель (лучше всего справляется с узбекским и смешанной речью)
- ElevenLabs — английская/универсальная модель с диаризацией (метки Menedjer/Mijoz)
- OpenAI Whisper — универсальная модель

ЗАДАЧА: собрать ОДИН максимально точный финальный текст диалога.

ПРАВИЛА (СТРОГО):
1. НЕ выдумывай слова, которых нет хотя бы в одной из транскрипций.
2. При расхождении в слове:
   a) Если 2 движка сказали одно и то же — выбирай это.
   b) Если все 3 разные — выбирай вариант, который НАИБОЛЕЕ ОСМЫСЛЕН в контексте полиграфии (бумага, ламинация, цены в сумах, доставка по Ташкенту).
   c) Для узбекских / смешанных uz+ru участков — приоритет AISHA.
   d) Для четкой диаризации (кто говорит) — приоритет ElevenLabs.
3. Восстанавливай правильные имена брендов и терминов:
   Polygraph Business, HI-KOTE, NINGBO FOLD, FASSON, LIANG DU, BRANCHER, POWER-BRANCHER,
   FOCUS-BRANCHER, LANER, TEKNOVA, TETANAL, ELEPHANT, NOVAFIX, ALFA PLUS,
   самоклейка, ламинация, мелованная бумага, офсетная резина, пластины CTP,
   пантонные краски, биговальный канал, марзан, термоклей.
4. Сохраняй язык оригинала: русские части — на русском, узбекские — на узбекском (латиница).
5. Формат вывода — диалог по строкам. Используй метки:
   - "Menedjer:" / "Mijoz:" если ясно, кто кто (или ElevenLabs дал диаризацию).
   - "Spiker A:" / "Spiker B:" если роли неясны.
6. Не сокращай и не пересказывай — нужен ДОСЛОВНЫЙ финальный диалог.
7. Если все 3 транскрипта пустые или очень короткие — верни короткий текст и пометку об этом.

ВЫВОД (СТРОГО JSON, НИЧЕГО КРОМЕ JSON):
{
  "mergedText": "<финальный диалог, по одной реплике на строку>",
  "disputedNote": "<2-4 предложения: какие фрагменты были спорными и какой вариант ты выбрал и почему. Если все 3 транскрипта совпадали — пиши 'Расхождений не было'.>"
}`;

function buildUserPrompt(candidates: CandidateTranscript[]): string {
  const sections: string[] = [];

  const aisha = candidates.find((c) => c.engine === 'aisha');
  const eleven = candidates.find((c) => c.engine === 'elevenlabs');
  const openai = candidates.find((c) => c.engine === 'openai');

  sections.push('=== ВХОДНЫЕ ТРАНСКРИПТЫ ===');

  if (aisha?.text) {
    sections.push(`\n--- A) AISHA (узбекская модель) ---\n${aisha.text}`);
  } else {
    sections.push('\n--- A) AISHA: транскрипт отсутствует ---');
  }

  if (eleven?.text) {
    sections.push(
      `\n--- B) ElevenLabs ${eleven.hasDiarization ? '(с диаризацией)' : ''} ---\n${eleven.text}`,
    );
  } else {
    sections.push('\n--- B) ElevenLabs: транскрипт отсутствует ---');
  }

  if (openai?.text) {
    sections.push(`\n--- C) OpenAI Whisper ---\n${openai.text}`);
  } else {
    sections.push('\n--- C) OpenAI Whisper: транскрипт отсутствует ---');
  }

  sections.push('\n=== ЗАДАЧА ===');
  sections.push(
    'Собери ОДИН финальный текст диалога по правилам в системном промпте. Верни ТОЛЬКО JSON.',
  );

  return sections.join('\n');
}

function parseClaudeJson(raw: string): { mergedText: string; disputedNote: string } {
  let jsonString = raw.trim();

  // Strip ```json ... ``` wrappers if Claude adds them
  const fenceMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonString = fenceMatch[1].trim();

  // Find first { and last }
  const firstBrace = jsonString.indexOf('{');
  const lastBrace = jsonString.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonString = jsonString.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(jsonString);
  return {
    mergedText: typeof parsed.mergedText === 'string' ? parsed.mergedText : '',
    disputedNote: typeof parsed.disputedNote === 'string' ? parsed.disputedNote : '',
  };
}

export async function mergeTranscriptsWithClaude(
  candidates: CandidateTranscript[],
  apiKey: string,
  opts: { model?: string } = {},
): Promise<ClaudeMergeResult> {
  const startedAt = Date.now();

  const nonEmpty = candidates.filter((c) => c.text && c.text.trim().length > 0);
  if (nonEmpty.length === 0) {
    return {
      mergedText: '',
      disputedNote: 'Все 3 STT-движка вернули пустой текст. Скорее всего аудио без речи или повреждено.',
      modelUsed: 'fallback',
      durationMs: Date.now() - startedAt,
    };
  }

  // If only one engine succeeded — skip Claude, return its text directly
  if (nonEmpty.length === 1) {
    return {
      mergedText: nonEmpty[0].text.trim(),
      disputedNote: `Доступен только транскрипт от ${nonEmpty[0].engine.toUpperCase()}. Слияние не выполнялось.`,
      modelUsed: 'single-source',
      durationMs: Date.now() - startedAt,
    };
  }

  const client = new Anthropic({ apiKey });
  const model = opts.model || 'claude-sonnet-4-5-20250929';

  const userPrompt = buildUserPrompt(candidates);

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const rawText = textBlock && 'text' in textBlock ? textBlock.text : '';

  if (!rawText) {
    throw new Error('Claude вернул пустой ответ при слиянии транскриптов');
  }

  let parsed: { mergedText: string; disputedNote: string };
  try {
    parsed = parseClaudeJson(rawText);
  } catch (err) {
    // If Claude broke the JSON contract — fall back to using its raw text as merged
    return {
      mergedText: rawText.trim(),
      disputedNote: 'Claude вернул ответ не в JSON формате — использован сырой текст.',
      modelUsed: model,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    mergedText: parsed.mergedText.trim() || nonEmpty[0].text.trim(),
    disputedNote: parsed.disputedNote.trim(),
    modelUsed: model,
    durationMs: Date.now() - startedAt,
  };
}
