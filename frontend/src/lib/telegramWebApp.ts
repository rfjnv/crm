interface TelegramWebAppApi {
  initData: string;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  BackButton?: { hide: () => void; show: () => void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebAppApi };
  }
}

/** true, если страница открыта внутри Telegram (Web App) и есть подписанные initData. */
export function getTelegramInitData(): string | null {
  const webApp = window.Telegram?.WebApp;
  return webApp?.initData ? webApp.initData : null;
}

export function initTelegramWebApp(): void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  try {
    webApp.ready();
    webApp.expand();
    webApp.BackButton?.hide();
  } catch {
    // не критично — SDK мог не успеть проинициализироваться
  }
}
