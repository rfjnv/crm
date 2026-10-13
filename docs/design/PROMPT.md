# Промты для Claude Code (Opus 5.5)

Как пользоваться. Порядок сессий: «Промт 1» — дашборд до идеала (это несколько сессий: шаги §8 из
`DASHBOARD.md`, по 2–3 шага за сессию, effort **high**); «Промт 2» — пилот Клиентов (effort **high**);
дальше каждую сессию «Промт 3» — одно семейство (effort **medium**; **high** для «Аналитики» и файлов
больше 1 500 строк). Между сессиями — `/clear` или новая сессия: всю память несут `BRIEF.md`,
`DASHBOARD.md`, `PROGRESS.md` и `QUESTIONS.md`, а не история чата. Раз в несколько сессий открыть
`QUESTIONS.md`, поставить галочки и написать «Ответ: …» — следующая сессия начнёт с них.

---

## Промт 1 — Дашборд до идеала (пилот 0)

```
Ты работаешь над фронтендом CRM в frontend/ (React 19, antd 6, TypeScript, Vite). Идёт редизайн
«матовое стекло» (visionOS). Сайдбар, шапка и нижняя панель уже сделаны и нравятся владельцу —
это ДНК. Дашборд под приветствием пока классический JSX, перекрашенный глобальным CSS, и его
надо пересобрать из словаря сайдбара и шапки. Это пилот 0: здесь рождается язык дизайна для
всех остальных страниц.

Прочитай целиком docs/design/BRIEF.md (особенно §3–§5, §8) и docs/design/DASHBOARD.md — это
техническое задание сессии; затем docs/design/PROGRESS.md и docs/design/QUESTIONS.md (если в
QUESTIONS есть мои ответы — примени их первыми). Прочитай целиком: src/pages/DashboardPage.tsx,
DashboardPage.css, src/theme/glass.css, src/theme/tokens.ts, src/components/DashboardGreeting.tsx,
VedEventsQuickAccessCard.tsx, calls/MissedCallsWidget.tsx, DealStatusTag.tsx,
ClientCompanyDisplay.tsx, src/utils/currency.ts, src/types/index.ts (MoneyAccess, DashboardSummary,
DebtsResponse), src/api/calls.api.ts, finance.api.ts, analytics.api.ts.

Цель: дашборд в режиме data-design='modern' собран заново по DASHBOARD.md §2–§6; классический
режим не меняется ни на пиксель. Бэкенд не трогать. Данные брать только из уже приходящих полей;
чего нет в API — в QUESTIONS.md BACKLOG, не изобретать. Зону 0 (приветствие, фразы, пилюля периода)
не переделывать — она принята.

Выполняй план DASHBOARD.md §8 шаг за шагом, в его порядке, за эту сессию — шаги <N>–<M>. После
каждого шага: cd frontend && npm run lint && npm run build && npm run test; дальше не идти, пока
не зелёные. Существующие запросы, их ключи и параметры не менять; разрешены ровно три изменения
из DASHBOARD.md §7. Гейты ролей (isAdmin, canSeeMoney, canViewVedEvents, canViewClosedDealsHistory,
showExtras), маршруты кликов, ключи localStorage и URL-параметры — без изменений. Общие с классикой
компоненты (MissedCallsWidget, VedEventsQuickAccessCard, DealStatusTag, ClientCompanyDisplay)
расширяй вариантом, пропом или data-атрибутом, а не форком.

Вопросов мне не задавай: для спорного есть дефолты в DASHBOARD.md и BRIEF.md; спорное — в
QUESTIONS.md (≤5 за сессию, с уже применённым дефолтом). Коммит на каждый шаг §8:
feat(ui): rebuild dashboard in the new design (step N: …), тело на английском — что и почему,
в конце New design only. (кроме шага с enabled: SHOW_MY_MONTHLY_GOALS — его назвать в теле).

В конце: список выполненных шагов §8 с результатами проверок, таблица «поле · P/S/N · куда ушло /
откуда добавлено» для затронутых зон, пункты Definition of Done из DASHBOARD.md §10 с отметкой,
скриншоты 1920/1440/390 в обеих темах, если доступен браузер, обновлённые PROGRESS.md и
QUESTIONS.md. Если какой-то пункт не выполнен — остановись в чистом состоянии и напиши, что
именно и почему.
```

Подставьте `<N>–<M>`: первая сессия — шаги 1–3, вторая — 4–5, третья — 6–7, четвёртая — 8–9.

---

## Промт 2 — Клиенты: примитивы таблиц и деталей (пилот 1)

```
Продолжаем редизайн фронтенда CRM. Дашборд уже пересобран по docs/design/DASHBOARD.md — это эталон
языка (материал, шрифт, цвет, числа). Прочитай docs/design/BRIEF.md, DASHBOARD.md §2–§5,
PROGRESS.md и QUESTIONS.md (ответы применить первыми).

Задача — пилот 1: примитивы таблиц и деталей и две страницы на них.
1. Создай в frontend/src/components/ui/ по §5 брифа: PageHeader, Toolbar, DataTable, DetailLayout,
   FactList, DateText — в том же стиле, что уже существующие Section, Eyebrow, StatTile, Money,
   EmptyState, StatusPill (.tsx + .css рядом, BEM ui-*, без inline-стилей, hex и !important; стекло
   только под html[data-design='modern']; на мобиле DataTable отдаёт MobileCardList).
2. Переведи на примитивы frontend/src/pages/ClientsPage.tsx и ClientDetailPage.tsx по правилам
   данных BRIEF §4: аудит полей (поле · P/S/N · куда ушло / что добавлено) покажи таблицей в ответе.
   Запросы, мутации, гейты ролей, URL-параметры (useUrlSearchDraft), формы — не менять.
   Презентационные куски ClientDetailPage выноси в components/clients/, поведение не трогай.
3. Проверка: cd frontend && npm run lint && npm run build && npm run test; классика открывается без
   ошибок; если доступен браузер — скриншоты 1440 и 390, светлая и тёмная.
4. Коммиты: отдельный на примитивы, отдельный на пилот (feat(ui): … in the new design, тело на
   английском). Обнови PROGRESS.md и QUESTIONS.md (≤5 вопросов с применённым дефолтом).

Вопросов не задавай — дефолты из брифа. Закончи в чистом состоянии; в конце — что сделано, решения по
данным, что в QUESTIONS, какое семейство следующее.
```

---

## Промт 3 — следующая сессия (одно семейство)

```
Продолжаем редизайн фронтенда CRM. Прочитай docs/design/BRIEF.md, docs/design/PROGRESS.md и
docs/design/QUESTIONS.md; если в QUESTIONS есть мои ответы — сначала примени их. Возьми первое
незакрытое семейство из PROGRESS.md (или: <название семейства>) и пройди его по §7 брифа: аудит
полей P/S/N по каждой странице (таблицей в ответе), перевод на примитивы из
frontend/src/components/ui/ (расширять пропсами, не копировать паттерны в страницы), правила
данных §4, Definition of Done §10. Язык дизайна — DASHBOARD.md §2–§5.

Логику страниц не менять. Вопросов не задавай — дефолты из брифа, спорное в QUESTIONS.md (≤5, с
применённым дефолтом). Проверка: cd frontend && npm run lint && npm run build && npm run test;
классика открывается. Коммит на 2–4 страницы в стиле истории репозитория. Закончи с зелёной сборкой
и обновлённым PROGRESS.md; семейство наполовину не оставляй — лучше меньше страниц, но до конца.
```

---

## Промт 4 — одна страница

```
Прочитай docs/design/BRIEF.md и DASHBOARD.md §2–§5. Приведи frontend/src/pages/<Файл>.tsx к
Definition of Done BRIEF §10: аудит полей P/S/N таблицей в ответе, примитивы из components/ui,
правила данных §4, без inline-стилей и hex, светлая/тёмная, 1440/390. Логику не менять. Проверка
lint/build/test, коммит в стиле истории, строка в PROGRESS.md.
```

---

## Что сказать Claude, если он спрашивает лишнее

- «Убирать ли поле X?» → «По брифу §4.2: сомнение — не убирать, записать в QUESTIONS, идти дальше.»
- «Трогать ли бэкенд?» → «Нет, кроме исключения §4.3. В BACKLOG.»
- «Улучшать ли классику?» → «Нет, только не ломать. §3 п. 10.»
- «Добавить библиотеку?» → «Только через QUESTIONS.»
- «Можно ли ещё одно глобальное правило в glass.css?» → «Нет, если решается в примитиве. §8.»
