-- AlterTable: second parallel stock counter (rolls) for products sold in rolls but tracked by weight
ALTER TABLE "products" ADD COLUMN "roll_stock" DECIMAL(12,3);

-- AlterTable: roll count confirmed by warehouse when answering "Ответ склада" for such items
ALTER TABLE "deal_items" ADD COLUMN "roll_count" DECIMAL(12,3);
