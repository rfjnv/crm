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

1. CRM → `/login` → вкладка **Email**
2. Email и пароль из Supabase (те же, что для админки сайта Polygraph Business)
3. После входа в меню **СИСТЕМА** → **Пользователи** (`/admin/users`) — список, создание и удаление аккаунтов

## Сотрудники CRM

Вход по логину/паролю (вкладка **Сотрудники**) — как раньше, через Prisma. Это отдельные учётки для менеджеров, склада и т.д.
