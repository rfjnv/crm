ALTER TABLE "expenses"
ADD COLUMN "method" TEXT;

CREATE INDEX "expenses_method_idx" ON "expenses"("method");
