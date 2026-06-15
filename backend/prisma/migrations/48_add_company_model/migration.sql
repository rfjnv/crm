-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- AlterTable
ALTER TABLE "users" ADD COLUMN "company_id" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default companies
INSERT INTO "companies" ("id", "name", "display_name") VALUES
  (gen_random_uuid(), 'polygraph', 'Polygraph Business'),
  (gen_random_uuid(), 'grand-astra', 'Grand Astra');
