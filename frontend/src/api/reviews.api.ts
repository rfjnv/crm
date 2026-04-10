import client from './client';

export interface ReviewDealRef {
  id: string;
  title: string;
  client: {
    id: string;
    companyName: string;
    contactName: string;
    phone: string;
    isSvip?: boolean;
  };
  manager: {
    id: string;
    fullName: string;
  };
}

export type ReviewChannel = 'telegram' | 'delivery';

export interface ReviewRow {
  id: string;
  createdAt: string;
  rating: number;
  text: string;
  deal: ReviewDealRef;
  channel: ReviewChannel;
  channelLabel: string;
}

export interface ReviewsBundle {
  telegram: ReviewRow[];
  delivery: ReviewRow[];
}

export const reviewsApi = {
  getReviews: async () => {
    const { data } = await client.get<ReviewsBundle>('/api/reviews');
    return data;
  },
};
