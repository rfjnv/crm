-- Отметки «доставлено» по остановкам общего маршрута.

-- AlterTable
ALTER TABLE "delivery_routes" ADD COLUMN     "delivered" JSONB NOT NULL DEFAULT '{}';
