import apiClient from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NoteAuditReport = {
  id: string;
  managerId: string;
  managerName: string;
  managerRole: string;
  periodStart: string;
  periodEnd: string;
  scoreSpecificity: number;
  scoreFollowUp: number;
  scoreNextStep: number;
  scoreTone: number;
  scoreOverall: number;
  summary: string;
  feedbackSpecificity: string;
  feedbackFollowUp: string;
  feedbackNextStep: string;
  feedbackTone: string;
  goodExamples: string[];
  badExamples: string[];
  notesCount: number;
  status: 'PENDING' | 'DONE' | 'ERROR';
  errorMessage: string | null;
  isCorrected: boolean;
  correctedById: string | null;
  correctedByName: string | null;
  correctedAt: string | null;
  correctionReason: string | null;
  correctedScoreSpecificity: number | null;
  correctedScoreFollowUp: number | null;
  correctedScoreNextStep: number | null;
  correctedScoreTone: number | null;
  correctedScoreOverall: number | null;
  correctedSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NoteAuditMemory = {
  id: string;
  managerId: string;
  context: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
};

// ─── API methods ──────────────────────────────────────────────────────────────

export const noteAuditApi = {
  /** Trigger generation for one manager or all (managerId omitted = all) */
  generate: (params: { managerId?: string; weekOffset?: number }) =>
    apiClient
      .post<{ report?: NoteAuditReport; message?: string }>('/analytics/note-audit/generate', params)
      .then((r) => r.data),

  /** List all reports for a given week */
  getReports: (params: { weekOffset?: number; managerId?: string } = {}) =>
    apiClient
      .get<{ reports: NoteAuditReport[] }>('/analytics/note-audit/reports', { params })
      .then((r) => r.data.reports),

  /** Single report detail */
  getReport: (id: string) =>
    apiClient
      .get<{ report: NoteAuditReport }>(`/analytics/note-audit/reports/${id}`)
      .then((r) => r.data.report),

  /** Super-admin correction */
  correctReport: (
    id: string,
    data: {
      correctionReason: string;
      correctedScoreSpecificity?: number;
      correctedScoreFollowUp?: number;
      correctedScoreNextStep?: number;
      correctedScoreTone?: number;
      correctedSummary?: string;
      saveAsMemory?: boolean;
      memoryScope?: 'manager' | 'global';
    },
  ) =>
    apiClient
      .patch<{ report: NoteAuditReport }>(`/analytics/note-audit/reports/${id}/correct`, data)
      .then((r) => r.data.report),

  /** List memories */
  getMemory: (managerId?: string) =>
    apiClient
      .get<{ memories: NoteAuditMemory[] }>('/analytics/note-audit/memory', {
        params: managerId ? { managerId } : {},
      })
      .then((r) => r.data.memories),

  /** Delete a memory entry */
  deleteMemory: (id: string) =>
    apiClient.delete(`/analytics/note-audit/memory/${id}`).then((r) => r.data),
};
