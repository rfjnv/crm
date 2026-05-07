CREATE TABLE "worker_reviews" (
  "id"          TEXT NOT NULL,
  "manager_id"  TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "rating"      INTEGER NOT NULL,
  "comment"     TEXT,
  "period"      TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "worker_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "worker_reviews_manager_id_idx"  ON "worker_reviews"("manager_id");
CREATE INDEX "worker_reviews_reviewer_id_idx" ON "worker_reviews"("reviewer_id");
CREATE INDEX "worker_reviews_period_idx"      ON "worker_reviews"("period");

ALTER TABLE "worker_reviews"
  ADD CONSTRAINT "worker_reviews_manager_id_fkey"
    FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "worker_reviews"
  ADD CONSTRAINT "worker_reviews_reviewer_id_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
