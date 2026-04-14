-- Create enum for client credit status
CREATE TYPE "ClientCreditStatus" AS ENUM ('NORMAL', 'SATISFACTORY', 'NEGATIVE');

-- Add new status column to clients table
ALTER TABLE "clients"
ADD COLUMN "credit_status" "ClientCreditStatus" NOT NULL DEFAULT 'NORMAL';
