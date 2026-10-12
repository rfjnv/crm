import client from './client';
import type { AttendanceRecord } from '../types';

export const attendanceApi = {
  list: (params?: { userId?: string; from?: string; to?: string }) =>
    client.get<{ records: AttendanceRecord[] }>('/attendance', { params }).then((r) => r.data.records),
  upsert: (data: { userId: string; date: string; checkIn?: string | null; checkOut?: string | null; note?: string | null }) =>
    client.post<AttendanceRecord>('/attendance', data).then((r) => r.data),
  /** Плашки и комментарий HR за день; null — запись пустая и удалена. */
  mark: (data: { userId: string; date: string; marks: string[]; note?: string | null }) =>
    client.put<{ record: AttendanceRecord | null }>('/attendance/mark', data).then((r) => r.data.record),
  remove: (id: string) => client.delete(`/attendance/${id}`).then((r) => r.data),
};
