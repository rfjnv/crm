import client from './client';
import type { DailyReport, MonthlyGoalProgress, ProfileSession, User, UserMedalHistoryEntry } from '../types';

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  login?: string;
  currentPassword?: string;
  newPassword?: string;
}

export const profileApi = {
  updateProfile: (data: UpdateProfilePayload) =>
    client.patch<User>('/profile', data).then((r) => r.data),

  sessions: () => client.get<ProfileSession[]>('/profile/sessions').then((r) => r.data),

  revokeSession: (sessionId: string) =>
    client.delete<{ success: boolean }>(`/profile/sessions/${sessionId}`).then((r) => r.data),

  dailyReport: (from: string, to: string) =>
    client.get<DailyReport>('/profile/daily-report', { params: { from, to } }).then((r) => r.data),

  medalHistory: () => client.get<UserMedalHistoryEntry[]>('/profile/medal-history').then((r) => r.data),

  monthlyGoal: (opts?: { year?: number; month?: number }) =>
    client
      .get<MonthlyGoalProgress>('/profile/monthly-goal', {
        params: opts?.year || opts?.month ? opts : undefined,
      })
      .then((r) => r.data),
};
