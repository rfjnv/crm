// Первым импортом: полифилы должны встать до вычисления остальных модулей.
import './lib/polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installBlankScreenReporter } from './lib/blankScreenReporter';
import { safeStorage } from './lib/safeStorage';
import { applyUiScale, useUiScaleStore } from './store/uiScaleStore';
import { applyDocumentTheme } from './theme/applyDocumentTheme';
import type { ThemeMode } from './theme/tokens';
import './theme/theme-variables.css';
import './mobile.css';

// Сообщаем сторожу из index.html, что бандл дожил до выполнения: это отличает
// «движок не понял код» от «код отработал, но экран остался пустым».
window.__crmBooted = true;

installBlankScreenReporter();

const stored = safeStorage.getItem('theme');
applyDocumentTheme(stored === 'dark' || stored === 'light' ? (stored as ThemeMode) : 'light');

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
