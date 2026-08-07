/**
 * Диагностика пустого экрана там, где нет консоли — прежде всего Telegram Web App.
 *
 * ErrorBoundary ловит только падения при рендере React — ошибки в промисах и
 * обработчиках событий проходят мимо него и в Telegram остаются полностью
 * невидимыми, потому что консоли там нет.
 *
 * Случай «экран пустой, но исключения не было» держит сторож в index.html:
 * он на ES5 и переживает даже отказ этого бандла.
 *
 * Важно: полноэкранный баннер — только для реально пустого экрана. Пока
 * интерфейс отрисован, приложение живо, и одиночный сбойный запрос (моргнул
 * мобильный интернет, бэкенд просыпался после простоя) не должен закрывать
 * работу белым прямоугольником — для этого есть тост внизу.
 */

declare global {
  interface Window {
    /** Ставится в main.tsx; сторож в index.html по нему отличает отказ движка от пустого рендера. */
    __crmBooted?: boolean;
  }
}

const BANNER_ID = 'crm-error-banner';
const TOAST_ID = 'crm-error-toast';
const TOAST_TIMEOUT_MS = 8000;

function shorten(text: string, max = 600): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Приложение отрисовалось — значит, оно живо и перекрывать его нельзя. */
function isAppRendered(): boolean {
  const root = document.getElementById('root');
  return !!root && root.childElementCount > 0;
}

/**
 * Отменённые запросы — штатная ситуация: react-query рвёт их при уходе со
 * страницы. Показывать по ним хоть что-то — значит пугать пользователя на
 * ровном месте.
 */
function isAbortError(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object') return false;
  const { name, code } = reason as { name?: string; code?: string };
  return name === 'AbortError' || name === 'CanceledError' || code === 'ERR_CANCELED';
}

/** Сервер не ответил вовсе: сон бэкенда, обрыв связи, таймаут. */
function isNetworkError(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object') return false;
  const { code, message } = reason as { code?: string; message?: string };
  return code === 'ERR_NETWORK' || code === 'ECONNABORTED' || message === 'Network Error';
}

function showToast(text: string): void {
  // Один тост за раз: каскад сбойных запросов не должен превращаться в стену.
  document.getElementById(TOAST_ID)?.remove();

  const wrap = document.createElement('div');
  wrap.id = TOAST_ID;
  wrap.setAttribute('role', 'status');
  // pointer-events:none на обёртке — тост не должен перехватывать клики по интерфейсу.
  wrap.style.cssText = [
    'position:fixed',
    'left:50%',
    'transform:translateX(-50%)',
    'bottom:calc(16px + env(safe-area-inset-bottom, 0px))',
    'z-index:99999',
    'max-width:min(520px, calc(100vw - 32px))',
    'pointer-events:none',
    'font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
  ].join(';');

  const box = document.createElement('div');
  box.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:12px 14px',
    'border-radius:10px',
    'background:#2b2b2b',
    'color:#fff',
    'box-shadow:0 6px 24px rgba(0,0,0,.28)',
    'pointer-events:auto',
  ].join(';');

  const label = document.createElement('span');
  label.textContent = text;
  label.style.cssText = 'flex:1;min-width:0';

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Закрыть');
  close.style.cssText = [
    'flex:none',
    'border:0',
    'background:transparent',
    'color:#fff',
    'font-size:15px',
    'line-height:1',
    'padding:4px',
    'cursor:pointer',
    'opacity:.7',
  ].join(';');
  close.onclick = () => wrap.remove();

  box.append(label, close);
  wrap.appendChild(box);
  document.body.appendChild(wrap);

  window.setTimeout(() => wrap.remove(), TOAST_TIMEOUT_MS);
}

function showBanner(title: string, detail: string): void {
  // Один баннер за сессию: каскад ошибок не должен превращаться в стену текста.
  if (document.getElementById(BANNER_ID)) return;

  const box = document.createElement('div');
  box.id = BANNER_ID;
  box.setAttribute('role', 'alert');
  box.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:#fff', 'color:#1f1f1f', 'padding:20px 16px',
    'font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    'overflow:auto', '-webkit-overflow-scrolling:touch',
  ].join(';');

  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.style.cssText = 'margin:0 0 8px;font-size:17px;color:#cf1322';

  const hint = document.createElement('p');
  hint.textContent = 'Покажите этот текст разработчику — он указывает на причину.';
  hint.style.cssText = 'margin:0 0 12px;color:#595959';

  const pre = document.createElement('pre');
  pre.textContent = detail;
  pre.style.cssText = [
    'margin:0 0 16px', 'padding:12px', 'background:#f5f5f5', 'border-radius:8px',
    'white-space:pre-wrap', 'word-break:break-word', 'font-size:12px', 'color:#262626',
  ].join(';');

  const reload = document.createElement('button');
  reload.textContent = 'Обновить страницу';
  reload.style.cssText = [
    'padding:10px 18px', 'border:0', 'border-radius:8px',
    'background:#22609A', 'color:#fff', 'font-size:15px', 'cursor:pointer',
  ].join(';');
  reload.onclick = () => window.location.reload();

  box.append(heading, hint, pre, reload);
  document.body.appendChild(box);
}

/**
 * Экран пустой — показываем трейс во весь экран (иначе в Telegram причину не
 * увидеть). Интерфейс на месте — обходимся тостом.
 */
function report(title: string, detail: string, toastText: string): void {
  if (isAppRendered()) {
    showToast(toastText);
    return;
  }
  showBanner(title, detail);
}

export function installBlankScreenReporter(): void {
  window.addEventListener('error', (event) => {
    // Сбойная картинка или стиль — не повод перекрывать весь экран.
    if (event.target !== window) return;
    const where = event.filename ? `\n${event.filename}:${event.lineno}:${event.colno}` : '';
    report(
      'Ошибка в приложении',
      shorten(`${event.message}${where}`),
      'Что-то пошло не так. Если данные не обновились — обновите страницу.',
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (isAbortError(reason)) return;

    const text = reason instanceof Error
      ? `${reason.message}\n\n${reason.stack ?? ''}`
      : String(reason);

    report(
      'Необработанная ошибка запроса',
      shorten(text),
      isNetworkError(reason)
        ? 'Нет связи с сервером. Проверьте интернет — данные могут быть неполными.'
        : 'Запрос не выполнился. Попробуйте ещё раз.',
    );
  });
}
