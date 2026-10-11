-- Часть оплаты, принятая долларами: сумма в $, курс и сумовый эквивалент.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "usd_amount" DECIMAL(12,2);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "usd_rate" DECIMAL(12,2);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "usd_uzs" DECIMAL(14,2);
