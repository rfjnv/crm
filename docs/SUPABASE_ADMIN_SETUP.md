# Supabase Admin — настройка CRM

Роли **superadmin** и **admin** хранятся в Supabase Auth `user_metadata.role` и используются для входа во вкладке «Admin (email)» на странице логина CRM.

## Переменные окружения

### Backend (`backend/.env`)

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # только на сервере, не во фронтенд!
```

### Frontend (`frontend/.env`)

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Ключи возьмите из того же проекта Supabase, что и у `Polygraph-Business` (Dashboard → Project Settings → API).

## Первый Superadmin

1. Supabase → **Authentication** → **Users** → выберите пользователя (или **Add user**).
2. **Edit user** → блок **User Metadata** (не App Metadata!) → Raw JSON:

```json
{
  "role": "superadmin"
}
```

3. **Save** → выйдите из CRM и войдите снова через **Admin (email)**.

Допустимые значения `role`: `superadmin`, `admin` (регистр не важен: `SUPER_ADMIN` тоже сработает).

**Частые ошибки:**
- роль прописана в **App Metadata** вместо **User Metadata**;
- опечатка в JSON или лишние кавычки;
- вход до сохранения metadata — перелогиньтесь после Save.

## Права

| Роль (metadata) | CRM |
|-----------------|-----|
| `superadmin` | Полный доступ + раздел **Пользователи** (`/admin/users`) |
| `admin` | Все рабочие разделы, без управления пользователями |

## API (только superadmin, Bearer CRM JWT после exchange)

- `POST /api/supabase-auth/exchange` — обмен Supabase access token на CRM JWT (публичный)
- `GET /api/supabase-auth/users` — список
- `POST /api/supabase-auth/users` — создать
- `PATCH /api/supabase-auth/users/:id` — сменить роль
- `DELETE /api/supabase-auth/users/:id` — удалить (нельзя удалить себя)

Сотрудники с логином/паролем Prisma по-прежнему входят на вкладке **Сотрудники**.
