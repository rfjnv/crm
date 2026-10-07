-- Офис и склад на карте клиентов — стартовые точки для маршрутов доставки.

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "office_address" TEXT,
ADD COLUMN     "office_latitude" DOUBLE PRECISION,
ADD COLUMN     "office_longitude" DOUBLE PRECISION,
ADD COLUMN     "warehouse_address" TEXT,
ADD COLUMN     "warehouse_latitude" DOUBLE PRECISION,
ADD COLUMN     "warehouse_longitude" DOUBLE PRECISION;
