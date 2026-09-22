-- Два уровня скрытия денег вместо булевого hide_money (миграция 69).
CREATE TYPE "MoneyAccess" AS ENUM ('FULL', 'NO_STRATEGIC', 'NONE');

ALTER TABLE "users" ADD COLUMN "money_access" "MoneyAccess" NOT NULL DEFAULT 'FULL';

-- Тем, у кого деньги были скрыты булевым флагом, — самый строгий уровень.
UPDATE "users" SET "money_access" = 'NONE' WHERE "hide_money" = true;

ALTER TABLE "users" DROP COLUMN "hide_money";
