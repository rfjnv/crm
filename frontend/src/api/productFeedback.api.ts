import client from './client';

export interface FeedbackProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  category: string | null;
  format: string | null;
  lastArrivalAt: string | null;
}

export interface ProductArrival {
  id: string;
  createdAt: string;
  quantity: number;
  note: string | null;
}

export type LastContactSource = 'notes' | 'call' | 'client_note' | 'feedback';

export interface LastContact {
  source: LastContactSource;
  at: string;
  userId: string | null;
  userName: string | null;
  text: string | null;
}

export interface ProductFeedbackEntry {
  id: string;
  clientId: string;
  reached: boolean;
  rating: number | null;
  comment: string | null;
  createdAt: string;
  author: { id: string; fullName: string };
}

export interface FeedbackClientRow {
  clientId: string;
  companyName: string;
  contactName: string;
  phone: string | null;
  isSvip: boolean;
  clientManager: { id: string; fullName: string };
  qty: number;
  deals: { id: string; title: string; at: string; managerName: string }[];
  lastPurchaseAt: string;
  lastContact: LastContact | null;
  feedback: ProductFeedbackEntry[];
}

export const productFeedbackApi = {
  products: () => client.get<FeedbackProduct[]>('/product-feedback/products').then((r) => r.data),
  arrivals: (productId: string) =>
    client.get<ProductArrival[]>(`/product-feedback/arrivals/${productId}`).then((r) => r.data),
  clients: (productId: string, from: string) =>
    client.get<FeedbackClientRow[]>('/product-feedback/clients', { params: { productId, from } }).then((r) => r.data),
  create: (data: {
    productId: string;
    clientId: string;
    reached: boolean;
    rating?: number | null;
    comment?: string | null;
    arrivalAt?: string | null;
  }) => client.post<ProductFeedbackEntry>('/product-feedback', data).then((r) => r.data),
};
