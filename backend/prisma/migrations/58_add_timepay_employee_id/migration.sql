-- AlterTable
ALTER TABLE "users" ADD COLUMN "timepay_employee_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_timepay_employee_id_key" ON "users"("timepay_employee_id");
