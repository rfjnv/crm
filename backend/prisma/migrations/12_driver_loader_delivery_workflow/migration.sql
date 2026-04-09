-- Add DRIVER and LOADER roles
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DRIVER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'LOADER';

-- Add new DealStatus values
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'WAITING_WAREHOUSE_MANAGER';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'PENDING_ADMIN';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_LOADING';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'LOADING_ASSIGNED';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_DELIVERY';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'IN_DELIVERY';

-- Create DeliveryType enum
DO $$ BEGIN
  CREATE TYPE "DeliveryType" AS ENUM ('SELF_PICKUP', 'YANDEX', 'DELIVERY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add delivery/loading/driver fields to deals
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "delivery_type" "DeliveryType";
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "delivery_vehicle_number" TEXT;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "delivery_vehicle_type" TEXT;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "delivery_comment" TEXT;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "loading_assignee_id" TEXT;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "delivery_driver_id" TEXT;

-- Foreign keys
ALTER TABLE "deals" ADD CONSTRAINT "deals_loading_assignee_id_fkey"
  FOREIGN KEY ("loading_assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deals" ADD CONSTRAINT "deals_delivery_driver_id_fkey"
  FOREIGN KEY ("delivery_driver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "deals_loading_assignee_id_idx" ON "deals"("loading_assignee_id");
CREATE INDEX IF NOT EXISTS "deals_delivery_driver_id_idx" ON "deals"("delivery_driver_id");
