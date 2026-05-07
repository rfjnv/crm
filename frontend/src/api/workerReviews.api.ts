import client from './client';
import type { WorkerReview, WorkerSummary, WorkerAnalytics } from '../types';

export interface CreateWorkerReviewPayload {
  managerId: string;
  rating: number;
  comment?: string;
  period: string; // YYYY-MM
}

export interface UpdateWorkerReviewPayload {
  rating?: number;
  comment?: string;
}

export const workerReviewsApi = {
  getAnalytics: async (): Promise<WorkerAnalytics> => {
    const { data } = await client.get<WorkerAnalytics>('/worker-reviews/analytics');
    return data;
  },

  getSummaries: async (): Promise<WorkerSummary[]> => {
    const { data } = await client.get<WorkerSummary[]>('/worker-reviews/summaries');
    return data;
  },

  getReviews: async (managerId?: string, period?: string): Promise<WorkerReview[]> => {
    const { data } = await client.get<WorkerReview[]>('/worker-reviews', {
      params: { managerId, period },
    });
    return data;
  },

  create: async (payload: CreateWorkerReviewPayload): Promise<WorkerReview> => {
    const { data } = await client.post<WorkerReview>('/worker-reviews', payload);
    return data;
  },

  update: async (id: string, payload: UpdateWorkerReviewPayload): Promise<WorkerReview> => {
    const { data } = await client.patch<WorkerReview>(`/worker-reviews/${id}`, payload);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/worker-reviews/${id}`);
  },
};
