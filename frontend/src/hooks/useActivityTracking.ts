import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { activityApi } from '../api/activity.api';

const HEARTBEAT_INTERVAL_MS = 60_000;
const IDLE_THRESHOLD_MS = 3 * 60_000;
const INTERACTION_THROTTLE_MS = 1000;

/**
 * Шлёт PAGE_VIEW при смене маршрута и HEARTBEAT раз в минуту — но только пока вкладка
 * видима, в фокусе и пользователь реально что-то делает (мышь/клавиатура/скролл за последние
 * 3 минуты). Просто открытая без действий вкладка heartbeat не шлёт — так админ видит
 * реальное время активности, а не «сколько браузер был открыт».
 */
export function useActivityTracking(): void {
  const location = useLocation();
  const lastReportedPathRef = useRef<string | null>(null);
  const lastInteractionAtRef = useRef<number>(Date.now());
  const lastInteractionThrottleRef = useRef<number>(0);

  useEffect(() => {
    if (lastReportedPathRef.current === location.pathname) return;
    lastReportedPathRef.current = location.pathname;
    activityApi.report('PAGE_VIEW', location.pathname).catch(() => {});
  }, [location.pathname]);

  useEffect(() => {
    const onInteraction = () => {
      const now = Date.now();
      if (now - lastInteractionThrottleRef.current < INTERACTION_THROTTLE_MS) return;
      lastInteractionThrottleRef.current = now;
      lastInteractionAtRef.current = now;
    };

    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, onInteraction, { passive: true }));

    const interval = setInterval(() => {
      const isVisible = document.visibilityState === 'visible' && document.hasFocus();
      const isActive = Date.now() - lastInteractionAtRef.current < IDLE_THRESHOLD_MS;
      if (isVisible && isActive) {
        activityApi.report('HEARTBEAT', window.location.pathname).catch(() => {});
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onInteraction));
      clearInterval(interval);
    };
  }, []);
}
