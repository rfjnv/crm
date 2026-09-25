-- Тип клиента: обычный клиент, своя/союзная компания или конкурент.
CREATE TYPE "ClientRelation" AS ENUM ('CUSTOMER', 'AFFILIATE', 'COMPETITOR');

ALTER TABLE "clients" ADD COLUMN "relation" "ClientRelation" NOT NULL DEFAULT 'CUSTOMER';
