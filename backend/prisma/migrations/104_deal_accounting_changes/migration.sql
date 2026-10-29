-- Изменения сделок на перечисление, которые бухгалтер должен сверить со своими документами.
CREATE TABLE "deal_accounting_changes" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "edit_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "review_note" TEXT,
    CONSTRAINT "deal_accounting_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deal_accounting_changes_deal_id_idx" ON "deal_accounting_changes"("deal_id");
CREATE INDEX "deal_accounting_changes_reviewed_at_last_changed_at_idx" ON "deal_accounting_changes"("reviewed_at", "last_changed_at");

-- Бухгалтерии раздел ВЭД не нужен: снимаем права ВЭД у бухгалтеров (помощников-менеджеров не трогаем).
UPDATE "users"
SET "permissions" = ARRAY(
  SELECT p FROM unnest("permissions") AS p
  WHERE p NOT IN ('view_import_orders', 'manage_import_orders', 'manage_suppliers')
)
WHERE "role" = 'ACCOUNTANT';
