# Админка сайта Polygraph Business

Сайт: **https://polygraph-business.onrender.com**

Админ-панель в CRM: **https://www.polygraphbusinesscrm.app/admin** (вход → вкладка **Админ**)

Оба используют один Supabase — изменения в CRM сразу на сайте.

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
