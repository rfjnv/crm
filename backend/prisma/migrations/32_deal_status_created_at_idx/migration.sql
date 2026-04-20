-- Ускорение выборок закрытых сделок за период (аналитика иерархии)
CREATE INDEX IF NOT EXISTS "deals_status_created_at_idx" ON "deals" ("status", "created_at");
