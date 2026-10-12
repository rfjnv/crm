import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, DatePicker, Empty, Row, Segmented, Select, Space, Spin, Statistic, Table, Tag, Tooltip, Typography, theme } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from '@ant-design/icons';
import { Bar, Column } from '@ant-design/charts';
import dayjs, { type Dayjs } from 'dayjs';
import { callReportsApi, type EmployeeCalls } from '../api/callReports.api';
import { getFirstName } from '../lib/name-utils';
import { useIsMobile } from '../hooks/useIsMobile';

const { Text } = Typography;

/** Исходящие — синий, входящие — оранжевый: пара проверена на различимость и контраст в обеих темах. */
const OUT = { light: '#2a78d6', dark: '#3987e5' };
const IN = { light: '#eb6834', dark: '#d95926' };
const L_OUT = 'Исходящие';
const L_IN = 'Входящие';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function presetRange(p: Preset): [Dayjs, Dayjs] {
  const t = dayjs();
  if (p === 'yesterday') return [t.subtract(1, 'day'), t.subtract(1, 'day')];
  if (p === 'week') return [t.subtract(6, 'day'), t];
  if (p === 'month') return [t.startOf('month'), t];
  return [t, t];
}

/** «2 ч 15 мин», «4 мин 30 с». */
function fmtDur(sec: number): string {
  if (!sec) return '0';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h} ч ${m} мин`;
  if (m) return s && m < 10 ? `${m} мин ${s} с` : `${m} мин`;
  return `${s} с`;
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Изменение к прошлому периоду: стрелка + число, а не только цвет. invert — когда рост плохо (пропущенные). */
function Delta({ cur, prev, fmt, invert }: { cur: number; prev: number; fmt?: (v: number) => string; invert?: boolean }) {
  const diff = cur - prev;
  if (diff === 0) return <Text type="secondary" style={{ fontSize: 12 }}><MinusOutlined /> как раньше</Text>;
  const up = diff > 0;
  const good = invert ? !up : up;
  const p = prev > 0 ? ` (${up ? '+' : '−'}${Math.round((Math.abs(diff) / prev) * 100)}%)` : '';
  return (
    <Text type={good ? 'success' : 'danger'} style={{ fontSize: 12 }}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {up ? '+' : '−'}{fmt ? fmt(Math.abs(diff)) : Math.abs(diff)}{p}
    </Text>
  );
}

/**
 * Отчёт по звонкам: кто сколько звонил, сколько разговоров, время в разговорах,
 * пропущенные без перезвона, когда начинают звонить. Для HR и руководства —
 * только цифры, без записей и расшифровок (они в «Звонках» у руководителя).
 */
export default function CallReportsPage() {
  const isMobile = useIsMobile();
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const mode = isDark ? 'dark' : 'light';

  const [preset, setPreset] = useState<Preset>('today');
  const [range, setRange] = useState<[Dayjs, Dayjs]>(presetRange('today'));
  const [userId, setUserId] = useState<string | undefined>();

  const params = { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD'), userId };
  const { data, isLoading } = useQuery({
    queryKey: ['call-reports', params],
    queryFn: () => callReportsApi.get(params),
    refetchInterval: range[1].isSame(dayjs(), 'day') ? 120_000 : false,
  });

  // Список сотрудников для фильтра — из отчёта без фильтра по сотруднику
  const { data: allData } = useQuery({
    queryKey: ['call-reports', { ...params, userId: undefined }],
    queryFn: () => callReportsApi.get({ ...params, userId: undefined }),
    enabled: !!userId,
  });
  const employeeOptions = (userId ? allData?.employees : data?.employees)?.map((e) => ({ value: e.userId, label: e.fullName })) ?? [];

  const days = range[1].diff(range[0], 'day') + 1;
  const prevLabel = days === 1 ? (range[0].isSame(dayjs(), 'day') ? 'вчера' : 'день до') : `прошлые ${days} дн.`;

  const whoConfig = useMemo(() => {
    const list = (data?.employees ?? []).filter((e) => e.total > 0);
    if (list.length === 0) return null;
    return {
      data: list.flatMap((e) => {
        const name = getFirstName(e.fullName) || e.fullName;
        return [
          { name, type: L_OUT, value: e.outbound },
          { name, type: L_IN, value: e.inbound },
        ];
      }),
      xField: 'name',
      yField: 'value',
      colorField: 'type',
      stack: true,
      height: Math.max(160, list.length * 34 + 70),
      theme: isDark ? 'classicDark' : 'classic',
      scale: { color: { domain: [L_OUT, L_IN], range: [OUT[mode], IN[mode]] } },
      style: { radiusTopLeft: 4, radiusTopRight: 4, inset: 1 },
      axis: {
        x: { labelFill: token.colorText, title: false, tick: false },
        y: { labelFill: token.colorTextSecondary, title: false, labelAutoRotate: false, labelAutoHide: true, grid: true, gridStroke: token.colorBorderSecondary, gridLineDash: [0, 0] },
      },
      legend: { color: { itemLabelFill: token.colorText, position: 'top' as const } },
      tooltip: { title: 'name', items: [{ field: 'value', channel: 'y' }] },
      interaction: { elementHighlightByX: true },
    };
  }, [data, isDark, mode, token]);

  const hourConfig = useMemo(() => {
    const hours = (data?.byHour ?? []).filter((h) => h.hour >= 7 && h.hour <= 21);
    if (!data || data.totals.total === 0) return null;
    return {
      data: hours.flatMap((h) => [
        { hour: `${String(h.hour).padStart(2, '0')}:00`, type: L_OUT, value: h.outbound },
        { hour: `${String(h.hour).padStart(2, '0')}:00`, type: L_IN, value: h.inbound },
      ]),
      xField: 'hour',
      yField: 'value',
      colorField: 'type',
      stack: true,
      height: 220,
      theme: isDark ? 'classicDark' : 'classic',
      scale: { color: { domain: [L_OUT, L_IN], range: [OUT[mode], IN[mode]] } },
      style: { radiusTopLeft: 4, radiusTopRight: 4, inset: 1 },
      axis: {
        x: { labelFill: token.colorTextSecondary, title: false, tick: false, labelAutoRotate: false, labelAutoHide: true },
        y: { labelFill: token.colorTextSecondary, title: false, grid: true, gridStroke: token.colorBorderSecondary, gridLineDash: [0, 0] },
      },
      legend: false as const,
      tooltip: { title: 'hour', items: [{ field: 'value', channel: 'y' }] },
      interaction: { elementHighlightByX: true },
    };
  }, [data, isDark, mode, token]);

  const columns = [
    {
      title: 'Сотрудник',
      key: 'name',
      fixed: 'left' as const,
      width: 160,
      render: (_: unknown, e: EmployeeCalls) => <Text strong>{getFirstName(e.fullName) || e.fullName}</Text>,
    },
    {
      title: 'Звонков',
      key: 'total',
      width: 120,
      sorter: (a: EmployeeCalls, b: EmployeeCalls) => a.total - b.total,
      defaultSortOrder: 'descend' as const,
      render: (_: unknown, e: EmployeeCalls) => (
        <Space direction="vertical" size={0}>
          <Text strong>{e.total}</Text>
          <Delta cur={e.total} prev={e.prevTotal} />
        </Space>
      ),
    },
    {
      title: <Tooltip title="Дозвонились / всего исходящих">Исходящие</Tooltip>,
      key: 'out',
      width: 120,
      sorter: (a: EmployeeCalls, b: EmployeeCalls) => a.outbound - b.outbound,
      render: (_: unknown, e: EmployeeCalls) => (
        <span>{e.outboundConnected} / {e.outbound} <Text type="secondary" style={{ fontSize: 12 }}>{e.outbound ? `${pct(e.outboundConnected, e.outbound)}%` : ''}</Text></span>
      ),
    },
    {
      title: <Tooltip title="Приняли / всего входящих">Входящие</Tooltip>,
      key: 'in',
      width: 110,
      sorter: (a: EmployeeCalls, b: EmployeeCalls) => a.inbound - b.inbound,
      render: (_: unknown, e: EmployeeCalls) => <span>{e.inboundAnswered} / {e.inbound}</span>,
    },
    {
      title: <Tooltip title="Пропущенные, на которые никто не перезвонил и клиент сам не дозвонился">Без перезвона</Tooltip>,
      key: 'missed',
      width: 120,
      sorter: (a: EmployeeCalls, b: EmployeeCalls) => a.missedNotCalledBack - b.missedNotCalledBack,
      render: (_: unknown, e: EmployeeCalls) =>
        e.missedNotCalledBack ? <Tag color="error">{e.missedNotCalledBack} из {e.missed}</Tag> : <Text type="secondary">{e.missed ? `0 из ${e.missed}` : '—'}</Text>,
    },
    {
      title: 'В разговорах',
      key: 'talk',
      width: 120,
      sorter: (a: EmployeeCalls, b: EmployeeCalls) => a.talkSec - b.talkSec,
      render: (_: unknown, e: EmployeeCalls) => fmtDur(e.talkSec),
    },
    {
      title: 'Средний разговор',
      key: 'avg',
      width: 120,
      sorter: (a: EmployeeCalls, b: EmployeeCalls) => a.avgTalkSec - b.avgTalkSec,
      render: (_: unknown, e: EmployeeCalls) => (e.conversations ? fmtDur(e.avgTalkSec) : '—'),
    },
    {
      title: <Tooltip title="Во сколько в среднем первый звонок за день">Начинает звонить</Tooltip>,
      key: 'first',
      width: 120,
      sorter: (a: EmployeeCalls, b: EmployeeCalls) => (a.avgFirstCallMin ?? 9999) - (b.avgFirstCallMin ?? 9999),
      render: (_: unknown, e: EmployeeCalls) => (e.avgFirstCallMin !== null ? hhmm(e.avgFirstCallMin) : '—'),
    },
    {
      title: <Tooltip title="Звонков с номерами клиентов из CRM">С клиентами</Tooltip>,
      key: 'clients',
      width: 110,
      render: (_: unknown, e: EmployeeCalls) => (e.total ? `${pct(e.clientCalls, e.total)}%` : '—'),
    },
    ...(days > 1
      ? [{
          title: 'Дней со звонками',
          key: 'days',
          width: 110,
          render: (_: unknown, e: EmployeeCalls) => e.activeDays,
        }]
      : []),
  ];

  const t = data?.totals;
  const p = data?.prevTotals;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Отчёт по звонкам</Typography.Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Звонки сотрудников с рабочих телефонов (CallSync). Служебные номера и удалённые личные звонки не считаются.
        </Text>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented<Preset>
          value={preset}
          onChange={(v) => { setPreset(v); if (v !== 'custom') setRange(presetRange(v)); }}
          options={[
            { value: 'today', label: 'Сегодня' },
            { value: 'yesterday', label: 'Вчера' },
            { value: 'week', label: '7 дней' },
            { value: 'month', label: 'Этот месяц' },
            { value: 'custom', label: 'Период' },
          ]}
        />
        {preset === 'custom' && (
          <DatePicker.RangePicker
            value={range}
            onChange={(v) => v?.[0] && v[1] && setRange([v[0], v[1]])}
            format="DD.MM.YYYY"
            allowClear={false}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          />
        )}
        <Select
          placeholder="Все сотрудники"
          value={userId}
          onChange={setUserId}
          allowClear
          showSearch
          optionFilterProp="label"
          options={employeeOptions}
          style={{ width: 220 }}
        />
      </Space>

      {isLoading || !data || !t || !p ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[12, 12]}>
            {[
              { title: 'Звонков', value: t.total, prev: p.total, extra: `${t.uniqueNumbers} разных номеров` },
              { title: 'Разговоров состоялось', value: t.conversations, prev: p.conversations, extra: `${pct(t.conversations, t.total)}% от всех звонков` },
              { title: 'Время в разговорах', value: t.talkSec, prev: p.talkSec, fmt: fmtDur, extra: t.conversations ? `в среднем ${fmtDur(Math.round(t.talkSec / t.conversations))}` : '' },
              { title: 'Исходящие', value: t.outbound, prev: p.outbound, extra: `дозвонились ${pct(t.outboundConnected, t.outbound)}%` },
              { title: 'Входящие', value: t.inbound, prev: p.inbound, extra: `приняли ${pct(t.inboundAnswered, t.inbound)}%` },
              { title: 'Пропущенные без перезвона', value: t.missedNotCalledBack, prev: p.missedNotCalledBack, invert: true, extra: `из ${t.missed} пропущенных` },
            ].map((s) => (
              <Col xs={12} md={8} xl={4} key={s.title}>
                <Card size="small" style={{ height: '100%' }}>
                  <Statistic
                    title={s.title}
                    value={s.value}
                    formatter={s.fmt ? (v) => s.fmt!(Number(v)) : undefined}
                    valueStyle={s.invert && s.value > 0 ? { color: token.colorError } : undefined}
                  />
                  <div><Delta cur={s.value} prev={s.prev} fmt={s.fmt} invert={s.invert} /> <Text type="secondary" style={{ fontSize: 12 }}>к {prevLabel}</Text></div>
                  {s.extra && <Text type="secondary" style={{ fontSize: 12 }}>{s.extra}</Text>}
                </Card>
              </Col>
            ))}
          </Row>

          {t.total === 0 && p.total === 0 ? (
            <Card><Empty description="За этот период звонков нет" /></Card>
          ) : (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>
                  <Card size="small" title="Кто сколько звонил" style={{ height: '100%' }}>
                    {whoConfig ? <Bar {...whoConfig} /> : <Empty description="Нет звонков" />}
                  </Card>
                </Col>
                <Col xs={24} lg={10}>
                  <Card
                    size="small"
                    title="Когда звонят — по часам"
                    extra={(
                      <Space size={12}>
                        <Space size={4}><span style={{ width: 10, height: 10, borderRadius: 2, background: OUT[mode], display: 'inline-block' }} /><Text style={{ fontSize: 12 }}>{L_OUT}</Text></Space>
                        <Space size={4}><span style={{ width: 10, height: 10, borderRadius: 2, background: IN[mode], display: 'inline-block' }} /><Text style={{ fontSize: 12 }}>{L_IN}</Text></Space>
                      </Space>
                    )}
                    style={{ height: '100%' }}
                  >
                    {hourConfig ? <Column {...hourConfig} /> : <Empty description="Нет звонков" />}
                  </Card>
                </Col>
              </Row>

              <Card size="small" title="По сотрудникам">
                <Table<EmployeeCalls>
                  dataSource={data.employees}
                  columns={columns}
                  rowKey="userId"
                  size="middle"
                  pagination={false}
                  scroll={{ x: isMobile ? 1100 : undefined }}
                  onRow={(e) => ({ onClick: () => setUserId(e.userId === userId ? undefined : e.userId), style: { cursor: 'pointer' } })}
                />
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  Нажмите на сотрудника — графики и плитки покажут только его.
                </Text>
              </Card>
            </>
          )}
        </Space>
      )}
    </div>
  );
}
