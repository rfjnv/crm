import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Поле поиска, синхронизированное с `?q=` в URL.
 *
 * Источник правды — то, что набрано в поле. В URL значение уходит с задержкой, а обратно
 * в поле подтягивается, только если URL изменили извне (кнопка «назад», переход по ссылке).
 * Раньше URL всегда записывался обратно в поле: смена URL рендерится как transition и на
 * тяжёлой странице применяется позже, чем человек успевает нажать следующую клавишу, —
 * запоздавшее значение откатывало набранные буквы. А trim в URL съедал пробел между словами.
 */
export function useUrlSearchDraft(
  urlValue: string,
  commit: (value: string) => void,
  delayMs = 300,
) {
  const [draft, setDraft] = useState(urlValue);
  /** Последнее значение, которое мы сами отправили в URL. */
  const lastWrittenRef = useRef(urlValue.trim());
  /** Наши записи, до которых URL ещё не дошёл. Их появление в URL — эхо, а не внешнее изменение. */
  const pendingRef = useRef<string[]>([]);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  useEffect(() => {
    const fromUrl = urlValue.trim();
    const echoAt = pendingRef.current.indexOf(fromUrl);
    if (echoAt >= 0) {
      pendingRef.current.splice(0, echoAt + 1);
      return;
    }
    if (fromUrl === lastWrittenRef.current) return;
    pendingRef.current = [];
    lastWrittenRef.current = fromUrl;
    // URL здесь — внешний источник (история браузера), синхронизация из эффекта и есть цель
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(urlValue);
  }, [urlValue]);

  const write = useCallback((value: string) => {
    const next = value.trim();
    if (next === lastWrittenRef.current) return;
    lastWrittenRef.current = next;
    pendingRef.current.push(next);
    commitRef.current(next);
  }, []);

  useEffect(() => {
    if (draft.trim() === lastWrittenRef.current) return undefined;
    const t = window.setTimeout(() => write(draft), delayMs);
    return () => window.clearTimeout(t);
  }, [draft, delayMs, write]);

  /** Записать набранное в URL сразу — перед переходом или по Enter. */
  const flush = useCallback(() => write(draft), [draft, write]);

  return { draft, setDraft, flush };
}
