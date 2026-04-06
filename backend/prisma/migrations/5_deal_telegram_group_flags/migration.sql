-- AlterTable
ALTER TABLE "deals" ADD COLUMN "sent_to_warehouse_tg" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deals" ADD COLUMN "sent_to_production_tg" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deals" ADD COLUMN "sent_to_finance_tg" BOOLEAN NOT NULL DEFAULT false;
