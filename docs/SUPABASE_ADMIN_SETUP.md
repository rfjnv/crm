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

## Static Site на Render (polygraph-business.onrender.com)

Обязательно при **сборке** (иначе сайт всегда показывает `dictionaries.ts`):

```env
VITE_SUPABASE_URL=https://ваш-проект.supabase.co
VITE_SUPABASE_ANON_KEY=anon или publishable ключ
```

После добавления переменных — **пересоберите** Static Site (Manual Deploy).

`SUPABASE_SERVICE_ROLE_KEY` на статик-сайт **не** ставить.

## Если в админке CRM сохраняете, а на проде не меняется

1. **CRM → /admin → Обзор** — если предупреждение «сайт на fallback» → **Импорт с сайта**.
2. Убедитесь, что после «Сохранить» в **Обзор** растёт число записей и дата «последнее изменение».
3. На Static Site заданы `VITE_SUPABASE_*` и был **deploy после** их добавления.
4. Откройте сайт с **Ctrl+F5** (не только переход по меню внутри SPA).
5. Редактируйте нужную **секцию** и **локаль** (RU/UZ/EN) — главная берёт поля из `hero`, `products` и т.д.
6. В браузере на сайте F12 → Console: ошибка `[useContent] Supabase load failed` = неверный ключ или пустая БД.

## Переменные frontend CRM (опционально)

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
