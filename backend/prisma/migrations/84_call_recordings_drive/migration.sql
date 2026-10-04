-- Архив записей звонков на Google Drive: Supabase остаётся временным буфером на несколько дней.

-- AlterTable
ALTER TABLE "call_sessions" ADD COLUMN     "drive_file_id" TEXT;

-- AlterTable
ALTER TABLE "call_recordings" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "drive_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "drive_error" TEXT,
ADD COLUMN     "drive_file_id" TEXT;

-- AlterTable
ALTER TABLE "mobile_telephony_settings" ADD COLUMN     "drive_retention_months" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recordings_buffer_days" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "google_drive_connection" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "refresh_token" TEXT,
    "account_email" TEXT,
    "root_folder_id" TEXT,
    "connected_at" TIMESTAMP(3),
    "connected_by_id" TEXT,
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_drive_connection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_recordings_drive_file_id_idx" ON "call_recordings"("drive_file_id");

