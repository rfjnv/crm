-- Чаты РОП-агента: реплика хранит дословный обмен с Claude (api_messages).
CREATE TABLE "rop_agent_chats" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Новый чат',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rop_agent_chats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rop_agent_messages" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "api_messages" JSONB NOT NULL,
    "tool_calls" JSONB,
    "is_error" BOOLEAN NOT NULL DEFAULT false,
    "input_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rop_agent_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rop_agent_chats_user_id_updated_at_idx" ON "rop_agent_chats"("user_id", "updated_at");
CREATE INDEX "rop_agent_messages_chat_id_created_at_idx" ON "rop_agent_messages"("chat_id", "created_at");

ALTER TABLE "rop_agent_chats" ADD CONSTRAINT "rop_agent_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rop_agent_messages" ADD CONSTRAINT "rop_agent_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "rop_agent_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
