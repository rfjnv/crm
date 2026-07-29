-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'FULFILLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "product_reservations" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "manager_id" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_reservations_product_id_idx" ON "product_reservations"("product_id");

-- CreateIndex
CREATE INDEX "product_reservations_client_id_idx" ON "product_reservations"("client_id");

-- CreateIndex
CREATE INDEX "product_reservations_status_idx" ON "product_reservations"("status");

-- CreateIndex
CREATE INDEX "product_reservations_expires_at_idx" ON "product_reservations"("expires_at");

-- AddForeignKey
ALTER TABLE "product_reservations" ADD CONSTRAINT "product_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reservations" ADD CONSTRAINT "product_reservations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reservations" ADD CONSTRAINT "product_reservations_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

