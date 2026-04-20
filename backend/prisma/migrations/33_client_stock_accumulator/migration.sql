DO $$ BEGIN
  CREATE TYPE "ClientStockEventType" AS ENUM ('ADD', 'RESERVE_TO_DEAL', 'CORRECTION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "client_stock_positions" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "qty_total" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_stock_positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "client_stock_events" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "type" "ClientStockEventType" NOT NULL,
  "qty_delta" DECIMAL(12,3) NOT NULL,
  "qty_before" DECIMAL(12,3) NOT NULL,
  "qty_after" DECIMAL(12,3) NOT NULL,
  "unit_price" DECIMAL(12,2),
  "line_total" DECIMAL(15,2),
  "source_deal_id" TEXT,
  "author_id" TEXT NOT NULL,
  "comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_stock_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "client_stock_positions_client_id_product_id_key"
  ON "client_stock_positions"("client_id", "product_id");
CREATE INDEX IF NOT EXISTS "client_stock_positions_client_id_idx"
  ON "client_stock_positions"("client_id");
CREATE INDEX IF NOT EXISTS "client_stock_positions_product_id_idx"
  ON "client_stock_positions"("product_id");

CREATE INDEX IF NOT EXISTS "client_stock_events_client_id_created_at_idx"
  ON "client_stock_events"("client_id", "created_at");
CREATE INDEX IF NOT EXISTS "client_stock_events_client_id_product_id_idx"
  ON "client_stock_events"("client_id", "product_id");
CREATE INDEX IF NOT EXISTS "client_stock_events_source_deal_id_idx"
  ON "client_stock_events"("source_deal_id");
CREATE INDEX IF NOT EXISTS "client_stock_events_author_id_idx"
  ON "client_stock_events"("author_id");

DO $$ BEGIN
  ALTER TABLE "client_stock_positions"
    ADD CONSTRAINT "client_stock_positions_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "client_stock_positions"
    ADD CONSTRAINT "client_stock_positions_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "client_stock_events"
    ADD CONSTRAINT "client_stock_events_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "client_stock_events"
    ADD CONSTRAINT "client_stock_events_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "client_stock_events"
    ADD CONSTRAINT "client_stock_events_source_deal_id_fkey"
    FOREIGN KEY ("source_deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "client_stock_events"
    ADD CONSTRAINT "client_stock_events_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
