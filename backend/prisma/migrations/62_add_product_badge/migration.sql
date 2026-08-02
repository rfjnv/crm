-- Ярлык товара для витрины клиентского бота: NEW | RESTOCK | SOON | HIT | SALE.
-- Хранится строкой, а не enum: набор ярлыков маркетинговый и будет пополняться,
-- а ALTER TYPE на живой базе дороже простой проверки на уровне приложения.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "badge" TEXT;

-- Дата, после которой ярлык перестаёт показываться клиентам (NULL — бессрочно).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "badge_until" TIMESTAMP(3);

-- Витрина отбирает товары с ярлыком «скоро в наличии» даже при нулевом остатке.
CREATE INDEX IF NOT EXISTS "products_badge_idx" ON "products" ("badge");
