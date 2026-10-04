import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, DatePicker, Input, Popconfirm, Select, Space, Switch, Tooltip, Typography, message } from 'antd';
import { FileSearchOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { callsApi, mobileApi, type CallsFilters } from '../api/calls.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import CallsList from '../components/calls/CallsList';
import { useCallActions } from '../components/calls/useCallActions';
import { CALL_TYPE_OPTIONS, apiErrorMessage, canSeeAllCalls } from '../components/calls/callsUi';
import ReassignCallsModal from '../components/calls/ReassignCallsModal';
import CallReportsDrawer from '../components/calls/CallReportsDrawer';

/** Столько звонков можно отдать в один общий анализ */
const MAX_REPORT_CALLS = 50;

/**
 * Журнал звонков с рабочих телефонов (CallSync). Фильтры живут в URL — ссылкой из Telegram
 * (/calls?call=<id>) открывается сразу нужный звонок.
 */
export default function CallsPage() {
  const user = useAuthStore((s) => s.user);
  const isMobile = useIsMobile();
  const seeAll = canSeeAllCalls(user);
  const [params, setParams] = useSearchParams();

  const filters: CallsFilters = useMemo(() => ({
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    managerId: params.get('managerId') ?? undefined,
    type: params.get('type') ?? undefined,
    missedOnly: params.get('missedOnly') === '1' || undefined,
    withRecording: params.get('withRecording') === '1' || undefined,
    unknownOnly: params.get('unknownOnly') === '1' || undefined,
    clientId: params.get('clientId') ?? undefined,
    phone: params.get('phone') ?? undefined,
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
    queryKey: ['calls', filters],
    queryFn: () => callsApi.list(filters),
    placeholderData: keepPreviousData,
  });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(), enabled: seeAll });

  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const [selected, setSelected] = useState<string[]>([]);
  const [reassignOpen, setReassignOpen] = useState(false);

  // Постоянный анализ — платный: переключатель на виду у админа
  const { data: settings } = useQuery({ queryKey: ['mobile-settings'], queryFn: mobileApi.settings, enabled: isAdmin });
  const toggleAuto = useMutation({
    mutationFn: (on: boolean) => mobileApi.updateSettings({ autoAuditEnabled: on }),
    onSuccess: (st) => {
      queryClient.setQueryData(['mobile-settings'], st);
      message.success(st.autoAuditEnabled ? 'Постоянный анализ включён: новые записи разбираются автоматически' : 'Постоянный анализ выключен: только по выбору');
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  const refreshCalls = () => {
    queryClient.invalidateQueries({ queryKey: ['calls'] });
    queryClient.invalidateQueries({ queryKey: ['call'] });
  };
  const analyze = useMutation({
    mutationFn: () => callsApi.analyze(selected),
    onSuccess: (r) => {
      const parts = [`Поставлено на анализ: ${r.queued + r.inProgress}`];
      if (r.alreadyDone) parts.push(`уже проанализированы: ${r.alreadyDone}`);
      if (r.noRecording) parts.push(`без записи: ${r.noRecording}`);
      message.success(parts.join(', '));
      setSelected([]);
      refreshCalls();
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });
  const report = useMutation({
    mutationFn: () => callsApi.createReport(selected),
    onSuccess: (r) => {
      message.success('Общий анализ запущен');
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['call-reports'] });
      patch({ reports: '1', report: r.id }, true);
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => callsApi.remove(selected),
    onSuccess: (r) => {
      message.success(`Удалено звонков: ${r.deleted}`);
      setSelected([]);
      refreshCalls();
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  const { actions, elements } = useCallActions({
    openCallId: params.get('call'),
    onOpenChange: (id) => patch({ call: id ?? undefined }, true),
  });

  /** На телефоне каждый фильтр — во всю ширину */
  const full = isMobile ? { flex: '1 1 100%', minWidth: 0 } : undefined;

  const flag = (key: string, label: string) => (
    <Checkbox checked={params.get(key) === '1'} onChange={(e) => patch({ [key]: e.target.checked ? '1' : undefined })}>
      {label}
    </Checkbox>
  );

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Звонки</Typography.Title>
        <Space wrap>
          {isAdmin && settings && (
            <Tooltip title="Включено — каждая запись автоматически расшифровывается и проходит аудит (платно). Выключено — только выбранные звонки.">
              <Space size={6}>
                <Switch size="small" checked={settings.autoAuditEnabled} loading={toggleAuto.isPending} onChange={(v) => toggleAuto.mutate(v)} />
                <Typography.Text>Постоянный анализ</Typography.Text>
              </Space>
            </Tooltip>
          )}
          {seeAll && (
            <Button icon={<FileSearchOutlined />} onClick={() => patch({ reports: '1' }, true)}>Общие анализы</Button>
          )}
        </Space>
      </div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <DatePicker.RangePicker
            style={full}
            format="DD.MM.YYYY"
            value={filters.from || filters.to ? [filters.from ? dayjs(filters.from) : null, filters.to ? dayjs(filters.to) : null] : null}
            onChange={(v) => patch({ from: v?.[0]?.format('YYYY-MM-DD'), to: v?.[1]?.format('YYYY-MM-DD') })}
          />
          {seeAll && (
            <Select
              allowClear
              showSearch
              placeholder="Менеджер"
              style={{ ...full, width: isMobile ? undefined : 200 }}
              value={filters.managerId}
              onChange={(v) => patch({ managerId: v })}
              optionFilterProp="label"
              options={users.filter((u) => u.isActive).map((u) => ({ value: u.id, label: u.fullName }))}
            />
          )}
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
          <Input.Search
            allowClear
            placeholder="Номер"
            style={{ ...full, width: isMobile ? undefined : 180 }}
            defaultValue={filters.phone}
            onSearch={(v) => patch({ phone: v.trim() || undefined })}
          />
          {flag('missedOnly', 'Только пропущенные')}
          {flag('withRecording', 'С записью')}
          {flag('unknownOnly', 'Неизвестные номера')}
        </div>
      </Card>

      {seeAll && selected.length > 0 && (
        <Alert
          type="info"
          style={{ marginBottom: 12, position: 'sticky', top: 8, zIndex: 5 }}
          message={(
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Typography.Text strong>Выбрано: {selected.length}</Typography.Text>
              <Button size="small" type="primary" loading={analyze.isPending} onClick={() => analyze.mutate()}>Проанализировать</Button>
              <Tooltip title={selected.length > MAX_REPORT_CALLS ? `Не больше ${MAX_REPORT_CALLS} звонков` : 'Один отчёт по всем выбранным разговорам: общие ошибки, возражения, сравнение менеджеров'}>
                <Button size="small" loading={report.isPending} disabled={selected.length > MAX_REPORT_CALLS} onClick={() => report.mutate()}>Общий анализ</Button>
              </Tooltip>
              <Button size="small" onClick={() => setReassignOpen(true)}>Чей звонок</Button>
              <Popconfirm
                title={`Удалить звонков: ${selected.length}?`}
                description="Записи и аудиты удалятся, звонки пропадут из журнала и статистики."
                okText="Удалить"
                okButtonProps={{ danger: true }}
                onConfirm={() => remove.mutate()}
              >
                <Button size="small" danger loading={remove.isPending}>Удалить</Button>
              </Popconfirm>
              <Button size="small" type="link" onClick={() => setSelected([])}>Снять выделение</Button>
            </div>
          )}
        />
      )}

      <CallsList
        items={data?.items ?? []}
        loading={isFetching && !data}
        totalCount={data?.totalCount ?? 0}
        page={filters.page ?? 1}
        pageSize={filters.pageSize ?? 30}
        onPageChange={(page, pageSize) => patch({ page: String(page), pageSize: String(pageSize) }, true)}
        showManager={seeAll}
        selectedIds={seeAll ? selected : undefined}
        onSelectionChange={seeAll ? setSelected : undefined}
        {...actions}
      />
      {elements}
      <ReassignCallsModal callIds={selected} open={reassignOpen} onClose={() => setReassignOpen(false)} onDone={() => setSelected([])} />
      {seeAll && (
        <CallReportsDrawer
          open={params.get('reports') === '1'}
          onClose={() => patch({ reports: undefined, report: undefined }, true)}
          openReportId={params.get('report')}
          onOpenReport={(id) => patch({ report: id ?? undefined }, true)}
          onOpenCall={(id) => patch({ reports: undefined, report: undefined, call: id }, true)}
        />
      )}
    </div>
  );
}
