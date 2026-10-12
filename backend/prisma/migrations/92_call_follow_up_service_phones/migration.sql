-- Чем закончился несостоявшийся звонок (пропущенный, без ответа): кто первым поговорил с этим
-- номером после него — менеджер (OUTBOUND) или клиент сам перезвонил (INBOUND).
-- И справочник служебных номеров: склад, сотрудники, курьеры — не клиенты.

-- DropIndex
DROP INDEX "call_sessions_phone_key_idx";

-- AlterTable
ALTER TABLE "call_sessions" ADD COLUMN     "follow_up_at" TIMESTAMP(3),
ADD COLUMN     "follow_up_call_id" TEXT,
ADD COLUMN     "follow_up_direction" "CallDirection";

-- CreateTable
CREATE TABLE "service_phones" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_phones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_phones_phone_key_key" ON "service_phones"("phone_key");

-- CreateIndex
CREATE INDEX "call_sessions_phone_key_started_at_idx" ON "call_sessions"("phone_key", "started_at");

-- AddForeignKey
ALTER TABLE "service_phones" ADD CONSTRAINT "service_phones_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Уже накопленные звонки: первый разговор с тем же номером после несостоявшегося звонка
UPDATE "call_sessions" AS f
SET "follow_up_call_id" = n."id", "follow_up_at" = n."started_at", "follow_up_direction" = n."direction"
FROM (
  SELECT DISTINCT ON (failed."id") failed."id" AS failed_id, c."id", c."started_at", c."direction"
  FROM "call_sessions" failed
  JOIN "call_sessions" c
    ON c."phone_key" = failed."phone_key"
   AND c."started_at" > failed."started_at"
   AND c."status" = 'COMPLETED'
   AND c."deleted_at" IS NULL
  WHERE failed."status" IN ('MISSED', 'FAILED')
    AND failed."phone_key" IS NOT NULL
    AND failed."deleted_at" IS NULL
  ORDER BY failed."id", c."started_at"
) AS n
WHERE f."id" = n.failed_id;

-- Открытые задачи «перезвонить», по которым с клиентом уже поговорили (любой менеджер или клиент сам)
UPDATE "tasks"
SET "status" = 'DONE', "report" = 'Закрыто автоматически: состоялся разговор с этим номером', "updated_at" = CURRENT_TIMESTAMP
WHERE "status" IN ('TODO', 'IN_PROGRESS')
  AND "call_session_id" IN (SELECT "id" FROM "call_sessions" WHERE "follow_up_at" IS NOT NULL);
