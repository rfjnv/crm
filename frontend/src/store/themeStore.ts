import { create } from 'zustand';

type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: (localStorage.getItem('theme') as ThemeMode) || 'light',
  toggle: () =>
    set((state) => {
      const next = state.mode === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      return { mode: next };
    }),
}));
