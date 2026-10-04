import { Tag } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { CallAudioStatus, CallListItem, MobileCallType } from '../../api/calls.api';
import type { Permission, User } from '../../types';

export const CALL_TYPE_LABELS: Record<MobileCallType, string> = {
  in: 'Входящий',
  out: 'Исходящий',
  out_unanswered: 'Исходящий без ответа',
  missed: 'Пропущенный',
  rejected: 'Отклонённый',
  blocked: 'Заблокированный',
  voicemail: 'Голосовая почта',
  answered_externally: 'Принят на другом устройстве',
};

export const CALL_TYPE_OPTIONS = (Object.keys(CALL_TYPE_LABELS) as MobileCallType[]).map((value) => ({
  value,
  label: CALL_TYPE_LABELS[value],
}));

const AUDIO_STATUS: Record<CallAudioStatus, { label: string; color: string }> = {
  NONE: { label: 'Нет записи', color: 'default' },
  UPLOADED: { label: 'В очереди', color: 'blue' },
  TRANSCRIBING: { label: 'Расшифровка', color: 'processing' },
  TRANSCRIBED: { label: 'Расшифрован', color: 'cyan' },
  ANALYZED: { label: 'Проанализирован', color: 'green' },
  FAILED: { label: 'Ошибка', color: 'red' },
  SKIPPED: { label: 'Без анализа', color: 'default' },
};

export function AudioStatusTag({ call }: { call: Pick<CallListItem, 'audioStatus' | 'audioError' | 'auditScore'> }) {
  const s = AUDIO_STATUS[call.audioStatus] ?? AUDIO_STATUS.NONE;
  const label = call.audioStatus === 'ANALYZED' && call.auditScore != null
    ? `Оценка ${call.auditScore}/10`
    : call.audioStatus === 'SKIPPED' && call.audioError === 'Анализ не запускали' ? 'Не анализирован' : s.label;
  return (
    <Tag color={s.color} title={call.audioError ?? undefined} style={{ marginInlineEnd: 0 }}>
      {label}
    </Tag>
  );
}

/** Звонок не состоялся (пропущен, отклонён, недозвон) */
export function isFailedCall(call: Pick<CallListItem, 'status'>): boolean {
  return call.status === 'MISSED' || call.status === 'FAILED';
}

export function callTypeLabel(call: Pick<CallListItem, 'mobileType' | 'direction' | 'status'>): string {
  if (call.mobileType) return CALL_TYPE_LABELS[call.mobileType];
  if (call.status === 'MISSED') return 'Пропущенный';
  return call.direction === 'OUTBOUND' ? 'Исходящий' : 'Входящий';
}

export function CallTypeIcon({ call }: { call: Pick<CallListItem, 'mobileType' | 'direction' | 'status'> }) {
  if (call.mobileType === 'blocked') return <StopOutlined />;
  if (isFailedCall(call)) return <CloseCircleOutlined />;
  return call.direction === 'OUTBOUND' ? <ArrowUpOutlined /> : <ArrowDownOutlined />;
}

/** 184 → «3:04», 3725 → «1:02:05» */
export function formatDuration(sec: number | null | undefined): string {
  if (!sec) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Как на сервере: директор, админы и РОП (use_rop_agent) видят звонки всех менеджеров. */
export function canSeeAllCalls(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || (user.permissions ?? []).includes('use_rop_agent' as Permission);
}

/** Текст ошибки из ответа API */
export function apiErrorMessage(err: unknown, fallback = 'Не получилось'): string {
  const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
  return data?.message || data?.error || fallback;
}
