-- Снимок остатка товара до и после каждого движения склада.
-- Нужен, чтобы в истории показывать «было → стало» и считать остаток на прошедшую дату.
-- Не вычисляется обратным проходом по журналу: часть остатков правилась в обход движений,
-- поэтому пересчёт задним числом дал бы правдоподобные, но неверные значения.
-- NULL — движение записано до появления этих полей.
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "stock_before" DECIMAL(12,3);
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "stock_after" DECIMAL(12,3);
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "roll_stock_before" DECIMAL(12,3);
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "roll_stock_after" DECIMAL(12,3);

-- Остаток на дату ищется как последнее движение товара на эту дату включительно.
CREATE INDEX IF NOT EXISTS "inventory_movements_product_created_idx"
  ON "inventory_movements" ("product_id", "created_at");
