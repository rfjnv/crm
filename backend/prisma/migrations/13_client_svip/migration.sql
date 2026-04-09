-- Add SVIP (Super VIP) flag to clients
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "is_svip" BOOLEAN NOT NULL DEFAULT false;
