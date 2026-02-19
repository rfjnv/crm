import client, { API_URL } from './client';
import type { Task, TaskAttachment, TaskStatus } from '../types';

export const tasksApi = {
  list: (params?: { assigneeId?: string; status?: string; createdById?: string }) =>
    client.get<Task[]>('/tasks', { params }).then((r) => r.data),

  create: (data: { title: string; description?: string; assigneeId: string; dueDate?: string }) =>
    client.post<Task>('/tasks', data).then((r) => r.data),

  update: (id: string, data: { title?: string; description?: string; dueDate?: string | null }) =>
    client.patch<Task>(`/tasks/${id}`, data).then((r) => r.data),

  moveStatus: (id: string, data: { status: TaskStatus; report?: string }) =>
    client.patch<Task>(`/tasks/${id}/status`, data).then((r) => r.data),

  setReport: (id: string, report: string) =>
    client.patch<Task>(`/tasks/${id}/report`, { report }).then((r) => r.data),

  uploadAttachment: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post<TaskAttachment>(`/tasks/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  downloadAttachmentUrl: (taskId: string, attachmentId: string) =>
    `${API_URL}/tasks/${taskId}/attachments/${attachmentId}`,

  remove: (id: string) => client.delete(`/tasks/${id}`).then((r) => r.data),
};
