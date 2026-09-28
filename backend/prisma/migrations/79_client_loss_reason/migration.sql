-- Причина ухода клиента (плашка в списке клиентов). NULL — клиент не потерян.
CREATE TYPE "ClientLossReason" AS ENUM ('NO_CREDIT', 'PRICE', 'NO_PRODUCT', 'LOGISTICS', 'COMPETITOR', 'UNKNOWN');

ALTER TABLE "clients" ADD COLUMN "loss_reason" "ClientLossReason";
ALTER TABLE "clients" ADD COLUMN "loss_reason_at" TIMESTAMP(3);
