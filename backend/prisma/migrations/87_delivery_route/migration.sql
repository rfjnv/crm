-- Общий маршрут доставки (одна строка): набор клиентов с карты виден и водителю.

-- CreateTable
CREATE TABLE "delivery_routes" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "client_ids" TEXT[],
    "start_base" TEXT NOT NULL DEFAULT 'WAREHOUSE',
    "roundtrip" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_routes_pkey" PRIMARY KEY ("id")
);
