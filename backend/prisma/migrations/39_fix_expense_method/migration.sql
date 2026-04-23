-- Fix: в schema.prisma поле Expense.method существует (String?),
-- но столбец expenses.method в production-БД отсутствует (наследие).
-- Создаём отсутствующий столбец неразрушающе. Ничего не удаляется.

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "method" TEXT;

-- Индекс, как объявлено в схеме (@@index([method]))
CREATE INDEX IF NOT EXISTS "expenses_method_idx" ON "expenses"("method");
