import { create } from 'zustand';
import { safeStorage } from '../lib/safeStorage';

type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: (safeStorage.getItem('theme') as ThemeMode) || 'light',
  toggle: () =>
    set((state) => {
      const next = state.mode === 'light' ? 'dark' : 'light';
      safeStorage.setItem('theme', next);
      return { mode: next };
    }),
}));
