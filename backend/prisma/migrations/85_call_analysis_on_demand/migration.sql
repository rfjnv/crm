-- Анализ звонков — по выбору (это платно): постоянный анализ выключается, разбор запускают вручную.
-- Плюс общий анализ по выбранным звонкам и удаление звонков руководителем.

-- CreateEnum
CREATE TYPE "CallReportStatus" AS ENUM ('WAITING', 'RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "call_sessions" ADD COLUMN     "analysis_request" TEXT,
ADD COLUMN     "analysis_requested_by_id" TEXT,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by_id" TEXT;

-- AlterTable
ALTER TABLE "mobile_telephony_settings" ALTER COLUMN "auto_audit_enabled" SET DEFAULT false;

-- CreateTable
CREATE TABLE "call_group_reports" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "call_ids" TEXT[],
    "status" "CallReportStatus" NOT NULL DEFAULT 'WAITING',
    "result" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "call_group_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_group_reports_status_idx" ON "call_group_reports"("status");

-- CreateIndex
CREATE INDEX "call_group_reports_created_at_idx" ON "call_group_reports"("created_at");

-- CreateIndex
CREATE INDEX "call_sessions_deleted_at_idx" ON "call_sessions"("deleted_at");

-- AddForeignKey
ALTER TABLE "call_group_reports" ADD CONSTRAINT "call_group_reports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Уже работающий постоянный анализ выключаем: дальше — только по выбору
UPDATE "mobile_telephony_settings" SET "auto_audit_enabled" = false;
