-- Фактические даты отгрузки / доставки по позиции (супер-оверрайд и учёт)
ALTER TABLE "deal_items" ADD COLUMN IF NOT EXISTS "shipped_at" TIMESTAMP(3);
ALTER TABLE "deal_items" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);
