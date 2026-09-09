-- CreateTable
CREATE TABLE "bonus_scheme" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "weights" JSONB NOT NULL,
    "tiers" JSONB NOT NULL,
    "targets" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "bonus_scheme_pkey" PRIMARY KEY ("id")
);
