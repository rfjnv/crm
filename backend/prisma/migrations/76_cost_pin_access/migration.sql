-- Себестоимость за ПИН-кодом: у каждого ADMIN / SUPER_ADMIN свой ПИН (bcrypt),
-- доступ открывается на 10 минут или на час и живёт в сессии входа.
ALTER TABLE "users" ADD COLUMN "cost_pin_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "cost_pin_failed_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "cost_pin_locked_until" TIMESTAMP(3);

ALTER TABLE "sessions" ADD COLUMN "cost_unlocked_until" TIMESTAMP(3);

ALTER TYPE "AuditAction" ADD VALUE 'COST_PIN_SET';
ALTER TYPE "AuditAction" ADD VALUE 'COST_PIN_RESET';
ALTER TYPE "AuditAction" ADD VALUE 'COST_UNLOCK';
ALTER TYPE "AuditAction" ADD VALUE 'COST_UNLOCK_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'COST_LOCK';
