import { useEffect, useState } from 'react';

/**
 * Возвращает значение с задержкой — чтобы поиск не бил в API на каждое нажатие клавиши.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
