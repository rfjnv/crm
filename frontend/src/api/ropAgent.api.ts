import client from './client';

export interface RopAgentChat {
  id: string;
  title: string;
  /** web — страница CRM, telegram — разговор в личке с ботом. */
  channel?: 'web' | 'telegram';
  createdAt: string;
  updatedAt: string;
}

export interface RopAgentToolCall {
  name: string;
  label: string;
  isError: boolean;
  /** Черновик плана задач, который агент сохранил этим вызовом. */
  planId?: string;
}

export type RopPlanStatus = 'DRAFT' | 'ASSIGNED' | 'DISCARDED';

export interface RopPlanClient {
  clientId: string;
  name: string;
  phone: string | null;
  reason: string;
  offer: string;
  taskId?: string;
}

export interface RopPlanItem {
  key: string;
  managerId: string;
  managerName: string;
  title: string;
  description: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  clients: RopPlanClient[];
  taskIds?: string[];
}

export interface RopTaskPlan {
  id: string;
  chatId: string;
  title: string;
  goal: string | null;
  status: RopPlanStatus;
  items: RopPlanItem[];
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RopClientProgress {
  clientId: string;
  name: string;
  taskId: string | null;
  checked: boolean | null;
  calls: number;
  answeredCalls: number;
  talkSec: number;
  notes: number;
  lastNote: string | null;
  otherContacts: number;
  lastContactAt: string | null;
  dealsCreated: number;
  revenue: number;
  touched: boolean;
  attempted: boolean;
  checkedWithoutTrace: boolean;
}

export type RopVerdict = 'ok' | 'in_progress' | 'behind' | 'no_touch';

export interface RopProgressSummary {
  clients: number;
  touched: number;
  attempted: number;
  checked: number;
  withDeal: number;
  revenue: number;
  checkedWithoutTrace: number;
}

export interface RopItemProgress {
  key: string;
  managerId: string;
  managerName: string;
  title: string;
  dueDate: string | null;
  overdue: boolean;
  taskStatuses: string[];
  reports: string[];
  clients: RopClientProgress[];
  summary: RopProgressSummary;
  verdict: RopVerdict;
}

export interface RopPlanProgress {
  planId: string;
  title: string;
  assignedAt: string;
  daysSinceAssigned: number;
  items: RopItemProgress[];
  totals: RopProgressSummary;
}

export interface RopDigestData {
  date: string;
  revenue: {
    day: number;
    prevDay: number;
    sameWeekdayLastWeek: number;
    mtd: number;
    prevMtd: number;
    daily: { day: string; revenue: number }[];
  };
  deals: { closedDay: number; newDay: number; pipeline: { status: string; count: number; amount: number }[] };
  managers: { id: string; name: string; revenueDay: number; revenueMtd: number; dealsMtd: number }[];
  debts: {
    total: number;
    overdue: number;
    overdueDeals: number;
    topDebtors: { clientId: string; client: string; manager: string | null; debt: number; overdueDebt: number; maxOverdueDays: number }[];
  };
  clients: {
    dueSoon: number;
    overdue: number;
    topOverdue: { clientId: string; client: string; manager: string; revenue12m: number; daysSince: number; cycleDays: number }[];
  };
  slowStock: { frozen: number; count: number; top: { productId: string; product: string; frozen: number; daysSinceSale: number | null }[] };
  plans: { planId: string; title: string; manager: string; verdict: RopVerdict; touched: number; clients: number; overdue: boolean }[];
}

export interface RopDigest {
  id: string;
  date: string;
  data: RopDigestData;
  commentary: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RopManager {
  id: string;
  name: string;
  role: string;
  clients: number;
}

export interface RopAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls: RopAgentToolCall[] | null;
  isError: boolean;
  createdAt: string;
}

export interface RopAgentTurnStatus {
  running: boolean;
  startedAt?: string;
  /** Что агент уже посмотрел за этот ответ. */
  steps: string[];
}

export const ropAgentApi = {
  listChats: () => client.get<RopAgentChat[]>('/rop-agent/chats').then((r) => r.data),
  createChat: () => client.post<RopAgentChat>('/rop-agent/chats').then((r) => r.data),
  getMessages: (chatId: string) =>
    client
      .get<{ messages: RopAgentMessage[]; status: RopAgentTurnStatus }>(`/rop-agent/chats/${chatId}/messages`)
      .then((r) => r.data),
  ask: (chatId: string, question: string) =>
    client.post<RopAgentMessage>(`/rop-agent/chats/${chatId}/ask`, { question }).then((r) => r.data),
  renameChat: (chatId: string, title: string) =>
    client.patch<RopAgentChat>(`/rop-agent/chats/${chatId}`, { title }).then((r) => r.data),
  deleteChat: (chatId: string) => client.delete(`/rop-agent/chats/${chatId}`),

  listPlans: (chatId: string) => client.get<RopTaskPlan[]>(`/rop-agent/chats/${chatId}/plans`).then((r) => r.data),
  updatePlan: (planId: string, data: { title?: string; items: RopPlanItem[] }) =>
    client
      .put<{ plan: RopTaskPlan; warnings: string[] }>(`/rop-agent/plans/${planId}`, {
        title: data.title,
        items: data.items.map((i) => ({
          key: i.key,
          managerId: i.managerId,
          title: i.title,
          description: i.description,
          dueDate: i.dueDate,
          clients: i.clients.map((c) => ({ clientId: c.clientId, reason: c.reason, offer: c.offer })),
        })),
      })
      .then((r) => r.data),
  assignPlan: (planId: string) =>
    client
      .post<{ plan: RopTaskPlan; createdTasks: number; warnings: string[] }>(`/rop-agent/plans/${planId}/assign`)
      .then((r) => r.data),
  planProgress: (planId: string) =>
    client.get<RopPlanProgress>(`/rop-agent/plans/${planId}/progress`).then((r) => r.data),
  discardPlan: (planId: string) => client.post<RopTaskPlan>(`/rop-agent/plans/${planId}/discard`).then((r) => r.data),
  listManagers: () => client.get<RopManager[]>('/rop-agent/managers').then((r) => r.data),

  listDigests: () =>
    client
      .get<{ latestDate: string; digests: { date: string; createdAt: string; sentAt: string | null }[] }>('/rop-agent/digests')
      .then((r) => r.data),
  getDigest: (date: string) => client.get<RopDigest>(`/rop-agent/digests/${date}`).then((r) => r.data),
  buildDigest: (date: string) => client.post<RopDigest>(`/rop-agent/digests/${date}/build`).then((r) => r.data),
  sendDigestToMe: (date: string) => client.post(`/rop-agent/digests/${date}/send-me`).then((r) => r.data),
};
