# Telegram Mini App — магазин клиентского бота

Витрина с фотографиями товаров внутри клиентского Telegram-бота. Данные — из CRM,
заказ создаёт ту же сделку, что и текстовый сценарий бота.

## Что где лежит

| Часть | Путь |
|---|---|
| Интерфейс (статика) | `backend/public/miniapp/` — `index.html`, `styles.css`, `app.js` |
| API мини-аппы | `backend/src/modules/telegram/telegram-miniapp.routes.ts` |
| Проверка подписи Telegram | `backend/src/modules/telegram/telegram-miniapp.auth.ts` |
| Общая логика заказа (бот + мини-апп) | `backend/src/modules/telegram/telegram-order.service.ts` |
| Раздача статики и CSP | `backend/src/app.ts` (блок `/miniapp` до общего `helmet`) |

Мини-аппу раздаёт сам бэкенд: `https://<backend>/miniapp/`. Отдельный деплой не нужен,
фотографии товаров (`/uploads/products/...`) при этом лежат на том же origin.

## Включение

1. Бэкенд должен быть доступен по HTTPS. На Render `RENDER_EXTERNAL_URL` подставляется сам,
   локально задайте `BACKEND_PUBLIC_URL`. Свой домен — через `TELEGRAM_MINIAPP_URL`.
2. Должен быть задан `TELEGRAM_CLIENT_BOT_TOKEN` — этим же токеном проверяется подпись `initData`.
3. Перезапустить бэкенд. При старте бот сам ставит кнопку меню «Магазин»
   (`setChatMenuButton`), а в главном меню появляется кнопка «🛍 Открыть магазин».

Если `miniAppUrl` не вычислился (нет HTTPS-адреса), кнопки просто не появятся — текстовый
сценарий бота продолжает работать как раньше.

## Как устроена авторизация

Мини-аппа шлёт `X-Telegram-Init-Data` — строку `initData` от Telegram. Бэкенд проверяет
HMAC-SHA256 по [схеме Telegram](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
и отвергает данные старше суток. JWT здесь нет: пользователь мини-аппы — это Telegram-аккаунт,
а не сотрудник CRM. Клиент в базе находится по телефону или по метке `[TG_CHAT_ID:...]` в заметках.

## Эндпоинты

Все под `/api/telegram/miniapp`, все требуют валидный `initData`.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/bootstrap` | язык, часы работы, менеджеры, категории, профиль клиента |
| GET | `/products?category=&q=&limit=&offset=` | каталог: только активные товары с ценой и остатком |
| GET | `/orders?lang=` | последние 10 заказов клиента со статусами |
| POST | `/orders` | оформление заказа (не чаще 6 раз в минуту) |
| POST | `/language` | переключение языка (общий с ботом) |

Заказ создаётся через `createCustomerOrder()` — тот же код, что и у текстового бота:
проверка рабочих часов и остатков, клиент → сделка → позиции → комментарий →
уведомление менеджеру в CRM, push и сообщение в Telegram.

## Локальный просмотр оформления

```bash
cd backend && node scripts/serve-miniapp.js
```

Откроется `http://localhost:4173/?demo=1` — интерфейс на демо-данных, без базы и без ботов.
Боевые данные доступны только внутри Telegram, где есть подписанный `initData`.
