import { create } from 'zustand';
import {
  clearCustomBackground,
  loadCustomBackground,
  prepareBackground,
  saveCustomBackground,
} from '../lib/customBackground';

/**
 * Свой фон стеклянного дизайна на этом устройстве. Сам фон подставляется через
 * CSS-переменную `--glass-bg-image` (см. theme/glass.css); без неё — стандартное фото.
 */
interface BackgroundState {
  url: string | null;
  init: () => Promise<void>;
  setFromFile: (file: File) => Promise<void>;
  reset: () => Promise<void>;
}

function apply(blob: Blob | null, previous: string | null): string | null {
  if (previous) URL.revokeObjectURL(previous);
  const root = document.documentElement;
  if (!blob) {
    root.style.removeProperty('--glass-bg-image');
    return null;
  }
  const url = URL.createObjectURL(blob);
  root.style.setProperty('--glass-bg-image', `url("${url}")`);
  return url;
}

export const useBackgroundStore = create<BackgroundState>((set, get) => ({
  url: null,
  init: async () => {
    const blob = await loadCustomBackground();
    if (blob) set({ url: apply(blob, get().url) });
  },
  setFromFile: async (file) => {
    const blob = await prepareBackground(file);
    await saveCustomBackground(blob);
    set({ url: apply(blob, get().url) });
  },
  reset: async () => {
    await clearCustomBackground();
    set({ url: apply(null, get().url) });
  },
}));
