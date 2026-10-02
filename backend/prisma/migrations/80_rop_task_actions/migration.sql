-- Изменения задач, которые готовит РОП-агент (закрыть, удалить, перенести срок, передать).
-- Выполняются только после подтверждения директором или админом.
CREATE TABLE "rop_task_actions" (
  "id" TEXT NOT NULL,
  "chat_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "task_ids" JSONB NOT NULL,
  "params" JSONB NOT NULL DEFAULT '{}',
  "summary" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "created_by_id" TEXT NOT NULL,
  "decided_by_id" TEXT,
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rop_task_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rop_task_actions_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "rop_agent_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "rop_task_actions_chat_id_created_at_idx" ON "rop_task_actions"("chat_id", "created_at");
