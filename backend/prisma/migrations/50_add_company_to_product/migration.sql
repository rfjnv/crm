ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "company_id" TEXT;

ALTER TABLE "products" ADD CONSTRAINT "products_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "products"
SET "company_id" = (SELECT "id" FROM "companies" WHERE "name" = 'polygraph' LIMIT 1)
WHERE "company_id" IS NULL;

CREATE INDEX IF NOT EXISTS "products_company_id_idx" ON "products"("company_id");
