# Админка сайта Polygraph Business

Сайт: **https://polygraph-business.onrender.com**

Админ-панель в CRM: **https://www.polygraphbusinesscrm.app/admin** (вход → вкладка **Админ**)

Оба используют один Supabase — изменения в CRM сразу на сайте.

## Один раз: создать таблицы в Supabase

Если видите ошибку **Could not find the table 'public.content'**:

1. [Supabase Dashboard](https://supabase.com/dashboard) → ваш проект → **SQL** → **New query**
2. Скопируйте и выполните весь файл **`docs/supabase-cms-schema.sql`** из репозитория CRM (Run)
3. Подождите ~10 секунд и обновите админку в CRM

Таблицы: `content`, `products`, `services`, `blog_posts`, `inquiries`, bucket `images`.

## Переменные backend

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Переменные frontend (опционально)

```env
VITE_MARKETING_SITE_URL=https://polygraph-business.onrender.com
```

Ключи Supabase можно не задавать на фронте — подтягиваются с backend.

## Разделы в CRM `/admin`

| Раздел | Что редактирует |
|--------|-----------------|
| Тексты | content (RU/UZ/EN) |
| Продукция | products + фото |
| Услуги | services |
| Блог | blog_posts |
| Заявки | inquiries |
| Пользователи | Supabase Auth (email) |

## Вход

1. `/login` → **Админ** → email + пароль Supabase
2. Откроется `/admin` (не полный CRM)

Сотрудники CRM: вкладка **Сотрудники**.

## SPA на Render (сайт)

В репозитории Polygraph-Business добавлен `public/_redirects` — после деплоя сайта работают прямые ссылки вида `/admin` на домене сайта.
