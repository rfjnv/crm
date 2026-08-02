import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installBlankScreenReporter } from './lib/blankScreenReporter';
import { safeStorage } from './lib/safeStorage';
import { applyDocumentTheme } from './theme/applyDocumentTheme';
import type { ThemeMode } from './theme/tokens';
import './theme/theme-variables.css';
import './mobile.css';

installBlankScreenReporter();

const stored = safeStorage.getItem('theme');
applyDocumentTheme(stored === 'dark' || stored === 'light' ? (stored as ThemeMode) : 'light');

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
