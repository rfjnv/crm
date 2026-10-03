-- Мобильная телефония: приложение CallSync на рабочих телефонах менеджеров.
-- Звонки ложатся в существующую call_sessions (provider = MOBILE), записи — в call_recordings.

-- CreateEnum
CREATE TYPE "CallAudioStatus" AS ENUM ('NONE', 'UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'ANALYZED', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "TelephonyProvider" ADD VALUE 'MOBILE';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "call_session_id" TEXT;

-- AlterTable
ALTER TABLE "call_sessions" ADD COLUMN     "audio_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "audio_error" TEXT,
ADD COLUMN     "audio_status" "CallAudioStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "called_back_at" TIMESTAMP(3),
ADD COLUMN     "device_call_id" TEXT,
ADD COLUMN     "device_id" TEXT,
ADD COLUMN     "mobile_type" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phone_key" TEXT,
ADD COLUMN     "sim_slot" INTEGER;

-- CreateTable
CREATE TABLE "call_recordings" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "call_session_id" TEXT,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT,
    "storage_path" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER NOT NULL,
    "duration_sec" INTEGER,
    "file_modified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "model" TEXT,
    "android_version" TEXT,
    "sdk_int" INTEGER,
    "app_version" TEXT,
    "token_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_call_at" TIMESTAMP(3),
    "queue_calls" INTEGER NOT NULL DEFAULT 0,
    "queue_files" INTEGER NOT NULL DEFAULT 0,
    "queue_bytes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failed_calls" INTEGER NOT NULL DEFAULT 0,
    "sim_slot" INTEGER,
    "permissions" JSONB,
    "recordings_dir_found" BOOLEAN,
    "recordings_path_override" TEXT,
    "upload_logs_requested" BOOLEAN NOT NULL DEFAULT false,
    "last_log_path" TEXT,
    "last_log_at" TIMESTAMP(3),
    "silent_alerted_at" TIMESTAMP(3),
    "no_recordings_alerted_at" TIMESTAMP(3),
    "problems_alert_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_pairing_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_device_model_configs" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "recordings_path" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_device_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_telephony_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "work_start_hour" INTEGER NOT NULL DEFAULT 9,
    "work_end_hour" INTEGER NOT NULL DEFAULT 18,
    "work_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "wifi_only_above_mb" INTEGER NOT NULL DEFAULT 20,
    "sync_interval_min" INTEGER NOT NULL DEFAULT 15,
    "min_audit_duration_sec" INTEGER NOT NULL DEFAULT 30,
    "auto_audit_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_telephony_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_recordings_sha256_key" ON "call_recordings"("sha256");

-- CreateIndex
CREATE INDEX "call_recordings_user_id_created_at_idx" ON "call_recordings"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "call_recordings_call_session_id_idx" ON "call_recordings"("call_session_id");

-- CreateIndex
CREATE INDEX "call_recordings_created_at_idx" ON "call_recordings"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_devices_token_hash_key" ON "mobile_devices"("token_hash");

-- CreateIndex
CREATE INDEX "mobile_devices_user_id_active_idx" ON "mobile_devices"("user_id", "active");

-- CreateIndex
CREATE INDEX "mobile_devices_active_last_seen_at_idx" ON "mobile_devices"("active", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_pairing_codes_code_hash_key" ON "mobile_pairing_codes"("code_hash");

-- CreateIndex
CREATE INDEX "mobile_pairing_codes_user_id_idx" ON "mobile_pairing_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_device_model_configs_model_key" ON "mobile_device_model_configs"("model");

-- CreateIndex
CREATE INDEX "tasks_call_session_id_idx" ON "tasks"("call_session_id");

-- CreateIndex
CREATE INDEX "call_sessions_provider_started_at_idx" ON "call_sessions"("provider", "started_at");

-- CreateIndex
CREATE INDEX "call_sessions_phone_idx" ON "call_sessions"("phone");

-- CreateIndex
CREATE INDEX "call_sessions_phone_key_idx" ON "call_sessions"("phone_key");

-- CreateIndex
CREATE INDEX "call_sessions_audio_status_idx" ON "call_sessions"("audio_status");

-- Внешние ключи на users/clients у call_sessions раньше не было: висячие ссылки обнуляем,
-- иначе ограничение не создастся.
UPDATE "call_sessions" SET "manager_user_id" = NULL
WHERE "manager_user_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "call_sessions"."manager_user_id");
UPDATE "call_sessions" SET "client_id" = NULL
WHERE "client_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "clients" c WHERE c."id" = "call_sessions"."client_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_call_session_id_fkey" FOREIGN KEY ("call_session_id") REFERENCES "call_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "mobile_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_call_session_id_fkey" FOREIGN KEY ("call_session_id") REFERENCES "call_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_pairing_codes" ADD CONSTRAINT "mobile_pairing_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "mobile_telephony_settings" ("id", "updated_at") VALUES ('singleton', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
