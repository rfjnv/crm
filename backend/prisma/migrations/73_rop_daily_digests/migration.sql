-- Ежедневные сводки РОП-агента и канал разговора (страница CRM или Telegram).
CREATE TABLE "rop_daily_digests" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "commentary" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rop_daily_digests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rop_daily_digests_date_key" ON "rop_daily_digests"("date");

ALTER TABLE "rop_agent_chats" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'web';
