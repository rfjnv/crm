CREATE TABLE "ai_reports" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "page_key"     TEXT NOT NULL,
  "content"      TEXT NOT NULL,
  "generated_by" TEXT NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_reports_page_key_key" ON "ai_reports"("page_key");

ALTER TABLE "ai_reports"
  ADD CONSTRAINT "ai_reports_generated_by_fkey"
  FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
