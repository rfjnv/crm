import { create } from 'zustand';
import { safeStorage } from '../lib/safeStorage';
import type { DesignMode } from '../theme/tokens';

type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  design: DesignMode;
  toggle: () => void;
  toggleDesign: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: (safeStorage.getItem('theme') as ThemeMode) || 'light',
  design: safeStorage.getItem('design') === 'modern' ? 'modern' : 'classic',
  toggle: () =>
    set((state) => {
      const next = state.mode === 'light' ? 'dark' : 'light';
      safeStorage.setItem('theme', next);
      return { mode: next };
    }),
  toggleDesign: () =>
    set((state) => {
      const next: DesignMode = state.design === 'classic' ? 'modern' : 'classic';
      safeStorage.setItem('design', next);
      return { design: next };
    }),
}));
