-- Причина ухода «Качество товара»: к ней сохраняются категории и товары, которыми клиент недоволен.
ALTER TYPE "ClientLossReason" ADD VALUE 'QUALITY' BEFORE 'UNKNOWN';

ALTER TABLE "clients" ADD COLUMN "loss_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "clients" ADD COLUMN "loss_product_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
