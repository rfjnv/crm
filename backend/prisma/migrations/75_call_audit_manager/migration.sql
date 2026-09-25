-- Аудит звонка привязывается к менеджеру и клиенту и хранит этапы продажи и советы —
-- чтобы видеть картину по каждому менеджеру, а не только отдельные разборы.
ALTER TABLE "call_audits" ADD COLUMN "manager_id" TEXT;
ALTER TABLE "call_audits" ADD COLUMN "client_id" TEXT;
ALTER TABLE "call_audits" ADD COLUMN "stage_checklist" JSONB;
ALTER TABLE "call_audits" ADD COLUMN "mentor_tips" JSONB;

CREATE INDEX "call_audits_manager_id_created_at_idx" ON "call_audits"("manager_id", "created_at");

ALTER TABLE "call_audits" ADD CONSTRAINT "call_audits_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "call_audits" ADD CONSTRAINT "call_audits_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Старые аудиты: имя менеджера текстом → сотрудник, если имя совпадает ровно с одним.
UPDATE "call_audits" ca SET "manager_id" = u.id
FROM "users" u
WHERE ca."manager_id" IS NULL
  AND ca."manager_name" IS NOT NULL
  AND lower(trim(u."full_name")) = lower(trim(ca."manager_name"))
  AND (SELECT COUNT(*) FROM "users" u2 WHERE lower(trim(u2."full_name")) = lower(trim(ca."manager_name"))) = 1;
