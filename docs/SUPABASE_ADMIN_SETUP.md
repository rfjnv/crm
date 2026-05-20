# Supabase — вход по email в CRM

Любой пользователь из **Supabase Authentication** может войти в CRM через вкладку **Email** на странице логина. Настраивать роли в Supabase Dashboard **не нужно**.

## Переменные окружения

### Backend (`backend/.env` / Render → crm-backend)

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Frontend

Ключи подтягиваются с backend автоматически (`/api/supabase-auth/config`). Опционально можно задать `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` при сборке.

## Вход

1. CRM → `/login` → вкладка **Админ**
2. Email и пароль из Supabase
3. Откроется **панель администратора** (`/admin`) — не полный CRM

В панели: **Обзор**, **Пользователи**, ссылка на админку сайта (контент, блог, заявки).

Операционный CRM (сделки, склад…) — вкладка **Сотрудники**, отдельные логины Prisma.
