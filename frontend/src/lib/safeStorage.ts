/**
 * localStorage, который не роняет приложение.
 *
 * CRM открывается внутри iframe на web.telegram.org (см. frame-ancestors в
 * render.yaml), а в стороннем iframe обращение к localStorage может выбросить
 * SecurityError — браузер блокирует хранилище третьих сторон. То же бывает в
 * приватном режиме и встроенных WebView.
 *
 * Раньше такой бросок происходил на старте (тема, authStore) и в axios-интерцепторе,
 * то есть до монтирования React — экран оставался пустым без единого следа.
 * Здесь storage деградирует до памяти: данные живут до перезагрузки, но
 * приложение работает.
 */

const memory = new Map<string, string>();

let available: boolean | null = null;

function storageWorks(): boolean {
  if (available !== null) return available;
  try {
    const probe = '__crm_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export const safeStorage = {
  getItem(key: string): string | null {
    if (!storageWorks()) return memory.get(key) ?? null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },

  setItem(key: string, value: string): void {
    memory.set(key, value);
    if (!storageWorks()) return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Квота или заблокированное хранилище — значение уже лежит в памяти.
    }
  },

  removeItem(key: string): void {
    memory.delete(key);
    if (!storageWorks()) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // см. setItem
    }
  },
};

/** true, когда браузер запретил постоянное хранилище и мы работаем из памяти. */
export function isStoragePersistent(): boolean {
  return storageWorks();
}
