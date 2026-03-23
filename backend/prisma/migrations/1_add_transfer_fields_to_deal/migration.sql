-- AddColumn to deals table for transfer payment info
ALTER TABLE "deals" ADD COLUMN "transfer_inn" TEXT;
ALTER TABLE "deals" ADD COLUMN "transfer_documents" TEXT;
ALTER TABLE "deals" ADD COLUMN "transfer_type" TEXT;
