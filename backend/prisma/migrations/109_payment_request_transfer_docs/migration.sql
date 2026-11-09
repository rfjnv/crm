-- Заявка на оплату по перечислению идёт как сделка: менеджер указывает ИНН, документы и тип,
-- бухгалтер сначала делает документы и только потом принимает оплату.
ALTER TABLE "payment_requests" ADD COLUMN "transfer_inn" TEXT;
ALTER TABLE "payment_requests" ADD COLUMN "transfer_documents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "payment_requests" ADD COLUMN "transfer_type" TEXT;
ALTER TABLE "payment_requests" ADD COLUMN "docs_ready_at" TIMESTAMP(3);
ALTER TABLE "payment_requests" ADD COLUMN "docs_ready_by_id" TEXT;

ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_docs_ready_by_id_fkey" FOREIGN KEY ("docs_ready_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
