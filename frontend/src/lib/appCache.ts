import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';

/**
 * Кэш данных для Android-приложения (android-app/). Мост PolygraphNative хранит его
 * зашифрованным во внутренней папке приложения. При запуске страницы сразу показывают
 * сохранённые данные, а свежие догружаются в фоне. В обычном браузере ничего не делает.
 */

interface NativeCacheBridge {
  read(): string | null;
  write(data: string): void;
  clear(): void;
}

declare global {
  interface Window {
    PolygraphNative?: NativeCacheBridge;
  }
}

interface CachedSnapshot {
  userId: string;
  build: string;
  savedAt: number;
  state: DehydratedState;
}

const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const WRITE_THROTTLE_MS = 3_000;

export const isNativeApp = typeof window !== 'undefined' && !!window.PolygraphNative;

/** Хэш бандла меняется при каждом деплое — тогда старый кэш со старой формой данных не поднимаем. */
function currentBuild(): string {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return script?.src.split('/').pop() ?? 'dev';
}

function readSnapshot(bridge: NativeCacheBridge): CachedSnapshot | null {
  try {
    const raw = bridge.read();
    return raw ? (JSON.parse(raw) as CachedSnapshot) : null;
  } catch {
    return null;
  }
}

export function setupAppCache(queryClient: QueryClient): void {
  const bridge = window.PolygraphNative;
  if (!bridge) return;

  // Без этого неактивные запросы выпадают из памяти через 5 минут и не попадают в снимок.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, gcTime: MAX_AGE_MS },
  });

  const build = currentBuild();
  const userId = useAuthStore.getState().user?.id;
  const snapshot = readSnapshot(bridge);
  if (snapshot && userId && snapshot.userId === userId && snapshot.build === build
      && Date.now() - snapshot.savedAt < MAX_AGE_MS) {
    hydrate(queryClient, snapshot.state);
  } else if (snapshot) {
    bridge.clear();
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const user = useAuthStore.getState().user;
    if (!user) return;
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (q) => q.state.status === 'success',
    });
    try {
      bridge.write(JSON.stringify({ userId: user.id, build, savedAt: Date.now(), state } satisfies CachedSnapshot));
    } catch {
      // Не удалось записать — в следующий раз просто загрузим с сервера.
    }
  };

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (!timer) timer = setTimeout(save, WRITE_THROTTLE_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer);
      save();
    }
  });

  // Выход или смена пользователя — стираем и диск, и память, чтобы данные не достались следующему.
  useAuthStore.subscribe((s, prev) => {
    if (s.user?.id === prev.user?.id) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    bridge.clear();
    queryClient.clear();
  });
}
