-- Телефон HR: отдельный поток звонков (кандидаты, сотрудники), не смешивается с продажами.
-- Существующие строки остаются SALES.

-- CreateEnum
CREATE TYPE "CallChannel" AS ENUM ('SALES', 'HR');

-- AlterTable
ALTER TABLE "call_sessions" ADD COLUMN     "channel" "CallChannel" NOT NULL DEFAULT 'SALES';

-- AlterTable
ALTER TABLE "call_recordings" ADD COLUMN     "channel" "CallChannel" NOT NULL DEFAULT 'SALES';

-- AlterTable
ALTER TABLE "mobile_devices" ADD COLUMN     "channel" "CallChannel" NOT NULL DEFAULT 'SALES';

-- CreateIndex
CREATE INDEX "call_sessions_channel_started_at_idx" ON "call_sessions"("channel", "started_at");

