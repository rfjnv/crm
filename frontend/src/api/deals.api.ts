import client from './client';
import { downloadBlob, getFilenameFromDisposition } from '../utils/download';
import type {
  Deal,
  DealItem,
  DealComment,
  AuditLog,
  DealStatus,
  DealHistoryEntry,
  Shipment,
  PaymentRecord,
  PaymentMethod,
  PaymentStatus,
} from '../types';

export const dealsApi = {
  list: (
    status?: DealStatus,
    includeClosed?: boolean,
    filters?: {
      paymentStatus?: PaymentStatus;
      managerId?: string;
      closedFrom?: string;
      closedTo?: string;
    },
  ) =>
    client
      .get<Deal[]>('/deals', {
        params: {
          ...(status ? { status } : {}),
          ...(includeClosed ? { includeClosed: 'true' } : {}),
          ...(filters?.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
          ...(filters?.managerId ? { managerId: filters.managerId } : {}),
          ...(filters?.closedFrom ? { closedFrom: filters.closedFrom } : {}),
          ...(filters?.closedTo ? { closedTo: filters.closedTo } : {}),
        },
      })
      .then((r) => r.data),

  getById: (id: string) => client.get<Deal>(`/deals/${id}`).then((r) => r.data),

  create: (data: {
    title?: string;
    clientId: string;
    comment?: string;
    deliveryType?: 'SELF_PICKUP' | 'YANDEX' | 'DELIVERY';
    vehicleNumber?: string;
    vehicleType?: string;
    deliveryComment?: string;
    paymentMethod?: PaymentMethod;
    paymentNote?: string;
    cashNote?: string;
    clickTransactionId?: string;
    transferInn?: string;
    transferDocuments?: string[];
    transferType?: 'ONE_TIME' | 'ANNUAL';
    /** Только Dilnoza: AUTO | STOCK_CONFIRMATION | WAREHOUSE_MANAGER | FINANCE */
    createRoute?: 'AUTO' | 'STOCK_CONFIRMATION' | 'WAREHOUSE_MANAGER' | 'FINANCE';
    items: { productId: string; requestedQty?: number; price?: number; requestComment?: string }[];
  }) =>
    client.post<Deal>('/deals', data).then((r) => r.data),

  update: (id: string, data: Partial<{ title: string; status: DealStatus; contractId: string | null; discount: number; terms: string | null; managerId: string }>) =>
    client.patch<Deal>(`/deals/${id}`, data).then((r) => r.data),

  updatePayment: (id: string, data: { paidAmount: number; paymentType?: 'FULL' | 'PARTIAL' | 'INSTALLMENT'; dueDate?: string | null; terms?: string | null }) =>
    client.patch<Deal>(`/deals/${id}/payment`, data).then((r) => r.data),

  archive: (id: string) => client.patch<Deal>(`/deals/${id}/archive`).then((r) => r.data),

  unarchive: (id: string) => client.patch<Deal>(`/deals/${id}/unarchive`).then((r) => r.data),

  listArchived: () => client.get<Deal[]>('/deals/archived').then((r) => r.data),

  getLogs: (id: string) => client.get<AuditLog[]>(`/deals/${id}/logs`).then((r) => r.data),

  getComments: (id: string) =>
    client.get<DealComment[]>(`/deals/${id}/comments`).then((r) => r.data),

  addComment: (id: string, text: string) =>
    client.post<DealComment>(`/deals/${id}/comments`, { text }).then((r) => r.data),

  // Deal Items
  getItems: (dealId: string) =>
    client.get<DealItem[]>(`/deals/${dealId}/items`).then((r) => r.data),

  addItem: (dealId: string, data: { productId: string; requestedQty: number; price: number; requestComment?: string }) =>
    client.post<DealItem>(`/deals/${dealId}/items`, data).then((r) => r.data),

  removeItem: (dealId: string, itemId: string) =>
    client.delete(`/deals/${dealId}/items/${itemId}`).then((r) => r.data),

  getHistory: (id: string) =>
    client.get<DealHistoryEntry[]>(`/deals/${id}/history`).then((r) => r.data),

  // Workflow: Warehouse Response (количество + комментарий; цена опционально — иначе salePrice товара)
  submitWarehouseResponse: (dealId: string, items: {
    dealItemId: string;
    warehouseComment: string;
    requestedQty: number;
    price?: number;
  }[]) =>
    client.post<Deal>(`/deals/${dealId}/stock-confirm`, { items }).then((r) => r.data),

  // Workflow: Set Item Quantities (manager fills after warehouse response)
  setItemQuantities: (dealId: string, data: {
    items: { dealItemId: string; requestedQty: number; price: number }[];
    discount?: number;
    paymentType?: 'FULL' | 'PARTIAL' | 'INSTALLMENT';
    paidAmount?: number;
    dueDate?: string;
    terms?: string;
  }) =>
    client.post<Deal>(`/deals/${dealId}/set-quantities`, data).then((r) => r.data),

  stockConfirmationQueue: () =>
    client.get<Deal[]>('/deals/stock-confirmation-queue').then((r) => r.data),

  // Workflow: Send to Finance (Manager selects payment method)
  sendToFinance: (dealId: string, data: {
    paymentMethod: PaymentMethod;
    transferInn?: string;
    transferDocuments?: string[];
    transferType?: 'ONE_TIME' | 'ANNUAL';
  }) =>
    client.post<Deal>(`/deals/${dealId}/send-to-finance`, data).then((r) => r.data),

  // Workflow: Finance
  approveFinance: (dealId: string) =>
    client.post<Deal>(`/deals/${dealId}/finance-approve`).then((r) => r.data),

  rejectFinance: (dealId: string, reason: string) =>
    client.post<Deal>(`/deals/${dealId}/finance-reject`, { reason }).then((r) => r.data),

  // Workflow: Admin Approve
  approveAdmin: (dealId: string) =>
    client.post<Deal>(`/deals/${dealId}/admin-approve`).then((r) => r.data),

  // Workflow: Shipment
  submitShipment: (dealId: string, data: {
    vehicleType: string;
    vehicleNumber: string;
    driverName: string;
    departureTime: string;
    deliveryNoteNumber: string;
    shipmentComment?: string;
  }) =>
    client.post<Deal>(`/deals/${dealId}/shipment`, data).then((r) => r.data),

  getShipment: (dealId: string) =>
    client.get<Shipment>(`/deals/${dealId}/shipment`).then((r) => r.data),

  // Payment Records
  createPayment: (dealId: string, data: { amount: number; method?: string; note?: string; paidAt?: string }) =>
    client.post<PaymentRecord>(`/deals/${dealId}/payments`, data).then((r) => r.data),

  updatePayment_record: (dealId: string, paymentId: string, data: { amount?: number; method?: string | null; note?: string | null; paidAt?: string }) =>
    client.patch<PaymentRecord>(`/deals/${dealId}/payments/${paymentId}`, data).then((r) => r.data),

  deletePayment_record: (dealId: string, paymentId: string) =>
    client.delete(`/deals/${dealId}/payments/${paymentId}`).then((r) => r.data),

  getDealPayments: (dealId: string) =>
    client.get<PaymentRecord[]>(`/deals/${dealId}/payments`).then((r) => r.data),

  // Workflow Queues
  financeQueue: () =>
    client.get<(Deal & { clientDebt: number })[]>('/deals/finance-queue').then((r) => r.data),

  shipmentQueue: () =>
    client.get<Deal[]>('/deals/shipment-queue').then((r) => r.data),

  closedDeals: (
    page = 1,
    limit = 50,
    opts?: {
      todayOnly?: boolean;
      paymentStatus?: PaymentStatus;
      managerId?: string;
      closedFrom?: string;
      closedTo?: string;
      q?: string;
    },
  ) =>
    client
      .get<{ data: Deal[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
        '/deals/closed-deals',
        {
          params: {
            page,
            limit,
            ...(opts?.todayOnly ? { today: '1' } : {}),
            ...(opts?.paymentStatus ? { paymentStatus: opts.paymentStatus } : {}),
            ...(opts?.managerId ? { managerId: opts.managerId } : {}),
            ...(opts?.closedFrom ? { closedFrom: opts.closedFrom } : {}),
            ...(opts?.closedTo ? { closedTo: opts.closedTo } : {}),
            ...(opts?.q ? { q: opts.q } : {}),
          },
        },
      )
      .then((r) => r.data),

  getShipments: (page = 1, limit = 50, opts?: { todayOnly?: boolean }) =>
    client
      .get<{ data: Deal[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
        '/deals/shipments',
        { params: { page, limit, ...(opts?.todayOnly ? { today: '1' } : {}) } },
      )
      .then((r) => r.data),

  // Debug endpoint to see all deals
  getAllDealsDebug: (page = 1, limit = 50) =>
    client.get<{ data: Deal[]; pagination: { page: number; limit: number; total: number; pages: number }; debug: any }>(`/deals/all-deals-debug?page=${page}&limit=${limit}`).then((r) => r.data),

  dealApprovalQueue: () =>
    client.get<Deal[]>('/deals/deal-approval-queue').then((r) => r.data),

  approveDeal: (dealId: string) =>
    client.post<Deal>(`/deals/${dealId}/deal-approve`).then((r) => r.data),

  rejectDeal: (dealId: string, reason: string) =>
    client.post<Deal>(`/deals/${dealId}/deal-reject`, { reason }).then((r) => r.data),

  holdShipment: (dealId: string, reason: string) =>
    client.post<Deal>(`/deals/${dealId}/shipment-hold`, { reason }).then((r) => r.data),

  releaseShipmentHold: (dealId: string) =>
    client.post<Deal>(`/deals/${dealId}/shipment-release`).then((r) => r.data),

  // ── New workflow: Warehouse Manager / Loading / Delivery ──
  wmIncoming: () => client.get<Deal[]>('/deals/wm/incoming').then((r) => r.data),
  wmApproved: () => client.get<Deal[]>('/deals/wm/approved').then((r) => r.data),
  wmDelivery: () => client.get<Deal[]>('/deals/wm/delivery').then((r) => r.data),
  wmPendingAdmin: () => client.get<Deal[]>('/deals/wm/pending-admin').then((r) => r.data),
  loadingStaff: () => client.get<{ id: string; fullName: string; role: string }[]>('/deals/loading-staff').then((r) => r.data),
  driversList: () => client.get<{ id: string; fullName: string }[]>('/deals/drivers-list').then((r) => r.data),
  myLoadingTasks: () => client.get<Deal[]>('/deals/my-loading-tasks').then((r) => r.data),
  myVehicle: () => client.get<Deal[]>('/deals/my-vehicle').then((r) => r.data),

  wmConfirm: (dealId: string) => client.post(`/deals/${dealId}/wm-confirm`).then((r) => r.data),
  adminApproveNew: (dealId: string) => client.post(`/deals/${dealId}/admin-approve-new`).then((r) => r.data),
  adminRejectNew: (dealId: string, reason: string) => client.post(`/deals/${dealId}/admin-reject-new`, { reason }).then((r) => r.data),
  assignLoading: (dealId: string, assigneeId: string) => client.post(`/deals/${dealId}/assign-loading`, { assigneeId }).then((r) => r.data),
  markLoaded: (dealId: string) => client.post(`/deals/${dealId}/mark-loaded`).then((r) => r.data),
  assignDriver: (dealId: string, driverId: string) => client.post(`/deals/${dealId}/assign-driver`, { driverId }).then((r) => r.data),
  startDelivery: (dealIds: string[]) => client.post('/deals/start-delivery', { dealIds }).then((r) => r.data),
  deliverDeal: (dealId: string) => client.post(`/deals/${dealId}/deliver`).then((r) => r.data),

  downloadPaymentReceipt: (dealId: string) =>
    client.get(`/deals/${dealId}/payment-receipt`, {
      params: { ts: Date.now() },
      headers: { Accept: 'application/pdf' },
      responseType: 'blob',
    }).then((r) => {
      const filename = getFilenameFromDisposition(
        r.headers['content-disposition'],
        `receipt-${dealId}.pdf`,
      );
      downloadBlob(r.data, filename);
    }),
};
