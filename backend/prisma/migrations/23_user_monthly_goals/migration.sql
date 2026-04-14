CREATE TABLE "user_monthly_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "deals_target" INTEGER,
    "revenue_target" DECIMAL(15,2),
    "call_notes_target" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "user_monthly_goals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_monthly_goals_user_id_year_month_key"
ON "user_monthly_goals"("user_id", "year", "month");

CREATE INDEX "user_monthly_goals_year_month_idx"
ON "user_monthly_goals"("year", "month");

ALTER TABLE "user_monthly_goals"
ADD CONSTRAINT "user_monthly_goals_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_monthly_goals"
ADD CONSTRAINT "user_monthly_goals_updated_by_id_fkey"
FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
