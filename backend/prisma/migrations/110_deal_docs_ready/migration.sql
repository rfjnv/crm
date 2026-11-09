-- Сделка на перечисление: бухгалтер отмечает, что документы готовы; это видно в постах Telegram-групп.
ALTER TABLE "deals" ADD COLUMN "docs_ready_at" TIMESTAMP(3);
ALTER TABLE "deals" ADD COLUMN "docs_ready_by_id" TEXT;
