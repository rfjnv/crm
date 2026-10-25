import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, message } from 'antd';
import { Eye, EyeSlash, LockSimple, SignIn, User } from '@phosphor-icons/react';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/authStore';
import { homePathForUser } from '../lib/authUser';
import miniLogo from '../assets/mini-logo.webp';
import './LoginPage.css';

/** Ответа от сервера не пришло вовсе: обрыв связи или таймаут просыпающегося бэкенда. */
function loginErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } }; code?: string; message?: string };
  const fromServer = e?.response?.data?.error;
  if (fromServer) return fromServer;
  if (!e?.response && (e?.code === 'ERR_NETWORK' || e?.code === 'ECONNABORTED' || e?.message === 'Network Error')) {
    return 'Сервер не отвечает. Проверьте интернет и попробуйте ещё раз.';
  }
  return fallback;
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const onCrmLogin = async (values: { login: string; password: string }) => {
    setLoading(true);
    try {
      const tokens = await authApi.login(values.login, values.password);
      useAuthStore.getState().setTokens(tokens.accessToken, tokens.refreshToken);

      // Пароль уже принят и сессия создана: сбой одного лишь профиля — не отказ во
      // входе, поэтому повторяем запрос, а не показываем «Ошибка входа».
      let user;
      try {
        user = await authApi.me();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 800));
        try {
          user = await authApi.me();
        } catch (meErr) {
          // Половинчатое состояние «токен есть, профиля нет» путает следующий вход —
          // сбрасываем его целиком и просим повторить.
          useAuthStore.getState().logout();
          message.error(loginErrorMessage(meErr, 'Вход выполнен, но профиль не загрузился. Попробуйте ещё раз.'));
          return;
        }
      }

      const fullUser = { ...user, authSource: 'crm' as const };
      setAuth(fullUser, tokens.accessToken, tokens.refreshToken);
      navigate(homePathForUser(fullUser));
    } catch (err: unknown) {
      message.error(loginErrorMessage(err, 'Ошибка входа'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Небо: облака и тонкие кольца вокруг карточки — чистый CSS, без картинок */}
      <div className="auth-sky" aria-hidden>
        <span className="auth-ring auth-ring--1" />
        <span className="auth-ring auth-ring--2" />
        <span className="auth-ring auth-ring--3" />
        <span className="auth-cloud auth-cloud--1" />
        <span className="auth-cloud auth-cloud--2" />
        <span className="auth-cloud auth-cloud--3" />
        <span className="auth-cloud auth-cloud--4" />
      </div>

      <header className="auth-brand">
        <span className="auth-brand__tile"><img src={miniLogo} alt="" /></span>
        <span className="auth-brand__name">Polygraph Business</span>
      </header>

      <main className="auth-card">
        <span className="auth-card__icon" aria-hidden><SignIn size={22} weight="bold" /></span>
        <h1 className="auth-card__title">Вход в CRM</h1>
        <p className="auth-card__subtitle">Продажи, склад и деньги — в одном месте</p>

        <Form className="auth-form" onFinish={onCrmLogin} requiredMark={false}>
          <Form.Item name="login" rules={[{ required: true, message: 'Введите логин' }]}>
            <Input
              prefix={<User size={17} />}
              placeholder="Логин"
              autoComplete="username"
              aria-label="Логин"
            />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
            <Input.Password
              prefix={<LockSimple size={17} />}
              placeholder="Пароль"
              autoComplete="current-password"
              aria-label="Пароль"
              iconRender={(visible) => (visible ? <Eye size={17} /> : <EyeSlash size={17} />)}
            />
          </Form.Item>
          <Button className="auth-submit" htmlType="submit" loading={loading} block>
            Войти
          </Button>
        </Form>

        <div className="auth-card__divider"><span>Нет доступа или забыли пароль?</span></div>
        <p className="auth-card__hint">Обратитесь к администратору компании — он создаст учётную запись или сбросит пароль.</p>
      </main>
    </div>
  );
}
