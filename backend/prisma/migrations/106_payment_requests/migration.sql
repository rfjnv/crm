-- Заявки на оплату: менеджер собирает товары за период, бухгалтер принимает оплату.
-- Сделки не меняются, при подтверждении на них только добавляются оплаты.
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED');

CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "client_id" TEXT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'TRANSFER',
    "amount" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_request_items" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(15,2) NOT NULL,
    CONSTRAINT "payment_request_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payments" ADD COLUMN "payment_request_id" TEXT;

CREATE UNIQUE INDEX "payment_requests_number_key" ON "payment_requests"("number");
CREATE INDEX "payment_requests_status_created_at_idx" ON "payment_requests"("status", "created_at");
CREATE INDEX "payment_requests_client_id_period_from_idx" ON "payment_requests"("client_id", "period_from");
CREATE INDEX "payment_requests_created_by_id_idx" ON "payment_requests"("created_by_id");
CREATE INDEX "payment_request_items_request_id_idx" ON "payment_request_items"("request_id");
CREATE INDEX "payment_request_items_product_id_idx" ON "payment_request_items"("product_id");
CREATE INDEX "payments_payment_request_id_idx" ON "payments"("payment_request_id");

ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
