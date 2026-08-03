import { create } from 'zustand';
import { safeStorage } from '../lib/safeStorage';

/**
 * Собственный масштаб интерфейса.
 *
 * На настенной Android-панели CRM открыта без браузерной обвязки: привычного
 * «уменьшить зум» там просто нет, а панель отдаёт небольшую CSS-ширину при
 * огромной диагонали — интерфейс выглядит крупным и на экран влезает мало.
 * Этот масштаб даёт то же, что зум браузера, но средствами приложения и
 * запоминается для конкретного устройства.
 */

const KEY = 'crm_ui_scale';

/** Ниже 50% интерфейс уже нечитаем, выше 150% — теряет смысл на панели. */
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 1.5;
export const SCALE_STEP = 0.1;

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

function readStored(): number {
  const raw = safeStorage.getItem(KEY);
  return raw ? clamp(Number(raw)) : 1;
}

/**
 * `zoom` на корне масштабирует и отрисовку, и раскладку — в отличие от
 * `transform: scale()`, который оставил бы исходные размеры и породил
 * полосы прокрутки. Значение 1 убираем совсем, чтобы не влиять на обычные браузеры.
 */
export function applyUiScale(scale: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (scale === 1) {
    root.style.removeProperty('zoom');
  } else {
    root.style.setProperty('zoom', String(scale));
  }
  // Единицы vh масштаб не учитывают: при zoom 0.6 «100vh» покрывает лишь 60%
  // экрана по высоте и внизу остаётся полоса пустоты. Через эту переменную
  // --app-vh в mobile.css делит высоту на масштаб и снова достаёт до низа.
  root.style.setProperty('--ui-scale', String(scale));
}

interface UiScaleState {
  scale: number;
  setScale: (value: number) => void;
  step: (delta: number) => void;
  reset: () => void;
}

export const useUiScaleStore = create<UiScaleState>((set, get) => ({
  scale: readStored(),

  setScale: (value) => {
    const scale = clamp(value);
    safeStorage.setItem(KEY, String(scale));
    applyUiScale(scale);
    set({ scale });
  },

  step: (delta) => get().setScale(get().scale + delta),

  reset: () => get().setScale(1),
}));
