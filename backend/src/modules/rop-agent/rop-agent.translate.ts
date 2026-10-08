import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../lib/config';

/**
 * Задачи менеджерам — на узбекском (кириллица), с русским текстом ниже: менеджерам
 * так проще, а директор видит, что поставлено. Агент и директор пишут по-русски,
 * перевод делается при раздаче. Сбой перевода не мешает раздаче — задача уйдёт по-русски.
 */

const PROMPT = `Переведи тексты задач из CRM с русского на узбекский язык, кириллицей (ўзбек тилида, кирилл алифбосида: ў, қ, ғ, ҳ).
Это поручения менеджерам по продажам компании, которая торгует расходниками для типографий в Ташкенте.
- Пиши просто и по-деловому, как руководитель пишет своему менеджеру, на «Сиз».
- Названия клиентов, компаний, товаров, марок, артикулы, телефоны, суммы, даты и единицы измерения оставляй как есть.
- Ничего не добавляй и не сокращай. Пустую строку верни пустой.
- Верни столько же строк и в том же порядке.
Ответь строго JSON по схеме.`;

const SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'string' } } },
  required: ['items'],
  additionalProperties: false,
};

export function tasksInUzbek(): boolean {
  return config.ropAgent.taskLanguage === 'uz-cyrl';
}

/** Перевод пачкой. null — перевод выключен или не удался (тогда задачи остаются по-русски). */
export async function toUzbekCyrillic(texts: string[]): Promise<string[] | null> {
  if (!tasksInUzbek() || !config.claude.apiKey || !config.ropAgent.enabled || !texts.length) return null;
  try {
    const client = new Anthropic({ apiKey: config.claude.apiKey });
    const response = await client.messages.create({
      model: config.ropAgent.digestModel,
      max_tokens: 16000,
      system: PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: JSON.stringify(texts) }],
    });
    if (response.stop_reason !== 'end_turn') return null;
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    const items = (JSON.parse(text) as { items: unknown[] }).items;
    if (!Array.isArray(items) || items.length !== texts.length) return null;
    return items.map((t, i) => (typeof t === 'string' && t.trim() ? t.trim() : texts[i]));
  } catch (err) {
    console.error('[rop-translate] failed, tasks stay in Russian:', (err as Error).message);
    return null;
  }
}

/** Название: «узбекский / русский», если влезает, иначе только узбекский. */
export function bilingualTitle(uz: string | undefined, ru: string, max: number): string {
  if (!uz || uz === ru) return ru.slice(0, max);
  const both = `${uz} / ${ru}`;
  return both.length <= max ? both : uz.slice(0, max);
}

/** Текст: узбекский, ниже — русский. */
export function bilingualText(uz: string | undefined, ru: string): string {
  if (!ru) return '';
  if (!uz || uz === ru) return ru;
  return `${uz}\n\n— По-русски —\n${ru}`;
}
