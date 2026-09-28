-- На кого оформлять сделки, которые создаёт сотрудник (null — на него самого).
ALTER TABLE "users" ADD COLUMN "deals_owner_id" TEXT;

ALTER TABLE "users" ADD CONSTRAINT "users_deals_owner_id_fkey"
  FOREIGN KEY ("deals_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
