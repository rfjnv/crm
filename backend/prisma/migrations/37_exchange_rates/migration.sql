-- MVP-3: Таблица курсов валют ЦБ РУз.
-- Идемпотентно (только CREATE ... IF NOT EXISTS). НИЧЕГО не удаляет.

CREATE TABLE IF NOT EXISTS "exchange_rates" (
    "id"         TEXT NOT NULL,
    "date"       DATE NOT NULL,
    "currency"   TEXT NOT NULL,
    "rate"       DECIMAL(18,6) NOT NULL,
    "nominal"    INTEGER NOT NULL DEFAULT 1,
    "source"     TEXT NOT NULL DEFAULT 'CBU',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_date_currency_key"
    ON "exchange_rates"("date", "currency");

CREATE INDEX IF NOT EXISTS "exchange_rates_date_idx"
    ON "exchange_rates"("date");

CREATE INDEX IF NOT EXISTS "exchange_rates_currency_idx"
    ON "exchange_rates"("currency");
