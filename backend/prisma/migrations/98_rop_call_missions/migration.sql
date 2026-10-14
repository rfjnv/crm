-- Звонки Беллы менеджерам по поручению директора: цель, расшифровка разговора и отчёт.
CREATE TABLE "rop_call_missions" (
  "id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "manager_id" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "transcript" JSONB,
  "summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "rop_call_missions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rop_call_missions_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rop_call_missions_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "rop_call_missions_manager_id_created_at_idx" ON "rop_call_missions"("manager_id", "created_at");
