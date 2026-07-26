-- AddColumn: receipt punched flag on deals
ALTER TABLE "deals" ADD COLUMN "is_receipt_punched" BOOLEAN NOT NULL DEFAULT false;
