ALTER TABLE "users"
ADD COLUMN "department" TEXT;

CREATE INDEX "users_department_idx" ON "users"("department");
