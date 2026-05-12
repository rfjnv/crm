CREATE TYPE "TelephonyProvider" AS ENUM ('ASTERISK');
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');
CREATE TYPE "CallSessionStatus" AS ENUM ('RINGING', 'ANSWERED', 'MISSED', 'FAILED', 'COMPLETED');

CREATE TABLE "telephony_extensions" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id"      TEXT NOT NULL,
  "extension"    TEXT NOT NULL,
  "sip_username" TEXT,
  "is_active"    BOOLEAN NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "telephony_extensions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telephony_extensions_extension_key" ON "telephony_extensions"("extension");
CREATE INDEX "telephony_extensions_user_id_is_active_idx" ON "telephony_extensions"("user_id", "is_active");

CREATE TABLE "call_sessions" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "provider"         "TelephonyProvider" NOT NULL DEFAULT 'ASTERISK',
  "external_call_id" TEXT NOT NULL,
  "direction"        "CallDirection" NOT NULL,
  "status"           "CallSessionStatus" NOT NULL DEFAULT 'RINGING',
  "from_number"      TEXT,
  "to_number"        TEXT,
  "manager_user_id"  TEXT,
  "client_id"        TEXT,
  "started_at"       TIMESTAMP(3) NOT NULL,
  "answered_at"      TIMESTAMP(3),
  "ended_at"         TIMESTAMP(3),
  "duration_sec"     INTEGER,
  "bill_sec"         INTEGER,
  "recording_url"    TEXT,
  "recording_path"   TEXT,
  "transcript"       TEXT,
  "audit_id"         TEXT,
  "raw_events"       JSONB,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_sessions_external_call_id_key" ON "call_sessions"("external_call_id");
CREATE INDEX "call_sessions_manager_user_id_started_at_idx" ON "call_sessions"("manager_user_id", "started_at");
CREATE INDEX "call_sessions_client_id_started_at_idx" ON "call_sessions"("client_id", "started_at");
CREATE INDEX "call_sessions_status_started_at_idx" ON "call_sessions"("status", "started_at");
CREATE INDEX "call_sessions_started_at_idx" ON "call_sessions"("started_at");
