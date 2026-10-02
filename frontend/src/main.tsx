// Первым импортом: полифилы должны встать до вычисления остальных модулей.
import './lib/polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installBlankScreenReporter } from './lib/blankScreenReporter';
import { safeStorage } from './lib/safeStorage';
import { applyUiScale, useUiScaleStore } from './store/uiScaleStore';
import { useBackgroundStore } from './store/backgroundStore';
import { applyDocumentTheme } from './theme/applyDocumentTheme';
import type { ThemeMode } from './theme/tokens';
import './theme/theme-variables.css';
import './theme/glass.css';
import './mobile.css';

// Сообщаем сторожу из index.html, что бандл дожил до выполнения: это отличает
// «движок не понял код» от «код отработал, но экран остался пустым».
window.__crmBooted = true;

installBlankScreenReporter();

// Страницы грузятся отдельными чанками. После деплоя у давно открытой вкладки старых
// чанков на сервере уже нет — перезагружаемся за свежим index.html. Не чаще раза в
// минуту: если чанк не грузится по другой причине, ошибку покажет ErrorBoundary,
// а не бесконечная перезагрузка.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'crm_chunk_reload_at';
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
  } catch { /* sessionStorage недоступен */ }
  if (Date.now() - last < 60_000) return;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* sessionStorage недоступен */ }
  event.preventDefault();
  window.location.reload();
});

const stored = safeStorage.getItem('theme');
applyDocumentTheme(
  stored === 'dark' || stored === 'light' ? (stored as ThemeMode) : 'light',
  safeStorage.getItem('design') === 'modern' ? 'modern' : 'classic',
);

// Свой фон стеклянного дизайна с этого устройства (IndexedDB, асинхронно — до него виден стандартный)
void useBackgroundStore.getState().init();

// До первой отрисовки, иначе интерфейс скакнёт в размере на глазах у пользователя.
applyUiScale(useUiScaleStore.getState().scale);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Register service worker for PWA + push notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
  });
}
