-- Deal ratings for QR-based customer feedback
CREATE TABLE IF NOT EXISTS "deal_ratings" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "deal_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "rated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_ratings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "deal_ratings_deal_id_key" ON "deal_ratings"("deal_id");
CREATE UNIQUE INDEX IF NOT EXISTS "deal_ratings_token_key" ON "deal_ratings"("token");
CREATE INDEX IF NOT EXISTS "deal_ratings_token_idx" ON "deal_ratings"("token");

DO $$ BEGIN
    ALTER TABLE "deal_ratings" ADD CONSTRAINT "deal_ratings_deal_id_fkey"
        FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
