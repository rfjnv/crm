import { useCallback, useState } from 'react';
import { safeStorage } from '../lib/safeStorage';

const keyFor = (userId: string | undefined) => `crm_menu_pins:${userId ?? 'anon'}`;

function read(userId: string | undefined): string[] {
  try {
    const parsed = JSON.parse(safeStorage.getItem(keyFor(userId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Пункты меню, которые человек закрепил в «Главном» (ключи пунктов по порядку).
 * Хранятся в браузере отдельно для каждого пользователя.
 */
export function useMenuPins(userId: string | undefined) {
  const [state, setState] = useState(() => ({ userId, pins: read(userId) }));
  // Сменился пользователь в той же вкладке — читаем его набор
  const pins = state.userId === userId ? state.pins : read(userId);

  const save = useCallback(
    (next: string[]) => {
      setState({ userId, pins: next });
      safeStorage.setItem(keyFor(userId), JSON.stringify(next));
    },
    [userId],
  );

  /** Закрепить (или передвинуть) пункт на место `index` среди закреплённых. */
  const pin = useCallback(
    (key: string, index: number) => {
      const rest = pins.filter((k) => k !== key);
      const at = Math.max(0, Math.min(index, rest.length));
      save([...rest.slice(0, at), key, ...rest.slice(at)]);
    },
    [pins, save],
  );

  const unpin = useCallback((key: string) => save(pins.filter((k) => k !== key)), [pins, save]);

  return { pins, pin, unpin };
}
