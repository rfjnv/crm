-- CreateTable
CREATE TABLE "user_medal_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "badge_label" TEXT,
    "badge_icon" TEXT,
    "badge_color" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by_id" TEXT,
    "removed_at" TIMESTAMP(3),
    "removed_by_id" TEXT,

    CONSTRAINT "user_medal_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_medal_history_user_id_granted_at_idx" ON "user_medal_history"("user_id", "granted_at");

-- AddForeignKey
ALTER TABLE "user_medal_history" ADD CONSTRAINT "user_medal_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_medal_history" ADD CONSTRAINT "user_medal_history_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_medal_history" ADD CONSTRAINT "user_medal_history_removed_by_id_fkey" FOREIGN KEY ("removed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
