-- Track whether the production Telegram post was moved to the ready-for-shipment group
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "production_telegram_message_in_rfs" BOOLEAN NOT NULL DEFAULT false;
