import { safeStorage } from './safeStorage';

const KEY = 'crm_device_id';

/**
 * `crypto.randomUUID` есть только в защищённом контексте и с Safari 15.4 —
 * во встроенном WebView его может не быть. Этот код выполняется в axios-интерцепторе
 * на каждом запросе, поэтому исключение здесь обрывает вообще все обращения к API.
 */
function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // падаем на Math.random ниже
  }
  return `fallback-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** Персистентный ID этого браузера/устройства. Переживает logout — намеренно, чтобы связывать действия разных аккаунтов на одном физическом устройстве. */
export function getDeviceId(): string {
  let id = safeStorage.getItem(KEY);
  if (!id) {
    id = randomId();
    safeStorage.setItem(KEY, id);
  }
  return id;
}
