/**
 * Диагностика пустого экрана там, где нет консоли — прежде всего Telegram Web App.
 *
 * ErrorBoundary ловит только падения при рендере React — ошибки в промисах и
 * обработчиках событий проходят мимо него и в Telegram остаются полностью
 * невидимыми, потому что консоли там нет.
 *
 * Случай «экран пустой, но исключения не было» держит сторож в index.html:
 * он на ES5 и переживает даже отказ этого бандла.
 */

declare global {
  interface Window {
    /** Ставится в main.tsx; сторож в index.html по нему отличает отказ движка от пустого рендера. */
    __crmBooted?: boolean;
  }
}

const BANNER_ID = 'crm-error-banner';

function shorten(text: string, max = 600): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
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

export function installBlankScreenReporter(): void {
  window.addEventListener('error', (event) => {
    // Сбойная картинка или стиль — не повод перекрывать весь экран.
    if (event.target !== window) return;
    const where = event.filename ? `\n${event.filename}:${event.lineno}:${event.colno}` : '';
    showBanner('Ошибка в приложении', shorten(`${event.message}${where}`));
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const text = reason instanceof Error
      ? `${reason.message}\n\n${reason.stack ?? ''}`
      : String(reason);
    showBanner('Необработанная ошибка запроса', shorten(text));
  });
}
