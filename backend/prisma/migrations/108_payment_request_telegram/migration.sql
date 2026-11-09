-- Пост заявки на оплату в группе финансов: обновляем его, когда бухгалтер принял или отклонил.
ALTER TABLE "payment_requests" ADD COLUMN "telegram_message_id" TEXT;
