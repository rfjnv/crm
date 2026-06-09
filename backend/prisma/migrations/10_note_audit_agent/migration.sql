-- CreateTable: note_audit_reports
CREATE TABLE "note_audit_reports" (
    "id"                          TEXT NOT NULL,
    "manager_id"                  TEXT NOT NULL,
    "period_start"                TIMESTAMP(3) NOT NULL,
    "period_end"                  TIMESTAMP(3) NOT NULL,
    "score_specificity"           DOUBLE PRECISION NOT NULL,
    "score_follow_up"             DOUBLE PRECISION NOT NULL,
    "score_next_step"             DOUBLE PRECISION NOT NULL,
    "score_tone"                  DOUBLE PRECISION NOT NULL,
    "score_overall"               DOUBLE PRECISION NOT NULL,
    "summary"                     TEXT NOT NULL,
    "feedback_specificity"        TEXT NOT NULL,
    "feedback_follow_up"          TEXT NOT NULL,
    "feedback_next_step"          TEXT NOT NULL,
    "feedback_tone"               TEXT NOT NULL,
    "good_examples"               TEXT,
    "bad_examples"                TEXT,
    "notes_count"                 INTEGER NOT NULL,
    "status"                      TEXT NOT NULL DEFAULT 'PENDING',
    "error_message"               TEXT,
    "is_corrected"                BOOLEAN NOT NULL DEFAULT false,
    "corrected_by_id"             TEXT,
    "corrected_at"                TIMESTAMP(3),
    "correction_reason"           TEXT,
    "corrected_score_specificity" DOUBLE PRECISION,
    "corrected_score_follow_up"   DOUBLE PRECISION,
    "corrected_score_next_step"   DOUBLE PRECISION,
    "corrected_score_tone"        DOUBLE PRECISION,
    "corrected_score_overall"     DOUBLE PRECISION,
    "corrected_summary"           TEXT,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_audit_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable: note_audit_memory
CREATE TABLE "note_audit_memory" (
    "id"             TEXT NOT NULL,
    "manager_id"     TEXT NOT NULL,
    "context"        TEXT NOT NULL,
    "created_by_id"  TEXT NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_audit_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_audit_reports_manager_id_idx"  ON "note_audit_reports"("manager_id");
CREATE INDEX "note_audit_reports_period_start_idx" ON "note_audit_reports"("period_start");
CREATE INDEX "note_audit_memory_manager_id_idx"   ON "note_audit_memory"("manager_id");

-- AddForeignKey
ALTER TABLE "note_audit_reports"
    ADD CONSTRAINT "note_audit_reports_manager_id_fkey"
    FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "note_audit_reports"
    ADD CONSTRAINT "note_audit_reports_corrected_by_id_fkey"
    FOREIGN KEY ("corrected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "note_audit_memory"
    ADD CONSTRAINT "note_audit_memory_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
