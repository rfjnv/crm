import axios from 'axios';
import type { AxiosError } from 'axios';
import { enrichUserFromMe } from '../lib/authUser';
import { useAuthStore } from '../store/authStore';
import { getDeviceId } from '../lib/deviceId';
import { getTelegramInitData } from '../lib/telegramWebApp';

export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000/api' : '/api');

const client = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

/**
 * Потолок ожидания для читающих запросов. Без него зависший ответ висит до
 * упора: бэкенд после простоя просыпается почти минуту, и всё это время
 * страница выглядит намертво загружающейся.
 *
 * Только GET: загрузка файлов и импорт легально идут дольше, обрывать их нельзя.
 */
const GET_TIMEOUT_MS = 60_000;
/** Сколько раз повторить GET, если ответа не было вовсе. */
const MAX_NETWORK_RETRIES = 2;

function isGet(config: { method?: string }): boolean {
  return (config.method ?? 'get').toLowerCase() === 'get';
}

/** Ответа не пришло: обрыв связи или наш таймаут. Отменённый запрос сюда не попадает. */
function isRetriableNetworkError(error: AxiosError): boolean {
  return !error.response && (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED');
}

// Request interceptor: attach access token
client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token && token !== 'undefined') {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers['X-Device-Id'] = getDeviceId();
  // 0 — это «без ограничения» из умолчаний axios, то есть значение не задавали.
  if (!config.timeout && isGet(config)) {
    config.timeout = GET_TIMEOUT_MS;
  }
  return config;
});

// Response interceptor: handle 401 with refresh
let isRefreshing = false;
let failedQueue: { resolve: (token: string) => void; reject: (err: unknown) => void }[] = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => {
    if (error) {
      p.reject(error);
    } else {
      p.resolve(token!);
    }
  });
  failedQueue = [];
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Сеть моргнула или бэкенд просыпался — повторяем сами. Только GET: он
    // безопасен для повтора, в отличие от создания сделки или платежа.
    if (originalRequest && isRetriableNetworkError(error) && isGet(originalRequest)) {
      const attempt = (originalRequest._netRetry ?? 0) + 1;
      if (attempt <= MAX_NETWORK_RETRIES) {
        originalRequest._netRetry = attempt;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
        return client(originalRequest);
      }
    }

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Don't retry refresh/login endpoints
    if (originalRequest.url?.includes('/auth/')) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(client(originalRequest));
          },
          reject,
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      // refreshToken comes from HttpOnly cookie automatically (withCredentials: true)
      const { data } = await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true });
      useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
      // Refresh user data so permissions stay up-to-date
      try {
        const meRes = await axios.get(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${data.accessToken}` },
        });
        const prev = useAuthStore.getState().user;
        useAuthStore.getState().setAuth(
          enrichUserFromMe(meRes.data, prev),
          data.accessToken,
          data.refreshToken,
        );
      } catch { /* tokens already updated */ }
      processQueue(null, data.accessToken);
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      return client(originalRequest);
    } catch (refreshError) {
      // Refresh cookie не пережила — вероятно, кроссдоменная cookie заблокирована
      // встроенным WebView Telegram. Если это Telegram Mini App, тихо перелогиниваемся
      // через initData вместо того чтобы выкидывать пользователя на экран входа.
      const tgInitData = getTelegramInitData();
      if (tgInitData) {
        try {
          const { data } = await axios.post(
            `${API_URL}/auth/telegram-webapp`,
            { initData: tgInitData },
            { withCredentials: true },
          );
          useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
          try {
            const meRes = await axios.get(`${API_URL}/auth/me`, {
              headers: { Authorization: `Bearer ${data.accessToken}` },
            });
            const prev = useAuthStore.getState().user;
            useAuthStore.getState().setAuth(
              enrichUserFromMe(meRes.data, prev),
              data.accessToken,
              data.refreshToken,
            );
          } catch { /* tokens already updated */ }
          processQueue(null, data.accessToken);
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
          return client(originalRequest);
        } catch {
          // Telegram re-auth тоже не сработал (напр. отвязан от CRM) — падаем на обычный логаут ниже
        }
      }

      processQueue(refreshError, null);
      useAuthStore.getState().logout();
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default client;
