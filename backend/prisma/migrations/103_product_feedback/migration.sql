-- Обзвон «как вам товар»: отзывы клиентов о товаре после прихода партии
CREATE TABLE "product_feedback" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "reached" BOOLEAN NOT NULL DEFAULT true,
    "rating" INTEGER,
    "comment" TEXT,
    "arrival_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_feedback_product_id_created_at_idx" ON "product_feedback"("product_id", "created_at");
CREATE INDEX "product_feedback_client_id_created_at_idx" ON "product_feedback"("client_id", "created_at");

ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
