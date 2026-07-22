-- CreateTable
CREATE TABLE "timepay_integration" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "access_token" TEXT,
    "token_updated_at" TIMESTAMP(3),
    "token_updated_by_id" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "last_sync_error" TEXT,
    "last_sync_matched" INTEGER,
    "last_sync_unmatched" INTEGER,
    "last_token_alert_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timepay_integration_pkey" PRIMARY KEY ("id")
);
