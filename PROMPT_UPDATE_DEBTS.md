# Промпт для обновления долгов CRM по новому Excel файлу

Скопируй всё ниже и вставь как промпт в новый сеанс Claude Code:

---

## ЗАДАЧА: Обновить долги CRM по новому Excel файлу

У нас CRM для типографии. Долговая страница CRM должна точно совпадать с Excel файлом.
Рабочая директория: `c:\Users\Noutbuk savdosi\CRM`

### ШАГ 0: Найди Excel файл

В корне проекта (`c:\Users\Noutbuk savdosi\CRM\`) найди самый свежий `.xlsx` файл. Имя обычно содержит дату (например `05.03.2026.xlsx` или `06.03.2026.xlsx`). Если файлов несколько, спроси у меня какой использовать.

**КРИТИЧНО**: Во всех скриптах ниже путь к Excel файлу ЗАХАРДКОЖЕН. Перед запуском каждого скрипта ОБНОВИ путь к файлу на актуальный (обычно строка вроде `const fpath = path.resolve(process.cwd(), '..', '03.03.2026.xlsx')` — замени имя файла на новое).

### ШАГ 1: Подсчитай целевой долг из Excel (Python)

Запусти `audit_debts_v3.py` (или создай аналогичный). Логика расчёта:

**Структура Excel:**
- Каждый лист = месяц (Январь 2026, Февраль 2026, Март 2026...)
- Столбец B (индекс 1) = имя клиента
- Столбец J (индекс 9) = тип операции (нкп)
- Столбец баланса = **ПРЕДПОСЛЕДНИЙ** столбец листа (не последний!)
  - Январь: 28 столбцов → баланс = столбец AA (индекс 26)
  - Февраль/Март: 29 столбцов → баланс = столбец AB (индекс 27)
- Данные начинаются со строки 5 (индекс 4 при 0-based)

**Типы долга из столбца J (все означают "клиент должен"):**
- `к` — кредит
- `н/к` — наличные + кредит
- `п/к` — перечисление + кредит
- `ф` — Фотих (свой человек)

**КРИТИЧЕСКИ ВАЖНЫЙ АЛГОРИТМ (ошибка здесь стоила нам часы):**

```
1. Собери ВСЕ строки каждого клиента на КАЖДОМ листе (БЕЗ фильтра по J)
2. Для каждого клиента найди ПОСЛЕДНИЙ лист, где он ПРИСУТСТВУЕТ (любой тип J)
3. ТОЛЬКО ПОСЛЕ ЭТОГО отфильтруй строки по J ∈ {к, н/к, п/к, ф}
4. Суммируй баланс отфильтрованных строк
```

**НЕ ДЕЛАЙ ТАК**: Сначала фильтровать по J, потом искать последний лист — это даёт НЕВЕРНЫЙ результат!

**Ожидаемый результат**: скрипт выведет общую сумму долга и список должников. Запомни эту сумму — это ЦЕЛЕВОЕ значение для CRM.

### ШАГ 2: Проверь текущий долг CRM

```bash
cd "c:\Users\Noutbuk savdosi\CRM\backend"
npx tsx src/scripts/_full-debt-report.ts
```

Формула долга CRM:
```sql
SUM(amount - paidAmount)
WHERE paymentStatus IN ('UNPAID', 'PARTIAL')
  AND status NOT IN ('CANCELED', 'REJECTED')
  AND isArchived = false
```

Сравни результат с целевым Excel значением (ШАГ 1).

### ШАГ 3: Синхронизация

**ВАЖНО**: Перед запуском каждого скрипта обнови путь к Excel файлу!

#### 3a. sync-payments (основная синхронизация)
```bash
cd "c:\Users\Noutbuk savdosi\CRM\backend"
npx tsx src/scripts/sync-payments.ts          # dry-run
npx tsx src/scripts/sync-payments.ts --execute # live
```
Создаёт reconciliation-платежи для клиентов где CRM > Excel.

**ВНИМАНИЕ**: Этот скрипт НЕ фильтрует по столбцу J! Он берёт ВСЕ строки из Excel. Это может ПЕРЕКОРРЕКТИРОВАТЬ долг для некоторых клиентов (CRM станет меньше чем нужно). Это нормально — исправим на шаге 3d.

#### 3b. fix-overpaid-deals
```bash
npx tsx src/scripts/_fix-overpaid-deals.ts
```
Ставит статус PAID сделкам где paidAmount >= amount.

#### 3c. reallocate-payments (FIFO перераспределение)
```bash
npx tsx src/scripts/reallocate-payments.ts --execute
```
Перераспределяет платежи по сделкам (старые сначала).

#### 3d. _precise-reconcile (точная подгонка — для клиентов где CRM > Excel)

Файл: `backend/src/scripts/_precise-reconcile.ts`
**Обнови путь к Excel!**
```bash
npx tsx src/scripts/_precise-reconcile.ts          # dry-run
npx tsx src/scripts/_precise-reconcile.ts --execute # live
```

#### 3e. _fix-underdebt (для клиентов где CRM < Excel)

Файл: `backend/src/scripts/_fix-underdebt.ts`
**Обнови путь к Excel!**
```bash
npx tsx src/scripts/_fix-underdebt.ts          # dry-run
npx tsx src/scripts/_fix-underdebt.ts --execute # live
```
Удаляет лишние reconciliation-платежи.

#### 3f. _create-missing-debt (для клиентов с 0 долгом в CRM)

Файл: `backend/src/scripts/_create-missing-debt.ts`
**Обнови путь к Excel!**
```bash
npx tsx src/scripts/_create-missing-debt.ts          # dry-run
npx tsx src/scripts/_create-missing-debt.ts --execute # live
```
Создаёт сделки-долги для клиентов, которых нет в CRM или у которых все сделки PAID.

#### 3g. Повторно fix-overpaid-deals
```bash
npx tsx src/scripts/_fix-overpaid-deals.ts
```

### ШАГ 4: Верификация

Запусти `_full-debt-report.ts` и сравни с Excel целью. Разница должна быть 0 (или < 1 сум из-за округления).

Если разница > 1 сум:
- CRM > Excel → запусти _precise-reconcile ещё раз
- CRM < Excel → запусти _fix-underdebt и/или _create-missing-debt ещё раз

### ШАГ 5: Деплой (если нужно)

```bash
git add -A && git commit -m "sync: update debt data" && git push
```
Затем на Render dashboard → Manual Deploy (auto-deploy выключен).

---

### СПИСОК ФАЙЛОВ

| Файл | Назначение |
|---|---|
| `audit_debts_v3.py` | Python: подсчёт целевого долга из Excel (J-фильтр) |
| `backend/src/scripts/sync-payments.ts` | Основная синхронизация CRM←Excel |
| `backend/src/scripts/_fix-overpaid-deals.ts` | Исправление статусов PAID |
| `backend/src/scripts/reallocate-payments.ts` | FIFO перераспределение |
| `backend/src/scripts/_precise-reconcile.ts` | Точная подгонка CRM→Excel (для CRM > Excel) |
| `backend/src/scripts/_fix-underdebt.ts` | Обратная коррекция (для CRM < Excel) |
| `backend/src/scripts/_create-missing-debt.ts` | Создание долгов для отсутствующих клиентов |
| `backend/src/scripts/_full-debt-report.ts` | Отчёт: текущий долг CRM |
| `backend/src/lib/normalize-client.ts` | Нормализация имён клиентов |

### ОШИБКИ, КОТОРЫЕ МЫ УЖЕ ДОПУСКАЛИ (не повторяй!)

1. **Фильтрация по J ДО поиска последнего листа** — даёт неверную сумму (~94M лишних). Правильно: сначала последний лист, потом J
2. **sync-payments без J-фильтра** — перекорректирует долг. Поэтому после него ОБЯЗАТЕЛЬНО запускай _fix-underdebt и _create-missing-debt
3. **Номер столбца баланса меняется по листам** — ПРЕДПОСЛЕДНИЙ столбец, не фиксированный номер
4. **Render auto-deploy выключен** — после git push нужен Manual Deploy
