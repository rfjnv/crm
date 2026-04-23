-- MVP-4: landed cost + мультивалютные расходы.
-- Только ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, идемпотентно.
-- Ничего не удаляет и не меняет типы существующих столбцов.

-- ======== import_orders: UZS-суммы ========
ALTER TABLE "import_orders" ADD COLUMN IF NOT EXISTS "total_amount_uzs" DECIMAL(18,2);
ALTER TABLE "import_orders" ADD COLUMN IF NOT EXISTS "overhead_uzs"     DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "import_orders" ADD COLUMN IF NOT EXISTS "landed_cost_uzs"  DECIMAL(18,2);

-- ======== expenses: валюта, курс, UZS-эквивалент, привязка к импорт-заказу ========
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "currency"         TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "exchange_rate"    DECIMAL(15,6);
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "amount_uzs"       DECIMAL(14,2);
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "import_order_id"  TEXT;

-- FK на import_orders (NULL разрешён; ON DELETE SET NULL, чтобы при удалении заказа
-- расход не терялся, просто отвязывался).
DO $$ BEGIN
    ALTER TABLE "expenses"
        ADD CONSTRAINT "expenses_import_order_id_fkey"
        FOREIGN KEY ("import_order_id") REFERENCES "import_orders"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "expenses_import_order_id_idx" ON "expenses"("import_order_id");

-- ======== Бэкфилл для сохранности текущих данных ========
-- Для существующих расходов, где UZS-сумма ещё не заполнена:
-- считаем, что это были UZS, и amount_uzs = amount. Это неразрушающий бэкфилл
-- (только там, где поля пока NULL; ничего не меняем у уже заполненных).
UPDATE "expenses"
   SET "amount_uzs" = "amount"
 WHERE "amount_uzs" IS NULL
   AND ("currency" IS NULL OR "currency" = 'UZS');
