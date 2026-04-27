-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN "client_stock_event_id" UUID;

-- CreateIndex
CREATE INDEX "inventory_movements_client_stock_event_id_idx" ON "inventory_movements"("client_stock_event_id");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_client_stock_event_id_fkey" FOREIGN KEY ("client_stock_event_id") REFERENCES "client_stock_events"("id") ON DELETE SET ON UPDATE CASCADE;
