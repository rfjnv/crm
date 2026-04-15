-- Сессионная сделка: выручка по дате позиций до закрытия
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "is_session_deal" BOOLEAN NOT NULL DEFAULT false;
