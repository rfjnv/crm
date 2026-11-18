import client from './client';

export type ClientRequestKind = 'PRODUCT' | 'OTHER';
export type ClientRequestStatus = 'NEW' | 'IN_PROGRESS' | 'DONE' | 'REJECTED';

export interface ClientRequest {
  id: string;
  clientId: string;
  kind: ClientRequestKind;
  productId: string | null;
  productName: string | null;
  quantity: number | null;
  unit: string | null;
  description: string | null;
  status: ClientRequestStatus;
  resolution: string | null;
  dueDate: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    companyName: string;
    contactName: string;
    phone: string | null;
    manager: { id: string; fullName: string };
  };
  product: { id: string; name: string; sku: string; unit: string; stock: number } | null;
  author: { id: string; fullName: string };
  closedBy: { id: string; fullName: string } | null;
}

export interface ClientRequestsSummary {
  counts: Partial<Record<ClientRequestStatus, number>>;
  topProducts: {
    key: string;
    productId: string | null;
    name: string;
    unit: string | null;
    stock: number | null;
    requests: number;
    clients: number;
    quantity: number;
  }[];
}

export interface ClientRequestInput {
  clientId: string;
  kind: ClientRequestKind;
  productId?: string | null;
  productName?: string | null;
  quantity?: number | null;
  unit?: string | null;
  description?: string | null;
  dueDate?: string | null;
  status?: ClientRequestStatus;
  resolution?: string | null;
}

export interface ClientOption {
  id: string;
  companyName: string;
  contactName: string;
  manager: { fullName: string };
}

export interface ProductOption {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stock: number;
}

export const clientRequestsApi = {
  list: (params: { status?: ClientRequestStatus | 'OPEN'; kind?: ClientRequestKind }) =>
    client.get<ClientRequest[]>('/client-requests', { params }).then((r) => r.data),
  summary: () => client.get<ClientRequestsSummary>('/client-requests/summary').then((r) => r.data),
  clients: (q: string) => client.get<ClientOption[]>('/client-requests/clients', { params: { q } }).then((r) => r.data),
  products: () => client.get<ProductOption[]>('/client-requests/products').then((r) => r.data),
  create: (data: ClientRequestInput) => client.post<ClientRequest>('/client-requests', data).then((r) => r.data),
  update: (id: string, data: Partial<ClientRequestInput>) =>
    client.patch<ClientRequest>(`/client-requests/${id}`, data).then((r) => r.data),
  remove: (id: string) => client.delete(`/client-requests/${id}`).then((r) => r.data),
};
