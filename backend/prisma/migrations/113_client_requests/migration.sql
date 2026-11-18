-- Запросы клиентов: какой товар или что ещё хочет клиент.
CREATE TABLE IF NOT EXISTS "client_requests" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PRODUCT',
    "product_id" TEXT,
    "product_name" TEXT,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "resolution" TEXT,
    "due_date" TIMESTAMP(3),
    "author_id" TEXT NOT NULL,
    "closed_by_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "client_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_requests_status_created_at_idx" ON "client_requests"("status", "created_at");
CREATE INDEX IF NOT EXISTS "client_requests_client_id_created_at_idx" ON "client_requests"("client_id", "created_at");
CREATE INDEX IF NOT EXISTS "client_requests_product_id_idx" ON "client_requests"("product_id");

ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
