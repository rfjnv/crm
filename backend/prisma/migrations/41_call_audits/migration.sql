CREATE TABLE "call_audits" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "created_by"     TEXT NOT NULL,
  "manager_name"   TEXT,
  "transcript"     TEXT NOT NULL,
  "analysis"       TEXT NOT NULL,
  "score"          DOUBLE PRECISION,
  "sale_probability" INTEGER,
  "audio_duration" DOUBLE PRECISION,
  "quality_score"  DOUBLE PRECISION,
  "audit_language" TEXT NOT NULL DEFAULT 'mixed',
  "source"         TEXT NOT NULL DEFAULT 'audio',
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "call_audits_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "call_audits"
  ADD CONSTRAINT "call_audits_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "call_audits_created_by_idx" ON "call_audits"("created_by");
CREATE INDEX "call_audits_created_at_idx" ON "call_audits"("created_at" DESC);
