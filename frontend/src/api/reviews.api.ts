import { api } from './api';

export interface TelegramReview {
  id: string;
  createdAt: string;
  rating: number;
  text: string;
  deal: {
    id: string;
    title: string;
    client: {
      id: string;
      contactName: string;
      phone: string;
    };
    manager: {
      id: string;
      fullName: string;
    };
  };
}

export const reviewsApi = {
  getReviews: async () => {
    const { data } = await api.get<TelegramReview[]>('/api/reviews');
    return data;
  },
};
