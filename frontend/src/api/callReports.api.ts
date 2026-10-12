import client from './client';

export interface CallTotals {
  total: number;
  outbound: number;
  outboundConnected: number;
  inbound: number;
  inboundAnswered: number;
  missed: number;
  missedNotCalledBack: number;
  conversations: number;
  talkSec: number;
  uniqueNumbers: number;
}

export interface EmployeeCalls extends CallTotals {
  userId: string;
  fullName: string;
  role: string;
  avgTalkSec: number;
  clientCalls: number;
  avgFirstCallMin: number | null;
  activeDays: number;
  prevTotal: number;
}

export interface CallReport {
  period: { from: string; to: string };
  totals: CallTotals;
  prevTotals: CallTotals;
  employees: EmployeeCalls[];
  byHour: { hour: number; outbound: number; inbound: number }[];
  byDay: { day: string; outbound: number; inbound: number; talkSec: number }[];
}

export const callReportsApi = {
  get: (params: { from: string; to: string; userId?: string }) =>
    client.get<CallReport>('/call-reports', { params }).then((r) => r.data),
};
