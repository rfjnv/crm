import { useMemo } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, Checkbox, DatePicker, Descriptions, Drawer, Empty, List, Pagination, Popconfirm, Select, Space, Spin,
  Table, Tag, Typography, message, theme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Navigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { hrCallsApi, type CallListItem, type CallsFilters } from '../api/calls.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatUzPhone } from '../utils/phone';
import CallAudioPlayer from '../components/calls/CallAudioPlayer';
import HrCallsSummary from '../components/calls/HrCallsSummary';
import {
  CALL_TYPE_OPTIONS, CallTypeIcon, FollowUpTag, apiErrorMessage, callTypeLabel, canSeeAllHrCalls, canUseHrCalls, formatDuration, isFailedCall,
} from '../components/calls/callsUi';

/** Статус задачи «перезвонить» по звонку */
function CallbackTag({ call }: { call: Pick<CallListItem, 'callbackTask'> }) {
  const t = call.callbackTask;
  if (!t) return <Typography.Text type="secondary">—</Typography.Text>;
  const done = t.status === 'DONE' || t.status === 'APPROVED';
  return <Tag color={done ? 'green' : 'orange'} style={{ marginInlineEnd: 0 }}>{done ? 'Перезвонила' : 'Перезвонить'}</Tag>;
}

/**
 * «Звонки HR» — телефон HR (кандидаты, сотрудники). Отдельный поток: в журнал продаж, KPI,
 * аналитику и РОП-агента не попадает. Без клиентов, привязок и аудита — промпт аудита под продажи.
 */
export default function HrCallsPage() {
  const user = useAuthStore((s) => s.user);
  if (!canUseHrCalls(user)) return <Navigate to="/" replace />;
  return <HrCallsContent />;
}

function HrCallsContent() {
  const user = useAuthStore((s) => s.user);
  const seeAll = canSeeAllHrCalls(user);
  const isMobile = useIsMobile();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const filters: CallsFilters = useMemo(() => ({
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    type: params.get('type') ?? undefined,
    missedOnly: params.get('missedOnly') === '1' || undefined,
    withRecording: params.get('withRecording') === '1' || undefined,
    page: Number(params.get('page')) || 1,
    pageSize: Number(params.get('pageSize')) || 30,
  }), [params]);

  const patch = (next: Record<string, string | undefined>, keepPage = false) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      if (!keepPage) p.delete('page');
      return p;
    }, { replace: true });
  };

  const { data, isFetching } = useQuery({
    queryKey: ['hr-calls', filters],
    queryFn: () => hrCallsApi.list(filters),
    placeholderData: keepPreviousData,
  });
  const openId = params.get('call');
  const full = isMobile ? { flex: '1 1 100%', minWidth: 0 } : undefined;

  const flag = (key: string, label: string) => (
    <Checkbox checked={params.get(key) === '1'} onChange={(e) => patch({ [key]: e.target.checked ? '1' : undefined })}>{label}</Checkbox>
  );
  const typeCell = (c: CallListItem) => (
    <Space direction="vertical" size={4}>
      <Space size={6} style={{ color: isFailedCall(c) ? token.colorError : undefined }}>
        <CallTypeIcon call={c} />
        <span>{callTypeLabel(c)}</span>
      </Space>
      <FollowUpTag call={c} />
    </Space>
  );
  const player = (c: CallListItem, block?: boolean) => (c.hasRecording
    ? <CallAudioPlayer callId={c.id} block={block} getUrl={hrCallsApi.audioUrl} />
    : <Typography.Text type="secondary">—</Typography.Text>);
  const open = (c: CallListItem) => patch({ call: c.id }, true);

  const columns: ColumnsType<CallListItem> = [
    { title: 'Время', dataIndex: 'startedAt', width: 120, render: (v: string) => dayjs(v).format('DD.MM.YY HH:mm') },
    ...(seeAll ? [{ title: 'Сотрудник', key: 'manager', render: (_: unknown, c: CallListItem) => c.manager?.fullName ?? '—' }] : []),
    { title: 'Номер', key: 'phone', width: 170, render: (_, c) => formatUzPhone(c.counterpart) || 'скрыт' },
    { title: 'Направление', key: 'type', render: (_, c) => typeCell(c) },
    { title: 'Длит.', dataIndex: 'durationSec', width: 70, render: (v: number | null) => formatDuration(v) },
    { title: 'Запись', key: 'rec', render: (_, c) => player(c) },
    { title: 'Перезвонить', key: 'task', width: 130, render: (_, c) => <CallbackTag call={c} /> },
  ];

  const items = data?.items ?? [];
  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>Звонки HR</Typography.Title>
      <Typography.Paragraph type="secondary">Звонки HR не попадают в продажи, KPI и аналитику.</Typography.Paragraph>

      <HrCallsSummary from={filters.from} to={filters.to} seeAll={seeAll} onShowMissed={() => patch({ missedOnly: '1' })} />

      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <DatePicker.RangePicker
            style={full}
            format="DD.MM.YYYY"
            value={filters.from || filters.to ? [filters.from ? dayjs(filters.from) : null, filters.to ? dayjs(filters.to) : null] : null}
            onChange={(v) => patch({ from: v?.[0]?.format('YYYY-MM-DD'), to: v?.[1]?.format('YYYY-MM-DD') })}
          />
          <Select
            allowClear
            mode="multiple"
            placeholder="Направление"
            style={{ ...full, width: isMobile ? undefined : 260 }}
            value={filters.type ? filters.type.split(',') : []}
            onChange={(v: string[]) => patch({ type: v.length ? v.join(',') : undefined })}
            options={CALL_TYPE_OPTIONS}
            maxTagCount="responsive"
          />
          {flag('missedOnly', 'Только пропущенные')}
          {flag('withRecording', 'С записью')}
        </div>
      </Card>

      {isMobile ? (
        isFetching && !data ? <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
          : items.length === 0 ? <Empty description="Звонков нет" />
            : (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {items.map((c) => (
                  <Card key={c.id} size="small" onClick={() => open(c)} styles={{ body: { padding: 12 } }}>
                    <Typography.Text strong>{formatUzPhone(c.counterpart) || 'скрытый номер'}</Typography.Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, alignItems: 'center' }}>
                      {typeCell(c)}
                      <Typography.Text type="secondary">{dayjs(c.startedAt).format('DD.MM HH:mm')} · {formatDuration(c.durationSec)}</Typography.Text>
                      {seeAll && c.manager && <Typography.Text type="secondary">{c.manager.fullName}</Typography.Text>}
                      <CallbackTag call={c} />
                    </div>
                    {c.hasRecording && <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>{player(c, true)}</div>}
                  </Card>
                ))}
                {(data?.totalCount ?? 0) > (filters.pageSize ?? 30) && (
                  <Pagination
                    simple
                    current={filters.page}
                    pageSize={filters.pageSize}
                    total={data?.totalCount}
                    onChange={(p, s) => patch({ page: String(p), pageSize: String(s) }, true)}
                  />
                )}
              </Space>
            )
      ) : (
        <Table<CallListItem>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={items}
          loading={isFetching && !data}
          onRow={(c) => ({ onClick: () => open(c), style: { cursor: 'pointer' } })}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: data?.totalCount ?? 0,
            onChange: (p, s) => patch({ page: String(p), pageSize: String(s) }, true),
          }}
          locale={{ emptyText: 'Звонков нет' }}
        />
      )}

      <HrCallDrawer
        callId={openId}
        canDelete={seeAll}
        onClose={() => patch({ call: undefined }, true)}
        onOpenCall={(id) => patch({ call: id }, true)}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['hr-calls'] });
          queryClient.invalidateQueries({ queryKey: ['hr-call'] });
          queryClient.invalidateQueries({ queryKey: ['hr-calls-missed'] });
          queryClient.invalidateQueries({ queryKey: ['hr-calls-summary'] });
        }}
      />
    </div>
  );
}

function HrCallDrawer({ callId, canDelete, onClose, onOpenCall, onChanged }: {
  callId: string | null;
  canDelete: boolean;
  onClose: () => void;
  onOpenCall: (id: string) => void;
  onChanged: () => void;
}) {
  const isMobile = useIsMobile();
  const { data: call, isLoading, error } = useQuery({ queryKey: ['hr-call', callId], queryFn: () => hrCallsApi.get(callId!), enabled: !!callId });
  const { data: history } = useQuery({ queryKey: ['hr-call-history', callId], queryFn: () => hrCallsApi.history(callId!), enabled: !!callId });

  const done = (text: string) => () => { message.success(text); onChanged(); };
  const onError = (err: unknown) => message.error(apiErrorMessage(err));
  const calledBack = useMutation({ mutationFn: () => hrCallsApi.calledBack(callId!), onSuccess: done('Отмечено: перезвонила'), onError });
  const task = useMutation({
    mutationFn: () => hrCallsApi.callbackTask(callId!),
    onSuccess: (r) => { message.success(r.existing ? 'Задача «перезвонить» по этому номеру уже есть' : 'Задача «перезвонить» создана'); onChanged(); },
    onError,
  });
  const remove = useMutation({ mutationFn: () => hrCallsApi.remove([callId!]), onSuccess: () => { done('Звонок удалён')(); onClose(); }, onError });

  const missed = call && call.status === 'MISSED';
  return (
    <Drawer
      open={!!callId}
      onClose={onClose}
      width={isMobile ? '100%' : 520}
      title={call ? `${callTypeLabel(call)} · ${dayjs(call.startedAt).format('DD.MM.YYYY HH:mm')}` : 'Звонок'}
      destroyOnHidden
    >
      {isLoading && <Spin />}
      {error && <Alert type="error" message={apiErrorMessage(error, 'Звонок не найден')} />}
      {call && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Номер">{formatUzPhone(call.counterpart) || 'скрыт'}</Descriptions.Item>
            <Descriptions.Item label="Сотрудник">{call.manager?.fullName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Длительность">{formatDuration(call.durationSec)}</Descriptions.Item>
            {isFailedCall(call) && call.counterpart && (
              <Descriptions.Item label="Результат"><FollowUpTag call={call} full /></Descriptions.Item>
            )}
            <Descriptions.Item label="Запись">
              {call.hasRecording ? <CallAudioPlayer callId={call.id} block getUrl={hrCallsApi.audioUrl} /> : 'нет'}
            </Descriptions.Item>
          </Descriptions>

          <Space wrap>
            {missed && !call.calledBackAt && (
              <Button type="primary" loading={calledBack.isPending} onClick={() => calledBack.mutate()}>Перезвонила</Button>
            )}
            {call.counterpart && <Button loading={task.isPending} onClick={() => task.mutate()}>Задача «перезвонить»</Button>}
            {canDelete && (
              <Popconfirm title="Удалить звонок?" description="Запись удалится, звонок пропадёт из журнала." okText="Удалить" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate()}>
                <Button danger loading={remove.isPending}>Удалить</Button>
              </Popconfirm>
            )}
          </Space>

          {(history?.items.length ?? 0) > 1 && (
            <List
              size="small"
              header={<Typography.Text strong>Все звонки с номером {formatUzPhone(call.counterpart)}</Typography.Text>}
              dataSource={history!.items}
              renderItem={(c) => (
                <List.Item
                  style={{ cursor: c.id === call.id ? undefined : 'pointer', opacity: c.id === call.id ? 0.6 : 1 }}
                  onClick={() => c.id !== call.id && onOpenCall(c.id)}
                >
                  <Typography.Text type={isFailedCall(c) ? 'danger' : undefined}>
                    {dayjs(c.startedAt).format('DD.MM HH:mm')} · {callTypeLabel(c)} · {formatDuration(c.durationSec)}
                  </Typography.Text>
                  {c.id === call.id && <Tag>этот звонок</Tag>}
                </List.Item>
              )}
            />
          )}
        </Space>
      )}
    </Drawer>
  );
}
