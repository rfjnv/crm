-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "user_agent" TEXT,
ADD COLUMN     "device_id" TEXT;
