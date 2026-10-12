-- Плашки HR в посещаемости: кто и когда отметил.
ALTER TABLE "attendance_records" ADD COLUMN "marks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "attendance_records" ADD COLUMN "marked_by_id" TEXT;
ALTER TABLE "attendance_records" ADD COLUMN "marked_at" TIMESTAMP(3);
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_marked_by_id_fkey"
  FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Карточка сотрудника: оценка HR за месяц.
CREATE TABLE "employee_monthly_reviews" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "discipline" INTEGER,
  "quality" INTEGER,
  "initiative" INTEGER,
  "teamwork" INTEGER,
  "praise" TEXT,
  "remarks" TEXT,
  "improve" TEXT,
  "reviewer_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_monthly_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_monthly_reviews_user_id_year_month_key" ON "employee_monthly_reviews"("user_id", "year", "month");
CREATE INDEX "employee_monthly_reviews_year_month_idx" ON "employee_monthly_reviews"("year", "month");
ALTER TABLE "employee_monthly_reviews" ADD CONSTRAINT "employee_monthly_reviews_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_monthly_reviews" ADD CONSTRAINT "employee_monthly_reviews_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
