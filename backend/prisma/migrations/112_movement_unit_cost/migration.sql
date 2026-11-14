-- Цена закупки за единицу в каждом приходе на склад (у каждой поставки своя).
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "unit_cost" DECIMAL(12,2);
