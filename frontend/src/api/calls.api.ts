import client from './client';

/** Направление звонка из приложения CallSync */
export type MobileCallType =
  | 'in' | 'out' | 'out_unanswered' | 'missed' | 'rejected' | 'blocked' | 'voicemail' | 'answered_externally';

export type CallAudioStatus = 'NONE' | 'UPLOADED' | 'TRANSCRIBING' | 'TRANSCRIBED' | 'ANALYZED' | 'FAILED' | 'SKIPPED';

export interface CallListItem {
  id: string;
  provider: 'ASTERISK' | 'MOBILE';
  direction: 'INBOUND' | 'OUTBOUND' | 'INTERNAL';
  status: 'RINGING' | 'ANSWERED' | 'MISSED' | 'FAILED' | 'COMPLETED';
  mobileType: MobileCallType | null;
  startedAt: string;
  durationSec: number | null;
  phone: string | null;
  counterpart: string | null;
  simSlot: number | null;
  hasRecording: boolean;
  audioStatus: CallAudioStatus;
  audioError: string | null;
  auditId: string | null;
  auditScore: number | null;
  calledBackAt: string | null;
  manager: { id: string; fullName: string } | null;
  client: { id: string; companyName: string; contactName: string } | null;
}

export interface CallDetail extends CallListItem {
  transcript: string | null;
  endedAt: string | null;
  tasks: { id: string; title: string; status: string; dueDate: string | null }[];
  clientMatchNote: string | null;
  audit: {
    id: string;
    score: number | null;
    saleProbability: number | null;
    analysis: string;
    mentorTips: string[] | null;
    stageChecklist: Record<string, boolean> | null;
  } | null;
}

export interface CallsPage {
  items: CallListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface CallsFilters {
  from?: string;
  to?: string;
  managerId?: string;
  type?: string;
  missedOnly?: boolean;
  withRecording?: boolean;
  unknownOnly?: boolean;
  clientId?: string;
  phone?: string;
  page?: number;
  pageSize?: number;
}

export interface MissedGroup {
  callId: string;
  managerId: string | null;
  managerName: string | null;
  phone: string | null;
  client: { id: string; companyName: string } | null;
  missedCount: number;
  lastAt: string;
  firstAt: string;
  handled: boolean;
  overdue: boolean;
}

export interface MissedSummary {
  scope: 'own' | 'all';
  items: MissedGroup[];
  pendingCount: number;
  managers?: {
    managerId: string;
    managerName: string;
    missedCount: number;
    pendingCount: number;
    overdueCount: number;
    oldestPendingAt: string | null;
  }[];
}

export interface ClientCallsResponse extends CallsPage {
  stats: { days: number; callsCount: number; missedCount: number; avgDurationSec: number | null };
}

export interface MobileDeviceRow {
  id: string;
  model: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  active: boolean;
  revokedAt: string | null;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  lastCallAt: string | null;
  queueCalls: number;
  queueFiles: number;
  queueBytes: number;
  failedCalls: number;
  simSlot: number | null;
  permissions: Record<string, boolean> | null;
  recordingsDirFound: boolean | null;
  recordingsPathOverride: string | null;
  modelRecordingsPath: string | null;
  effectiveRecordingsPath: string | null;
  uploadLogsRequested: boolean;
  hasLog: boolean;
  lastLogAt: string | null;
  createdAt: string;
  silent: boolean;
  problems: string[];
  problemsText: string | null;
  user: { id: string; fullName: string };
}

export interface MobileSettings {
  workStartHour: number;
  workEndHour: number;
  workDays: number[];
  wifiOnlyAboveMb: number;
  syncIntervalMin: number;
  minAuditDurationSec: number;
  autoAuditEnabled: boolean;
}

export const callsApi = {
  list: (filters: CallsFilters) => client.get<CallsPage>('/calls', { params: filters }).then((r) => r.data),
  get: (id: string) => client.get<CallDetail>(`/calls/${id}`).then((r) => r.data),
  audioUrl: (id: string) => client.get<{ url: string; expiresInSec: number }>(`/calls/${id}/audio-url`).then((r) => r.data),
  linkClient: (id: string, clientId: string, savePhone?: boolean) =>
    client
      .post<{ linkedCount: number; phoneSaved: boolean; suggestSavePhone: boolean; phone: string | null }>(
        `/calls/${id}/link-client`,
        { clientId, savePhone },
      )
      .then((r) => r.data),
  callbackTask: (id: string) =>
    client.post<{ taskId: string; existing: boolean }>(`/calls/${id}/callback-task`, {}).then((r) => r.data),
  calledBack: (id: string) => client.post<{ calls: number; tasks: number }>(`/calls/${id}/called-back`).then((r) => r.data),
  missed: () => client.get<MissedSummary>('/calls/missed').then((r) => r.data),
  forClient: (clientId: string, page = 1, pageSize = 20) =>
    client.get<ClientCallsResponse>(`/clients/${clientId}/calls`, { params: { page, pageSize } }).then((r) => r.data),
};

export const mobileApi = {
  pairingCode: () =>
    client.post<{ code: string; qr: string; server: string; expiresAt: string }>('/mobile/pairing-code').then((r) => r.data),
  devices: () => client.get<{ workingNow: boolean; devices: MobileDeviceRow[] }>('/mobile/devices').then((r) => r.data),
  revoke: (id: string) => client.post(`/mobile/devices/${id}/revoke`).then((r) => r.data),
  requestLogs: (id: string) => client.post(`/mobile/devices/${id}/request-logs`).then((r) => r.data),
  logUrl: (id: string) => client.get<{ url: string }>(`/mobile/devices/${id}/log-url`).then((r) => r.data),
  updateDevice: (id: string, data: { recordingsPathOverride?: string | null; simSlot?: number | null }) =>
    client.put(`/mobile/devices/${id}`, data).then((r) => r.data),
  deviceModels: () =>
    client.get<{ model: string; recordingsPath: string | null; devicesCount: number }[]>('/mobile/device-models').then((r) => r.data),
  setModelPath: (model: string, recordingsPath: string) =>
    client.put('/mobile/device-models', { model, recordingsPath }).then((r) => r.data),
  settings: () => client.get<MobileSettings>('/mobile/settings').then((r) => r.data),
  updateSettings: (data: Partial<MobileSettings>) => client.put<MobileSettings>('/mobile/settings', data).then((r) => r.data),
};
