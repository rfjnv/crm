-- Планы задач менеджерам от РОП-агента: черновик → «Раздать» создаёт задачи.
CREATE TABLE "rop_task_plans" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "items" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "assigned_by_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rop_task_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rop_task_plans_chat_id_created_at_idx" ON "rop_task_plans"("chat_id", "created_at");
CREATE INDEX "rop_task_plans_status_assigned_at_idx" ON "rop_task_plans"("status", "assigned_at");

ALTER TABLE "rop_task_plans" ADD CONSTRAINT "rop_task_plans_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "rop_agent_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
