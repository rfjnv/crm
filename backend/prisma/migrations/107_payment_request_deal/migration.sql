-- Заявка на оплату по одной сделке (в том числе не закрытой) с выбором количества по позициям.
ALTER TABLE "payment_requests" ADD COLUMN "deal_id" TEXT;
ALTER TABLE "payment_request_items" ADD COLUMN "deal_item_id" TEXT;

CREATE INDEX "payment_requests_deal_id_idx" ON "payment_requests"("deal_id");
CREATE INDEX "payment_request_items_deal_item_id_idx" ON "payment_request_items"("deal_item_id");

ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_deal_item_id_fkey" FOREIGN KEY ("deal_item_id") REFERENCES "deal_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
