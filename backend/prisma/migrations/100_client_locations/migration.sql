-- У клиента может быть несколько точек доставки (филиалы, другие склады): основная — адрес в clients.
CREATE TABLE "client_locations" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contact_name" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_locations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_locations_client_id_idx" ON "client_locations"("client_id");

ALTER TABLE "client_locations" ADD CONSTRAINT "client_locations_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Сделка с доставкой может ехать не на основной адрес клиента
ALTER TABLE "deals" ADD COLUMN "delivery_location_id" TEXT;

CREATE INDEX "deals_delivery_location_id_idx" ON "deals"("delivery_location_id");

ALTER TABLE "deals" ADD CONSTRAINT "deals_delivery_location_id_fkey"
    FOREIGN KEY ("delivery_location_id") REFERENCES "client_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
