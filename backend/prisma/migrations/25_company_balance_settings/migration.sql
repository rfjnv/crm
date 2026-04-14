ALTER TABLE "company_settings"
ADD COLUMN "balance_start_date" DATE,
ADD COLUMN "initial_balance" DECIMAL(15,2) NOT NULL DEFAULT 0;
