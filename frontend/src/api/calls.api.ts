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

export type CallReportStatus = 'WAITING' | 'RUNNING' | 'DONE' | 'FAILED';

export interface CallReportRow {
  id: string;
  title: string;
  status: CallReportStatus;
  error: string | null;
  callsCount: number;
  createdAt: string;
  finishedAt: string | null;
  createdBy: { fullName: string };
}

export interface CallReportDetail extends Omit<CallReportRow, 'callsCount'> {
  result: string | null;
  callIds: string[];
  calls: {
    id: string;
    number: number;
    startedAt: string;
    durationSec: number | null;
    mobileType: MobileCallType | null;
    audioStatus: CallAudioStatus;
    deletedAt: string | null;
    hasTranscript: boolean;
    phone: string | null;
    manager: { fullName: string } | null;
    client: { companyName: string } | null;
  }[];
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
  recordingsBufferDays: number;
  driveRetentionMonths: number;
}

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  redirectUri: string;
  folderName: string;
  archivedCount: number;
  pendingCount: number;
  failedCount: number;
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
  analyze: (callIds: string[]) =>
    client.post<{ queued: number; alreadyDone: number; noRecording: number; inProgress: number }>('/calls/analyze', { callIds }).then((r) => r.data),
  reassign: (callIds: string[], managerId: string) =>
    client.post<{ updated: number; managerName: string }>('/calls/reassign', { callIds, managerId }).then((r) => r.data),
  remove: (callIds: string[]) => client.post<{ deleted: number }>('/calls/delete', { callIds }).then((r) => r.data),
  createReport: (callIds: string[], title?: string) =>
    client.post<{ id: string; title: string }>('/calls/reports', { callIds, title }).then((r) => r.data),
  reports: () => client.get<CallReportRow[]>('/calls/reports').then((r) => r.data),
  report: (id: string) => client.get<CallReportDetail>(`/calls/reports/${id}`).then((r) => r.data),
  removeReport: (id: string) => client.delete(`/calls/reports/${id}`).then((r) => r.data),
  forClient: (clientId: string, page = 1, pageSize = 20) =>
    client.get<ClientCallsResponse>(`/clients/${clientId}/calls`, { params: { page, pageSize } }).then((r) => r.data),
};

export const mobileApi = {
  /** QR привязки для сотрудника — создаёт руководство */
  pairingCode: (userId: string) =>
    client
      .post<{ code: string; qr: string; server: string; expiresAt: string; employee: { id: string; name: string } }>('/mobile/pairing-code', { userId })
      .then((r) => r.data),
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
  drive: () => client.get<DriveStatus>('/mobile/drive').then((r) => r.data),
  driveAuthUrl: () => client.get<{ url: string }>('/mobile/drive/auth-url').then((r) => r.data),
  driveDisconnect: () => client.post('/mobile/drive/disconnect').then((r) => r.data),
  driveSync: () => client.post('/mobile/drive/sync').then((r) => r.data),
  updateSettings: (data: Partial<MobileSettings>) => client.put<MobileSettings>('/mobile/settings', data).then((r) => r.data),
};
