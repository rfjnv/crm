# CRM backend

Express + Prisma + PostgreSQL (TypeScript). Запуск локально: `npm run dev`, сборка: `npm run build`, тесты: `npm test`.

## Мобильная телефония (CallSync)

Android-приложение CallSync стоит на рабочих телефонах менеджеров. Оно читает журнал звонков
и записи разговоров и отправляет их в CRM. Контракт API зафиксирован в приложении, менять пути,
поля и коды ответов нельзя. Код — `src/modules/mobile`.

Что делает сервер:

- Звонки ложатся в `call_sessions` с `provider = MOBILE`. `external_call_id` = `mobile:<userId>:<device_call_id>`,
  поэтому повторная отправка звонка возвращает `duplicate` с тем же id.
- Клиент ищется по номеру (`phoneMatchKey`, в поле клиента может быть несколько номеров через `, ; /`).
  Неизвестный номер клиентом **не становится**: в журнале это «Неизвестный контакт» с кнопками
  «Создать клиента» и «Привязать к клиенту».
- Пропущенный (`missed`, `rejected`) создаёт задачу «Перезвонить» на менеджера со сроком 2 часа
  и шлёт ему сообщение в Telegram. Исходящий разговор или отвеченный входящий с этим номером
  закрывает задачу сам. Пропущенные старше суток (история за 7 дней при первом входе) задач не создают.
- Записи хранятся в приватном bucket Supabase `call-recordings`, слушать их можно по signed URL на час.
  Записи короче `minAuditDurationSec` (по умолчанию 30 с) не анализируются. Остальные по одной проходят
  транскрибацию и аудит (`transcribeAudioFile` → `analyzeSalesCallTranscript`), результат попадает в «Историю аудитов».
  Очередь хранится в БД (`call_sessions.audio_status`), на каждую запись не больше 3 попыток.
- Записи старше 12 месяцев удаляются из bucket. Журнал звонков хранится бессрочно.
- Алерты руководителю (пользователи с правом `use_rop_agent` и SUPER_ADMIN) уходят в Telegram только
  в рабочее время: телефон молчит больше 2 часов рабочего времени; за 2 дня есть отвеченные звонки,
  но нет ни одной записи; выключены разрешения или не найдена папка записей. По каждому эпизоду
  приходит одно сообщение.

Доступ: менеджер видит только свои звонки. Все звонки видят SUPER_ADMIN, ADMIN и сотрудники
с правом `use_rop_agent` (РОП). Админка телефонов `/mobile-devices` открыта ADMIN и SUPER_ADMIN.

### Переменные окружения

| Переменная | Зачем |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (+ `SUPABASE_ANON_KEY`) | Хранилище записей и логов приложения |
| `INTERNAL_REPORTS_TOKEN` | Защищает `POST /api/internal/mobile/tick` (заголовок `x-internal-token`) |
| `MOBILE_PUBLIC_SERVER_URL` | Необязательная. Адрес бэкенда для QR привязки, без `/api`. По умолчанию берётся `RENDER_EXTERNAL_URL` или `BACKEND_PUBLIC_URL`, иначе адрес из запроса |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CRM_URL` | Сообщения о пропущенных и алерты, ссылки в них |
| `AISHA_AI_API_KEY`, `ELEVENLABS_API_KEY`, ключ Claude | Транскрибация и аудит, как у «Аудио в текст» |

### Bucket `call-recordings`

Создать в Supabase → Storage → New bucket. Имя `call-recordings`, **Public bucket выключен**.
Сервер пишет туда service-role ключом. Записи лежат по пути `<userId>/<yyyy>/<mm>/<uuid>.<ext>`,
логи приложения — в `logs/<userId>/<deviceId>/…`. Лимит размера файла в bucket — не меньше 50 МБ.

### Внешний cron

На Render free процесс засыпает без запросов, и внутренний `setInterval` перестаёт срабатывать.
Поэтому каждые 5–10 минут нужно вызывать (например, через cron-job.org):

```
POST https://<бэкенд>/api/internal/mobile/tick
x-internal-token: <INTERNAL_REPORTS_TOKEN>
```

Этот вызов выполняет те же проверки и алерты, что планировщик, раз в сутки чистит старые записи и
запускает очередь аудита. Он же будит сервер, поэтому записи разбираются, даже когда в CRM никто не работает.

### Как привязать телефон

1. Сотрудник открывает CRM → «Профиль» → «Рабочий телефон (CallSync)» → «Привязать телефон».
2. В приложении CallSync сканирует QR (`callsync://pair?server=…&code=…`). Код одноразовый и действует 10 минут.
   Можно войти и логином с паролем от CRM.
3. На сотрудника приходится одно активное устройство: при новом входе старый телефон отвязывается.
   Отвязать телефон вручную, запросить лог приложения и задать папку записей для телефона или модели
   можно в «Телефоны (CallSync)».

### Эндпоинты

Телефон (`Authorization: Bearer <device_token>`): `POST /api/mobile/auth`, `GET /api/mobile/config`,
`POST /api/mobile/heartbeat`, `POST /api/mobile/logs`, `POST /api/calls`, `POST /api/calls/:id/audio`,
`POST /api/calls/unmatched-audio`.

CRM (JWT): `GET /api/calls`, `GET /api/calls/missed`, `GET /api/calls/:id`, `GET /api/calls/:id/audio-url`,
`POST /api/calls/:id/link-client`, `POST /api/calls/:id/callback-task`, `POST /api/calls/:id/called-back`,
`GET /api/clients/:id/calls`, `POST /api/mobile/pairing-code`, админка `/api/mobile/devices*`,
`/api/mobile/device-models`, `/api/mobile/settings`.
