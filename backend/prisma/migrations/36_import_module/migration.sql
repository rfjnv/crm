-- =============================================================
-- 36_import_module: Модуль ВЭД (Supplier, ImportOrder, Items, Attachments)
-- Неразрушающая миграция. Только CREATE TYPE / CREATE TABLE /
-- ALTER TABLE ADD COLUMN. Никаких DROP / RESET / DATA-changes.
-- =============================================================

-- ---------- ENUMs (идемпотентно) ----------
DO $$ BEGIN
    CREATE TYPE "SupplierCurrency" AS ENUM ('USD', 'EUR', 'CNY', 'RUB', 'UZS');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "Incoterms" AS ENUM ('EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ImportOrderStatus" AS ENUM (
        'DRAFT', 'ORDERED', 'IN_PRODUCTION', 'SHIPPED',
        'IN_TRANSIT', 'AT_CUSTOMS', 'CLEARED', 'RECEIVED', 'CANCELED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ImportDocumentType" AS ENUM (
        'INVOICE', 'PACKING_LIST', 'BILL_OF_LADING', 'CMR',
        'CERT_OF_ORIGIN', 'CUSTOMS_DECLARATION', 'SWIFT', 'OTHER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ---------- suppliers ----------
CREATE TABLE IF NOT EXISTS "suppliers" (
    "id"             TEXT NOT NULL,
    "company_name"   TEXT NOT NULL,
    "country"        TEXT,
    "contact_person" TEXT,
    "email"          TEXT,
    "phone"          TEXT,
    "currency"       "SupplierCurrency" NOT NULL DEFAULT 'USD',
    "incoterms"      "Incoterms",
    "payment_terms"  TEXT,
    "bank_swift"     TEXT,
    "iban"           TEXT,
    "notes"          TEXT,
    "is_archived"    BOOLEAN NOT NULL DEFAULT false,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "suppliers_is_archived_idx" ON "suppliers" ("is_archived");
CREATE INDEX IF NOT EXISTS "suppliers_country_idx"      ON "suppliers" ("country");

-- ---------- products.supplier_id (nullable FK) ----------
ALTER TABLE "products"
    ADD COLUMN IF NOT EXISTS "supplier_id" TEXT;

DO $$ BEGIN
    ALTER TABLE "products"
        ADD CONSTRAINT "products_supplier_id_fkey"
        FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "products_supplier_id_idx" ON "products" ("supplier_id");

-- ---------- import_orders ----------
CREATE TABLE IF NOT EXISTS "import_orders" (
    "id"               TEXT NOT NULL,
    "number"           TEXT NOT NULL,
    "supplier_id"      TEXT NOT NULL,
    "created_by_id"    TEXT NOT NULL,
    "status"           "ImportOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency"         "SupplierCurrency" NOT NULL DEFAULT 'USD',
    "order_date"       TIMESTAMP(3) NOT NULL,
    "etd"              TIMESTAMP(3),
    "eta"              TIMESTAMP(3),
    "container_number" TEXT,
    "invoice_number"   TEXT,
    "invoice_rate"     DECIMAL(15,6),
    "total_amount"     DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes"            TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_orders_number_key"    ON "import_orders" ("number");
CREATE INDEX        IF NOT EXISTS "import_orders_supplier_id_idx" ON "import_orders" ("supplier_id");
CREATE INDEX        IF NOT EXISTS "import_orders_status_idx"      ON "import_orders" ("status");
CREATE INDEX        IF NOT EXISTS "import_orders_order_date_idx"  ON "import_orders" ("order_date");
CREATE INDEX        IF NOT EXISTS "import_orders_eta_idx"         ON "import_orders" ("eta");

DO $$ BEGIN
    ALTER TABLE "import_orders"
        ADD CONSTRAINT "import_orders_supplier_id_fkey"
        FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "import_orders"
        ADD CONSTRAINT "import_orders_created_by_id_fkey"
        FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ---------- import_order_items ----------
CREATE TABLE IF NOT EXISTS "import_order_items" (
    "id"              TEXT NOT NULL,
    "import_order_id" TEXT NOT NULL,
    "product_id"      TEXT NOT NULL,
    "qty"             DECIMAL(12,3) NOT NULL,
    "unit_price"      DECIMAL(12,2) NOT NULL,
    "line_total"      DECIMAL(15,2) NOT NULL,
    "comment"         TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_order_items_import_order_id_idx" ON "import_order_items" ("import_order_id");
CREATE INDEX IF NOT EXISTS "import_order_items_product_id_idx"      ON "import_order_items" ("product_id");

DO $$ BEGIN
    ALTER TABLE "import_order_items"
        ADD CONSTRAINT "import_order_items_import_order_id_fkey"
        FOREIGN KEY ("import_order_id") REFERENCES "import_orders"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "import_order_items"
        ADD CONSTRAINT "import_order_items_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "products"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ---------- import_order_attachments ----------
CREATE TABLE IF NOT EXISTS "import_order_attachments" (
    "id"              TEXT NOT NULL,
    "import_order_id" TEXT NOT NULL,
    "document_type"   "ImportDocumentType" NOT NULL DEFAULT 'OTHER',
    "filename"        TEXT NOT NULL,
    "path"            TEXT NOT NULL,
    "mime_type"       TEXT NOT NULL,
    "size"            INTEGER NOT NULL,
    "uploaded_by"     TEXT NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_order_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_order_attachments_import_order_id_idx" ON "import_order_attachments" ("import_order_id");
CREATE INDEX IF NOT EXISTS "import_order_attachments_document_type_idx"   ON "import_order_attachments" ("document_type");

DO $$ BEGIN
    ALTER TABLE "import_order_attachments"
        ADD CONSTRAINT "import_order_attachments_import_order_id_fkey"
        FOREIGN KEY ("import_order_id") REFERENCES "import_orders"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "import_order_attachments"
        ADD CONSTRAINT "import_order_attachments_uploaded_by_fkey"
        FOREIGN KEY ("uploaded_by") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
