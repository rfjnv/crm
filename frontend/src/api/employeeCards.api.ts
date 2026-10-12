import client from './client';
import type { EmployeeCardDetail, EmployeeCardRow, EmployeeReview } from '../types';

export interface EmployeeReviewInput {
  year: number;
  month: number;
  discipline?: number | null;
  quality?: number | null;
  initiative?: number | null;
  teamwork?: number | null;
  praise?: string | null;
  remarks?: string | null;
  improve?: string | null;
}

export const employeeCardsApi = {
  list: (year: number, month: number) =>
    client
      .get<{ year: number; month: number; rows: EmployeeCardRow[] }>('/employee-cards', { params: { year, month } })
      .then((r) => r.data.rows),
  get: (userId: string, year: number, month: number) =>
    client.get<EmployeeCardDetail>(`/employee-cards/${userId}`, { params: { year, month } }).then((r) => r.data),
  saveReview: (userId: string, data: EmployeeReviewInput) =>
    client.put<EmployeeReview>(`/employee-cards/${userId}/review`, data).then((r) => r.data),
};
