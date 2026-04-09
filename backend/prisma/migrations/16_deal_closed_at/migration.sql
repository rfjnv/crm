-- Момент закрытия сделки → выручка по дню закрытия (если нет deal_date у позиций)
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "deals_closed_at_idx" ON "deals"("closed_at");

-- Старые закрытые: приближённо дата последнего обновления
UPDATE "deals"
SET "closed_at" = "updated_at"
WHERE "status" = 'CLOSED' AND "closed_at" IS NULL;
