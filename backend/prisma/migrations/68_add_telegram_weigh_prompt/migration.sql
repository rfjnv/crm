-- CreateTable
CREATE TABLE "telegram_weigh_prompts" (
    "chat_id" TEXT NOT NULL,
    "telegram_user_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "deal_item_id" TEXT NOT NULL,
    "prompt_message_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_weigh_prompts_pkey" PRIMARY KEY ("chat_id","telegram_user_id")
);
