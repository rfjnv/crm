import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Card, Checkbox, DatePicker, Input, Select, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { callsApi, type CallsFilters } from '../api/calls.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import CallsList from '../components/calls/CallsList';
import { useCallActions } from '../components/calls/useCallActions';
import { CALL_TYPE_OPTIONS, canSeeAllCalls } from '../components/calls/callsUi';

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
      <Typography.Title level={4} style={{ marginTop: 0 }}>Звонки</Typography.Title>
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

      <CallsList
        items={data?.items ?? []}
        loading={isFetching && !data}
        totalCount={data?.totalCount ?? 0}
        page={filters.page ?? 1}
        pageSize={filters.pageSize ?? 30}
        onPageChange={(page, pageSize) => patch({ page: String(page), pageSize: String(pageSize) }, true)}
        showManager={seeAll}
        {...actions}
      />
      {elements}
    </div>
  );
}
