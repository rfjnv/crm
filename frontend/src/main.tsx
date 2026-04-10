import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyDocumentTheme } from './theme/applyDocumentTheme';
import type { ThemeMode } from './theme/tokens';
import './theme/theme-variables.css';
import './mobile.css';

const stored = localStorage.getItem('theme');
applyDocumentTheme(stored === 'dark' || stored === 'light' ? (stored as ThemeMode) : 'light');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register service worker for PWA + push notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
  });
}
