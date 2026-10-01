import { describe, expect, it } from 'vitest';
import { buildSearchVariants, escapeLike } from './translit';

describe('escapeLike', () => {
  it('экранирует %, _ и обратный слэш', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
  it('обычный текст не трогает', () => {
    expect(escapeLike('Медиамакс 7')).toBe('Медиамакс 7');
  });
});

describe('buildSearchVariants', () => {
  it.each(['%', '_', '(', '.*', '@', '   '])('запрос без букв и цифр — без фильтра: %s', (q) => {
    expect(buildSearchVariants(q)).toEqual([]);
  });
  it('варианты экранированы', () => {
    expect(buildSearchVariants('100%')).toContain('100\\%');
  });
  it('«Баёз» ищет и «Баез»', () => {
    expect(buildSearchVariants('Баёз')).toContain('Баез');
  });
});
