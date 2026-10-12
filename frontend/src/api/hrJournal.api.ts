import client from './client';

export type HrJournalType = 'attendance' | 'review' | 'staff' | 'goal';

export interface HrJournalItem {
  id: string;
  type: HrJournalType;
  at: string;
  author: { id: string; fullName: string; role: string };
  employee: { id: string; fullName: string } | null;
  title: string;
  forDate?: string | null;
  marks?: string[];
  scores?: { discipline: number | null; quality: number | null; initiative: number | null; teamwork: number | null; avg: number | null };
  texts?: { label: string; text: string }[];
  details?: string[];
}

export const hrJournalApi = {
  list: (params: { from: string; to: string; employeeId?: string; authorId?: string; onlyHr: boolean }) =>
    client
      .get<{ items: HrJournalItem[]; truncated: boolean }>('/hr-journal', { params: { ...params, onlyHr: String(params.onlyHr) } })
      .then((r) => r.data),
};
