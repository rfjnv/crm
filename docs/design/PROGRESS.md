# Прогресс редизайна

Статусы: ✅ готово по Definition of Done · 🟡 частично · ⬜ не начато · ➖ вне объёма.
Обновляется в конце каждой сессии. В колонке «Решения» — одна строка: что скрыли, что добавили,
что вынесли в QUESTIONS. Файлы — `frontend/src/pages/`, если не указано иное.

## Фаза 0 — каркас и примитивы

| Что | Файлы | Статус | Решения |
|---|---|---|---|
| Каркас: меню, шапка, нижняя панель | `components/Layout.tsx`, `ModernHeaderBar.tsx`, `BottomTabBar.tsx`, `theme/glass.css` | ✅ | эталон, не переделывать |
| Дашборд | `DashboardPage.tsx`, `components/DashboardGreeting.tsx` | 🟡 | готовы только приветствие и пилюля периода; контент — классический JSX под стеклом; ТЗ — `DASHBOARD.md` |
| Общие правила страниц (h4, кнопки, теги, модалки) | `theme/glass.css`, `theme/tokens.ts` | ✅ | дальше — только через примитивы |
| Примитивы языка (пилот 0) | `Section`, `Eyebrow`, `StatTile/StatGrid`, `Money`, `EmptyState`, `StatusPill` в `components/ui/` | ✅ | созданы на шаге 3 (2247a4f), smoke-тесты в обоих режимах; на страницах пока не используются |
| Примитивы таблиц и деталей (пилот 1) | `PageHeader`, `Toolbar`, `DataTable`, `DetailLayout`, `FactList`, `DateText` | ⬜ | |

## Пилот 0 — Дашборд (язык дизайна)

| Шаг (`DASHBOARD.md` §8) | Файлы | Статус | Решения |
|---|---|---|---|
| 1. Токены и материал | `theme/glass.css`, `theme/glassPalette.ts`, `theme/tokens.ts` | ✅ | `--fill-1/2/3`, `--c-*`, `--c-hairline` + сплошные подмены в фолбэках; `--win-bg` по замеру контраста 0,52 dark / 0,60 light (≥ 4,58:1 для `--c-text-2` над всем фото), saturate 115 %; `--text-secondary` modern = `--c-text-2` (beb6860). Доработка по ответу на Q7: светлая тема — окно .50, `--c-text-2` .80, вуаль .15 на фото |
| 2. Хелперы денег и чисел | `utils/currency.ts` + тесты | ✅ | `formatMoneyCompact`, `formatPercent` (signed), `formatCount` перенесён из дашборда без изменений; старые хелперы не тронуты; 22 теста (3f9ce5c) |
| 3. Примитивы языка | `components/ui/*` | ✅ | 6 примитивов + `DealStatusTag` с `data-tone` (`components/dealStatusTone.ts`), правило тонов тегов в `glass.css` с `!important` поверх блока цветных тегов; 26 smoke-тестов (2247a4f) |
| 4. Ветка `DashboardModern`, зоны 0 и A | `components/dashboard/DashboardModern.tsx`, `DashboardPage.css` | ⬜ | |
| 5. Панель «Требует внимания» | `components/dashboard/useDashboardAttention.ts`, `MissedCallsWidget`, `VedEventsQuickAccessCard` | ⬜ | |
| 6. Зона «Период» | график, бар цели, стековый бар | ⬜ | |
| 7. Зона «Лидеры» | `Section` с тремя колонками, `ClientCompanyDisplay` | ⬜ | |
| 8. Роли и мобильный вид | ветки manager / warehouse / accountant, `@media` | ⬜ | |
| 9. Чистка и DoD | `glass.css`, `DashboardPage.tsx`, документы | ⬜ | |

## Пилот 1 — Клиенты (таблицы и детали)

| Маршрут | Файл | Статус | Решения |
|---|---|---|---|
| `/clients` | `ClientsPage.tsx` | ⬜ | |
| `/clients/:id` | `ClientDetailPage.tsx` | ⬜ | |

## 1. Продажи

| Маршрут | Файл | Статус | Решения |
|---|---|---|---|
| `/deals` | `DealsPage.tsx` | ⬜ | |
| `/deals/new` | `DealCreatePage.tsx` (+ `.css`) | ⬜ | |
| `/deals/:id` | `DealDetailPage.tsx` (3011 строк — выносить секции) | ⬜ | |
| `/deals/:id/override` | `DealOverridePage.tsx` | ⬜ | |
| `/deals/approval` | `DealApprovalPage.tsx` | ⬜ | |
| `/deals/closed` | `ClosedDealsPage.tsx` | ⬜ | |
| `/deals/archived` | `ArchivedDealsPage.tsx` | ⬜ | |
| `/deals/audit-check` | `AuditCheckPage.tsx` (+ `.css`) | ⬜ | |
| `/contracts` | `ContractsPage.tsx` | ⬜ | |
| `/contracts/:id` | `ContractDetailPage.tsx` | ⬜ | |
| `/power-of-attorney` | `PowerOfAttorneyPage.tsx` | ⬜ | |
| `/notes-board` | `NotesBoardPage.tsx` | ⬜ | |
| `/reviews` | `ReviewsPage.tsx` | ⬜ | |
| `/calls` | `CallsPage.tsx` + `components/calls/*` | ⬜ | |
| `/clients/duplicates` | `DuplicateClientsPage.tsx` | ⬜ | |
| `/clients/map` | `ClientsMapPage.tsx` | ⬜ | карта Leaflet — стекло только на панелях |

## 2. Главное

| Маршрут | Файл | Статус | Решения |
|---|---|---|---|
| `/tasks` | `TasksPage.tsx` | ⬜ | |
| `/messages` | `MessagesPage.tsx` | ⬜ | |
| `/notifications` | `NotificationsPage.tsx` | ⬜ | |
| `/notifications/broadcast` | `BroadcastPage.tsx` | ⬜ | |

## 3. Склад

| Маршрут | Файл | Статус | Решения |
|---|---|---|---|
| `/inventory/products` | `ProductsPage.tsx` | ⬜ | |
| `/inventory/products/:id` | `ProductDetailPage.tsx` | ⬜ | |
| `/inventory/groups` | `ProductGroupsPage.tsx` | ⬜ | |
| `/inventory/warehouse` | `WarehousePage.tsx` | ⬜ | |
| `/inventory/audit-check` | `AuditStockPage.tsx` | ⬜ | |
| `/inventory/movements` | `MovementsPage.tsx` | ⬜ | |
| `/inventory/approvals` | `ApprovalsPage.tsx` | ⬜ | |
| `/stock-confirmation` | `StockConfirmationPage.tsx` (+ `.css`) | ⬜ | рабочая мобильная страница (§3 п. 11) |
| `/shipment` | `WarehouseShipmentsPage.tsx` | ⬜ | |
| `/warehouse-manager` | `WarehouseManagerPage.tsx` (+ `.css`) | ⬜ | |
| `/my-loading-tasks` | `MyLoadingTasksPage.tsx` | ⬜ | рабочая мобильная страница |
| `/my-vehicle` | `MyVehiclePage.tsx` | ⬜ | рабочая мобильная страница |
| `/delivery-route` | `DeliveryRoutePage.tsx` | ⬜ | рабочая мобильная страница |

## 4. Финансы

| Маршрут | Файл | Статус | Решения |
|---|---|---|---|
| `/finance/cashbox` (+ `?tab=debtors`) | `CashboxPage.tsx` (2038 строк) | ⬜ | |
| `/finance/review` | `FinanceReviewPage.tsx` | ⬜ | |
| `/finance/expenses` | `ExpensesPage.tsx` | ⬜ | |
| `/finance/balance` | `CompanyBalancePage.tsx` | ⬜ | |
| `/revenue/today` | `RevenueTodayPage.tsx` + `components/RevenueByManagers.tsx` | ⬜ | |

## 5. ВЭД

| Маршрут | Файл | Статус | Решения |
|---|---|---|---|
| `/foreign-trade/suppliers` | `SuppliersPage.tsx` | ⬜ | |
| `/foreign-trade/suppliers/:id` | `SupplierDetailPage.tsx` | ⬜ | |
| `/foreign-trade/import-orders` | `ImportOrdersPage.tsx` | ⬜ | |
| `/foreign-trade/import-orders/:id` | `ImportOrderDetailPage.tsx` | ⬜ | |
| `/foreign-trade/process-board` | `VedProcessBoardPage.tsx` | ⬜ | |
| `/foreign-trade/map` | `VedMapPage.tsx` | ⬜ | карта — стекло только на панелях |
| `/foreign-trade/exchange-rates` | `ExchangeRatesHistoryPage.tsx` | ⬜ | |

## 6. Аналитика и «Менеджерам»

| Маршрут | Файл | Статус | Решения |
|---|---|---|---|
| `/analytics` | `AnalyticsPage.tsx` (2377 строк — выносить секции) | ⬜ | |
| `/history-analytics` | `HistoryAnalyticsPage.tsx` (1790 строк) | ⬜ | |
| `/analytics/market` | `MarketAnalysisPage.tsx` | ⬜ | |
| `/analytics/department-report` | `DepartmentReportPage.tsx` | ⬜ | |
| `/manager/client-activity` | `ClientActivityMatrixPage.tsx` + `components/activity/*` | ⬜ | |
| `/manager/reanimation` | `ReanimationPage.tsx` (+ `.css`) | ⬜ | |
| `/manager/dead-products` | `DeadProductsPage.tsx` (+ `.css`) | ⬜ | |
| `/manager/payment-overdue` | `PaymentOverduePage.tsx` (+ `.css`) | ⬜ | |
| `/analytics/calls` | `CallActivityPage.tsx` | ⬜ | |
| `/analytics/contact-matrix` | `ContactMatrixPage.tsx` | ⬜ | |
| `/analytics/note-audit` | `NoteAuditPage.tsx` | ⬜ | |
| `/analytics/lamination-kg-usage` | `LaminationKgUsagePage.tsx` | ⬜ | |
| `/almanac/sales` | `AlmanacSalesPage.tsx` | ⬜ | |
| `/almanac/clients` | `AlmanacClientsPage.tsx` | ⬜ | |
| `/almanac/products` | `AlmanacProductsPage.tsx` | ⬜ | |
| `/almanac/products/:id` | `AlmanacProductDetailPage.tsx` | ⬜ | |
| `/almanac/debts` | `AlmanacDebtsPage.tsx` | ⬜ | |

## 7. AI и РОП-агент

| Маршрут | Файл | Статус | Решения |
|---|---|---|---|
| `/ai-assistant` | `AiAssistantPage.tsx` | ⬜ | |
| `/ai-assistant/training` | `AiTrainingPage.tsx` | ⬜ | |
| `/ai-assistant/transcribe` | `AudioTranscriptionPage.tsx` | ⬜ | |
| `/ai-assistant/call-audits` | `CallAuditDashboardPage.tsx` | ⬜ | |
| `/rop-agent` | `RopAgentPage.tsx` + `components/RopTask*.tsx`, `RopMemoryDrawer.tsx` | ⬜ | |
| `/rop-agent/digest` | `RopDigestPage.tsx` | ⬜ | |

## 8. Система

| Маршрут | Файл | Статус | Решения |
|---|---|---|---|
| `/team` | `TeamPage.tsx` | ⬜ | |
| `/users` | `UsersPage.tsx` | ⬜ | |
| `/employee-cards` | `EmployeeCardsPage.tsx` + `components/EmployeeCardDrawer.tsx` | ⬜ | |
| `/attendance` | `AttendancePage.tsx` | ⬜ | рабочая мобильная страница |
| `/hr-journal` | `HrJournalPage.tsx` | ⬜ | |
| `/kpi` | `KpiPage.tsx` + `components/ManagerKpiPanel.tsx` | ⬜ | |
| `/call-reports` | `CallReportsPage.tsx` | ⬜ | |
| `/settings/company` | `CompanySettingsPage.tsx` | ⬜ | |
| `/profile` | `ProfilePage.tsx` | ⬜ | |
| `/mobile-devices` | `MobileDevicesPage.tsx` | ⬜ | |
| `/admin/activity-log` | `ActivityLogPage.tsx` | ⬜ | |
| `/changelog` | `ChangelogPage.tsx` | ⬜ | |

## Вне объёма

| Маршрут | Файл | Статус |
|---|---|---|
| `/login`, `/rate/:token`, `/viewport` | `LoginPage.tsx`, `RatePage.tsx`, `ViewportInfoPage.tsx` | ➖ |
| `/admin/*` (админка сайта) | `AdminDashboardPage.tsx`, `AdminUsersPage.tsx`, `AdminInquiriesPage.tsx`, `site-admin/*` | ➖ |

## Завершение (после всех семейств)

| Что | Статус |
|---|---|
| Удалить `classic` и переключатель «Новый дизайн (бета)» — только по решению пользователя | ⬜ |
| Снять замер §2 брифа повторно (inline-стили, hex, `Title level={4}`) и записать сюда | ⬜ |
