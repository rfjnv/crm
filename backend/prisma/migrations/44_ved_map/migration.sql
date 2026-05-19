-- 44_ved_map: карта ВЭД — точки поставщиков, маршруты, логотипы

DO $$ BEGIN
    CREATE TYPE "SupplierSiteType" AS ENUM ('FACTORY', 'WAREHOUSE', 'PORT', 'OFFICE', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "logo_path" TEXT;

CREATE TABLE IF NOT EXISTS "supplier_sites" (
    "id"          TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "site_type"   "SupplierSiteType" NOT NULL DEFAULT 'FACTORY',
    "address"     TEXT,
    "country"     TEXT,
    "latitude"    DOUBLE PRECISION NOT NULL,
    "longitude"   DOUBLE PRECISION NOT NULL,
    "notes"       TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_sites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ved_map_routes" (
    "id"            TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "supplier_id"   TEXT,
    "color"         TEXT DEFAULT '#22609A',
    "notes"         TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ved_map_routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ved_map_route_points" (
    "id"         TEXT NOT NULL,
    "route_id"   TEXT NOT NULL,
    "site_id"    TEXT,
    "label"      TEXT,
    "latitude"   DOUBLE PRECISION NOT NULL,
    "longitude"  DOUBLE PRECISION NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "ved_map_route_points_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supplier_sites_supplier_id_idx" ON "supplier_sites"("supplier_id");
CREATE INDEX IF NOT EXISTS "supplier_sites_site_type_idx" ON "supplier_sites"("site_type");
CREATE INDEX IF NOT EXISTS "ved_map_routes_supplier_id_idx" ON "ved_map_routes"("supplier_id");
CREATE INDEX IF NOT EXISTS "ved_map_routes_created_by_id_idx" ON "ved_map_routes"("created_by_id");
CREATE INDEX IF NOT EXISTS "ved_map_route_points_route_id_sort_order_idx" ON "ved_map_route_points"("route_id", "sort_order");

DO $$ BEGIN
    ALTER TABLE "supplier_sites" ADD CONSTRAINT "supplier_sites_supplier_id_fkey"
        FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ved_map_routes" ADD CONSTRAINT "ved_map_routes_supplier_id_fkey"
        FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ved_map_routes" ADD CONSTRAINT "ved_map_routes_created_by_id_fkey"
        FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ved_map_route_points" ADD CONSTRAINT "ved_map_route_points_route_id_fkey"
        FOREIGN KEY ("route_id") REFERENCES "ved_map_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ved_map_route_points" ADD CONSTRAINT "ved_map_route_points_site_id_fkey"
        FOREIGN KEY ("site_id") REFERENCES "supplier_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
