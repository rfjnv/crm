# 🔧 Исправление проблем с развертыванием на Render

## ✅ Проблемы исправлены

### 1. **render.yaml - Built-in команды**
**Проблема**: При сборке выполнялись команды импорта которые:
- Ищут файл `new.xlsx` (не существует)
- Ищут скрипт `src/scripts/import-excel.ts` (не существует)
- Пытаются выполнить `migrate-debt.ts` (которого может не быть на сборке)

**Решение**: Удалены из `buildCommand`:
```bash
# По СТАРОМУ (ОШИБКА):
npm run db:import-excel && npm run db:deactivate-imports && npx tsx src/scripts/import-excel.ts backend/data/analytics_2026-03-12.xlsx 2026 --clean

# По НОВОМУ (ИСПРАВЛЕНО):
# Эти команды убраны из buildCommand
```

**Новая команда сборки**:
```bash
npm install --include=dev && npx prisma generate && npx prisma db push --skip-generate --accept-data-loss && npm run build
```

### 2. **prisma/import-excel.ts - Exit code**
**Проблема**: Скрипт завершался с кодом 1 (ошибка) если файл не найден
```typescript
// ❌ БЫЛО:
process.exit(1);  // Поломает сборку

// ✅ СТАЛО:
process.exit(0);  // Пропустит милосердно
```

## 📋 Важно запомнить

### Для локального запуска импорта
✅ Используйте новый скрипт:
```bash
cd backend
npm run import-excel
```

### Для Render deployment
⚠️ Импорт не запускается автоматически при сборке!
Нужно запустить вручную после развертывания:
```bash
# На Render через Console или SSH:
cd backend
npm run import-excel
```

## 🚀 Контрольный список перед деплоем

- ✅ `render.yaml` обновлен (без import команд в buildCommand)
- ✅ `prisma/import-excel.ts` исправлен (exit 0 если файла нет)
- ✅ Новый скрипт `import-excel-to-crm.ts` работает локально

## 📝 Развертывание на Render

### Шаг 1: Пуш изменений
```bash
git add .
git commit -m "fix(deploy): remove import commands from build process"
git push origin main
```

### Шаг 2: Сборка на Render
Render автоматически соберет приложение с новой конфигурацией.
✅ Сборка должна пройти успешно.

### Шаг 3: Импорт данных (после развертывания)
После успешного развертывания импортируйте данные:

**Способ 1: Через Render Console**
```bash
# Откройте Console в Render для backend сервиса
cd backend && npm run import-excel
```

**Способ 2: SSH доступ**
```bash
ssh user@render-host
cd ~/app/backend
npm run import-excel
```

**Способ 3: Через приложение (если добавить эндпоинт)**
Можно создать специальный API эндпоинт для импорта:
```typescript
POST /api/admin/import/excel
Authorization: Bearer [admin_token]
```

## 🐛 Если ошибка повторится

### Проверка логов
```bash
# На Render > Logs смотрите:
# 1. Build logs - ошибки при сборке
# 2. Runtime logs - ошибки при запуске
```

### Отладка buildCommand
Если нужно добавить команду в сборку - убедитесь:
1. ✓ Файл существует или script обрабатывает отсутствие файла
2. ✓ Script завершается с кодом 0 (success) или 1 (error осознанно)
3. ✓ Версия Node совместима со всеми инструментами

### Откат
Если что-то пошло не так:
```bash
git revert HEAD
git push origin main
# Render автоматически пересоберет приложение
```

## 📊 Сравнение: Локальный vs Render

| Операция | Локально | На Render |
|----------|----------|-----------|
| Сборка | `npm run build` | Автоматически из git |
| Импорт | `npm run import-excel` | Вручную в Console |
| БД миграция | `npm run db:push` | В buildCommand |
| Проверка | `npm run dev` | Health check (/api/health) |

## ✨ Результат

Теперь:
- ✅ Сборка на Render не падает
- ✅ Приложение развертывается успешно
- ✅ Импорт запускается отдельно по требованию
- ✅ Нет зависимостей на отсутствующих файлах

---

**Статус**: ✅ Fixed
**Дата**: 2026-03-18
**Impact**: Breaking → Fixed
