-- AlterTable
ALTER TABLE "products" ADD COLUMN "post_text_ru" TEXT,
ADD COLUMN "post_text_uz" TEXT;

-- CreateTable
CREATE TABLE "product_poster_photos" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_poster_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_poster_photos_product_id_idx" ON "product_poster_photos"("product_id");

-- AddForeignKey
ALTER TABLE "product_poster_photos" ADD CONSTRAINT "product_poster_photos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
