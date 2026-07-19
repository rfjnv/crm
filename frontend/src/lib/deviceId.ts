const KEY = 'crm_device_id';

/** Персистентный ID этого браузера/устройства. Переживает logout — намеренно, чтобы связывать действия разных аккаунтов на одном физическом устройстве. */
export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
