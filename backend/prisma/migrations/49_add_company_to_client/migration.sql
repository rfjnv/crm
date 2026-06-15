-- AlterTable: add company_id to clients
ALTER TABLE "clients" ADD COLUMN "company_id" TEXT;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Set existing clients to polygraph company
UPDATE "clients"
SET "company_id" = (SELECT "id" FROM "companies" WHERE "name" = 'polygraph' LIMIT 1)
WHERE "company_id" IS NULL;

-- Index for fast filtering
CREATE INDEX "clients_company_id_idx" ON "clients"("company_id");
