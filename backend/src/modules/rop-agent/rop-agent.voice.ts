import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { transcribeWithAisha } from '../asr/aisha-transcriber';
import { transcribeWithElevenLabs } from '../asr/elevenlabs-transcriber';

/**
 * Голосовое сообщение директора → текст задания для агента.
 *
 * Общая расшифровка CRM (transcribeAudioFile) собирает диалог звонка с метками
 * «Менеджер: / Клиент:» — для голосовой заметки это лишнее. Здесь те же движки, но
 * результат — один монолог: ElevenLabs сам определяет язык, AISHA сильнее всех
 * в узбекском; если сработали оба, Claude сводит их в одну дословную версию.
 */

const MERGE_PROMPT = `Тебе дают две автоматические расшифровки ОДНОГО голосового сообщения директора компании Polygraph Business (Ташкент, расходники для типографий). Речь на русском, узбекском или вперемешку.
Собери одну точную дословную версию: бери из каждой расшифровки то, что распознано лучше. Исправляй только явные ошибки распознавания — названия товаров (самоклейка, ламинация, фольга, мелованная бумага, картон), имена людей и клиентов, числа и суммы.
Ничего не добавляй, не пересказывай, не отвечай на сообщение, без меток говорящих и без кавычек. Верни только текст сообщения.`;

async function mergeWithClaude(a: string, b: string): Promise<string | null> {
  if (!config.claude.apiKey) return null;
  try {
    const client = new Anthropic({ apiKey: config.claude.apiKey });
    const response = await client.messages.create({
      model: config.ropAgent.digestModel,
      max_tokens: 4000,
      system: MERGE_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: `Расшифровка 1 (ElevenLabs):\n${a}\n\nРасшифровка 2 (AISHA):\n${b}` }],
    });
    if (response.stop_reason === 'refusal') return null;
    const text = response.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map((c) => c.text).join('').trim();
    return text || null;
  } catch (err) {
    console.error('[rop-voice] merge failed:', (err as Error).message);
    return null;
  }
}

export async function transcribeVoiceNote(filePath: string): Promise<string> {
  const eleven = config.elevenlabs.apiKey;
  const aisha = config.aisha.apiKey;
  if (!eleven && !aisha) {
    throw new AppError(503, 'Расшифровка голоса не настроена (ELEVENLABS_API_KEY / AISHA_AI_API_KEY)');
  }

  const [el, ai] = await Promise.all([
    eleven
      ? transcribeWithElevenLabs(filePath, eleven, { languageMode: 'auto' })
        // rawText — сплошная речь; в text у ElevenLabs диалог с метками говорящих.
        .then((r) => ({ text: r.rawText.trim(), lang: r.languageCode }))
        .catch((err) => { console.error('[rop-voice] elevenlabs:', (err as Error).message); return null; })
      : Promise.resolve(null),
    aisha
      ? transcribeWithAisha(filePath, aisha, { languageMode: 'uz', baseUrl: config.aisha.baseUrl, hasDiarization: false })
        .then((r) => ({ text: r.text.trim() }))
        .catch((err) => { console.error('[rop-voice] aisha:', (err as Error).message); return null; })
      : Promise.resolve(null),
  ]);

  return chooseVoiceText({ elText: el?.text ?? '', elLang: el?.lang ?? '', aiText: ai?.text ?? '' }, mergeWithClaude);
}

/**
 * Какой текст отдать агенту. Оба движка — сводим через Claude; один движок или сбой
 * склейки — русскую речь лучше слышит ElevenLabs, узбекскую — AISHA.
 */
export async function chooseVoiceText(
  r: { elText: string; elLang: string; aiText: string },
  merge: (a: string, b: string) => Promise<string | null>,
): Promise<string> {
  const { elText, elLang, aiText } = r;
  if (!elText && !aiText) throw new AppError(502, 'Не удалось распознать голосовое. Попробуйте ещё раз или напишите текстом.');
  if (elText && aiText) {
    const merged = await merge(elText, aiText);
    if (merged) return merged;
  }
  if (elText && (!aiText || elLang.startsWith('ru'))) return elText;
  return aiText || elText;
}
