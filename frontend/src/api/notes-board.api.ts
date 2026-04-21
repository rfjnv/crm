import client from './client';
import type { NotesBoardRow } from '../types';

export type NotesBoardListResponse = {
  items: NotesBoardRow[];
  meta: { page: number; pageSize: number; total: number };
};

export type NotesBoardMyRequestsResponse = {
  items: Array<{
    id: string;
    comment: string;
    createdAt: string;
    rowId: string;
    client: { id: string; companyName: string };
    noteAuthor: { id: string; fullName: string };
    lastCallAt: string;
  }>;
  meta: { page: number; pageSize: number; total: number };
};

export type NotesBoardCreatePayload = {
  clientId: string;
  callResult: 'ANSWERED' | 'NO_ANSWER';
  status?: string;
  comment: string;
  lastCallAt: string;
  nextCallAt?: string | null;
};

export type NotesBoardUpdatePayload = Partial<NotesBoardCreatePayload>;

export const notesBoardApi = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    clientId?: string;
    authorId?: string;
    callResult?: 'ANSWERED' | 'NO_ANSWER';
    status?: string;
    q?: string;
  }) =>
    client.get<NotesBoardListResponse>('/notes-board', { params }).then((r) => r.data),

  create: (data: NotesBoardCreatePayload) =>
    client.post<NotesBoardRow>('/notes-board', data).then((r) => r.data),

  update: (id: string, data: NotesBoardUpdatePayload) =>
    client.patch<NotesBoardRow>(`/notes-board/${id}`, data).then((r) => r.data),

  requestEdit: (id: string, comment: string) =>
    client.post<NotesBoardRow>(`/notes-board/${id}/edit-request`, { comment }).then((r) => r.data),

  listMyEditRequests: (params?: { page?: number; pageSize?: number }) =>
    client.get<NotesBoardMyRequestsResponse>('/notes-board/edit-requests/mine', { params }).then((r) => r.data),

  remove: (id: string) =>
    client.delete<{ ok: true }>(`/notes-board/${id}`).then((r) => r.data),
};
