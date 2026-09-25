-- Память РОП-агента и его сигналы директору.
CREATE TABLE "rop_agent_memories" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'agent',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rop_agent_memories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rop_agent_memories_expires_at_idx" ON "rop_agent_memories"("expires_at");

ALTER TABLE "rop_agent_memories" ADD CONSTRAINT "rop_agent_memories_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rop_alerts" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "message" TEXT,
    "proposal" JSONB,
    "reason" TEXT,
    "messages" JSONB,
    "plan_id" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rop_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rop_alerts_key_key" ON "rop_alerts"("key");
CREATE INDEX "rop_alerts_status_created_at_idx" ON "rop_alerts"("status", "created_at");

ALTER TABLE "rop_agent_chats" ADD COLUMN "memory_hash" TEXT;
