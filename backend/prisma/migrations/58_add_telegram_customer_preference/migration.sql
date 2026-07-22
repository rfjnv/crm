-- CreateTable
CREATE TABLE "telegram_customer_preferences" (
    "chat_id" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'ru',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_customer_preferences_pkey" PRIMARY KEY ("chat_id")
);
