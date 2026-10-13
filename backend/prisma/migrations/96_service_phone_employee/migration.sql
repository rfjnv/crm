-- Служебный номер можно привязать к сотруднику CRM; номер и подпись можно править.

-- AlterTable
ALTER TABLE "service_phones" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "service_phones_user_id_idx" ON "service_phones"("user_id");

-- AddForeignKey
ALTER TABLE "service_phones" ADD CONSTRAINT "service_phones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

