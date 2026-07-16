import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Table, Typography, Spin, Select, Space, Tooltip, Empty, theme, Drawer, List, Tag, Tour, Button, Segmented } from 'antd';
import type { TourProps } from 'antd';
import { TeamOutlined, InfoCircleOutlined, PhoneOutlined, SendOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Line } from '@ant-design/charts';
import dayjs from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { formatUZS } from '../utils/currency';
import { telegramLinkFromPhone } from '../utils/phone';
import ClientQuickViewDrawer from './ClientQuickViewDrawer';
import type { UserRole, CohortRow, CohortMode } from '../types';

const COHORTS_TOUR_STORAGE_KEY = 'cohorts-tour-dismissed';

/** Подсветка «линейкой» строки/столбца при наведении на ячейку удержания — как в таблицах Excel. */
const ROW_HOVER_SHADOW = 'inset 0 0 0 9999px rgba(22, 119, 255, 0.10)';
const COL_HOVER_SHADOW = 'inset 0 0 0 9999px rgba(22, 119, 255, 0.10)';

function FormulaHint({ text }: { text: string }) {
  return (
    <Tooltip title={text}>
      <InfoCircleOutlined style={{ marginLeft: 4, fontSize: 12, opacity: 0.45 }} />
    </Tooltip>
  );
}

/**
 * Когортный анализ клиентов: удержание (retention) по месяцам с первой покупки + LTV-кривая.
 * Общий для админской «Аналитики» и менеджерской «Аналитики для менеджеров» — эндпоинт сам
 * скоупит данные по менеджеру (ownerScope), фильтр по менеджеру виден только не-MANAGER ролям.
 */
export default function CohortsAnalyticsPanel({ fetchEnabled = true }: { fetchEnabled?: boolean }) {
  const { token } = theme.useToken();
  const role = useAuthStore((s) => s.user?.role) as UserRole | undefined;
  const isManagerRole = role === 'MANAGER';
  const [managerId, setManagerId] = useState<string | undefined>();
  const [mode, setMode] = useState<CohortMode>('new');
  const [drillDown, setDrillDown] = useState<{ cohortMonth: string; monthOffset: number } | null>(null);
  const [quickViewClientId, setQuickViewClientId] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [hoveredCohort, setHoveredCohort] = useState<string | null>(null);
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null);
  const modeRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const { data: cohortData, isLoading: cohortLoading } = useQuery({
    queryKey: ['analytics-cohorts', managerId, mode],
    queryFn: () => analyticsApi.getCohorts(managerId, mode),
    staleTime: 120_000,
    enabled: fetchEnabled,
  });

  const { data: managerUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    enabled: fetchEnabled && !isManagerRole,
  });

  const managerOptions = useMemo(
    () =>
      [...managerUsers]
        .filter((u) => u.isActive)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
        .map((u) => ({ label: u.fullName, value: u.id })),
    [managerUsers],
  );

  const { data: drillDownData, isLoading: drillDownLoading } = useQuery({
    queryKey: ['analytics-cohort-clients', drillDown?.cohortMonth, drillDown?.monthOffset, managerId, mode],
    queryFn: () => analyticsApi.getCohortClients(drillDown!.cohortMonth, drillDown!.monthOffset, managerId, mode),
    enabled: !!drillDown,
  });

  /** Сколько полных месяцев прошло с начала когорты — чтобы не путать «ещё не наступило» с «0% удержания». */
  const monthsElapsed = (cohortMonth: string): number =>
    dayjs().startOf('month').diff(dayjs(`${cohortMonth}-01`), 'month');

  const cohortsDesc = useMemo(() => {
    if (!cohortData?.cohorts) return [];
    return [...cohortData.cohorts].sort((a, b) => b.cohortMonth.localeCompare(a.cohortMonth));
  }, [cohortData]);

  const offsetColumns = useMemo(
    () => Array.from({ length: (cohortData?.maxMonthOffset ?? 11) + 1 }, (_, i) => i),
    [cohortData],
  );

  const summary = useMemo(() => {
    if (!cohortData?.cohorts || cohortData.cohorts.length === 0) return null;
    const retentionAtOffset = (offset: number) => {
      let sizeSum = 0;
      let activeSum = 0;
      for (const c of cohortData.cohorts) {
        if (monthsElapsed(c.cohortMonth) < offset) continue;
        sizeSum += c.cohortSize;
        activeSum += c.points.find((p) => p.monthOffset === offset)?.activeClients ?? 0;
      }
      return sizeSum > 0 ? Math.round((activeSum / sizeSum) * 1000) / 10 : null;
    };
    return {
      cohortsCount: cohortData.cohorts.length,
      retentionM1: retentionAtOffset(1),
      retentionM3: retentionAtOffset(3),
    };
  }, [cohortData]);

  const ltvChartData = useMemo(() => {
    if (!cohortData?.cohorts) return [];
    const maxOffset = cohortData.maxMonthOffset ?? 11;
    const recentCohorts = [...cohortData.cohorts]
      .sort((a, b) => b.cohortMonth.localeCompare(a.cohortMonth))
      .slice(0, 8);
    const rows: { cohortLabel: string; monthOffset: number; ltv: number }[] = [];
    for (const c of recentCohorts) {
      const elapsed = Math.min(maxOffset, monthsElapsed(c.cohortMonth));
      const cohortLabel = dayjs(`${c.cohortMonth}-01`).format('MMM YYYY');
      let cumulative = 0;
      for (let offset = 0; offset <= elapsed; offset++) {
        cumulative += c.points.find((p) => p.monthOffset === offset)?.revenuePerCohortClient ?? 0;
        rows.push({ cohortLabel, monthOffset: offset, ltv: Math.round(cumulative) });
      }
    }
    return rows;
  }, [cohortData]);

  /** «Старт» вместо M0, «+N мес.» вместо MN — не нужно расшифровывать нотацию в уме. */
  const offsetLabel = (offset: number) => (offset === 0 ? 'Старт' : `+${offset} мес.`);

  const heatmapColumns = useMemo(() => {
    const rowHoverProps = (record: CohortRow) => ({
      onMouseEnter: () => setHoveredCohort(record.cohortMonth),
      onMouseLeave: () => setHoveredCohort(null),
      style: record.cohortMonth === hoveredCohort ? { boxShadow: ROW_HOVER_SHADOW } : undefined,
    });

    const base = [
      {
        title: 'Когорта',
        dataIndex: 'cohortMonth',
        key: 'cohortMonth',
        fixed: 'left' as const,
        width: 110,
        render: (v: string) => dayjs(`${v}-01`).format('MMM YYYY'),
        onCell: rowHoverProps,
      },
      {
        title: mode === 'new' ? 'Новых' : 'Купили',
        dataIndex: 'cohortSize',
        key: 'cohortSize',
        width: 90,
        align: 'right' as const,
        onCell: rowHoverProps,
      },
    ];
    const offsetCols = offsetColumns.map((offset) => ({
      title: offsetLabel(offset),
      key: `m${offset}`,
      width: 72,
      align: 'center' as const,
      onHeaderCell: () => ({
        onMouseEnter: () => setHoveredOffset(offset),
        onMouseLeave: () => setHoveredOffset(null),
        style: offset === hoveredOffset ? { background: token.colorPrimaryBg, fontWeight: 700 } : undefined,
      }),
      render: (_: unknown, record: CohortRow) => {
        const isRowHovered = record.cohortMonth === hoveredCohort;
        const isColHovered = offset === hoveredOffset;
        const hoverShadow = [isRowHovered && ROW_HOVER_SHADOW, isColHovered && COL_HOVER_SHADOW]
          .filter(Boolean)
          .join(', ');
        const handlers = {
          onMouseEnter: () => {
            setHoveredCohort(record.cohortMonth);
            setHoveredOffset(offset);
          },
          onMouseLeave: () => {
            setHoveredCohort(null);
            setHoveredOffset(null);
          },
        };
        const elapsed = monthsElapsed(record.cohortMonth);
        if (offset > elapsed) {
          return (
            <div {...handlers} style={{ color: token.colorTextQuaternary, boxShadow: hoverShadow || undefined, borderRadius: 4 }}>
              —
            </div>
          );
        }
        const point = record.points.find((p) => p.monthOffset === offset);
        const percent = point?.retentionPercent ?? 0;
        const alpha = Math.min(1, Math.max(0.08, percent / 100));
        const calendarMonth = dayjs(`${record.cohortMonth}-01`).add(offset, 'month').format('MMM');
        return (
          <Tooltip
            title={
              (point
                ? `${point.activeClients} из ${record.cohortSize} клиентов · выручка ${formatUZS(point.revenue)}`
                : `0 из ${record.cohortSize} клиентов`) + ` · ${calendarMonth} · клик — список клиентов`
            }
          >
            <div
              {...handlers}
              onClick={() => setDrillDown({ cohortMonth: record.cohortMonth, monthOffset: offset })}
              style={{
                backgroundColor: `rgba(82, 196, 26, ${alpha})`,
                color: alpha > 0.55 ? '#fff' : token.colorText,
                borderRadius: 4,
                padding: '3px 0',
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: hoverShadow || undefined,
              }}
            >
              <div>{percent}%</div>
              <div style={{ fontSize: 10, opacity: 0.75, fontWeight: 400 }}>{calendarMonth}</div>
            </div>
          </Tooltip>
        );
      },
    }));
    return [...base, ...offsetCols];
  }, [offsetColumns, token, hoveredCohort, hoveredOffset, mode]);

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

  const hasCohorts = !!cohortData && cohortData.cohorts.length > 0;

  useEffect(() => {
    if (!hasCohorts) return;
    if (localStorage.getItem(COHORTS_TOUR_STORAGE_KEY)) return;
    const t = setTimeout(() => setTourOpen(true), 300);
    return () => clearTimeout(t);
  }, [hasCohorts]);

  const closeTour = () => {
    setTourOpen(false);
    localStorage.setItem(COHORTS_TOUR_STORAGE_KEY, '1');
  };

  /** Tour типизирует target как `() => HTMLElement` (без null) — ref.current на деле бывает null
   *  до монтирования, но шаги строятся только после hasCohorts, когда все блоки уже отрисованы. */
  const targetOf = (ref: React.RefObject<HTMLDivElement | null>) => () => ref.current as HTMLElement;

  const tourSteps: TourProps['steps'] = [
    {
      title: 'Кого считать',
      description:
        '«Новые клиенты» — строка только про тех, кто купил здесь впервые в жизни. «Все клиенты» — строка про вообще всех, кто купил в этот месяц (и новых, и давних клиентов). В обоих случаях дальше смотрим на тех же самых людей: сколько из них купило ещё раз через 1, 2, 3 месяца.',
      target: targetOf(modeRef),
    },
    ...(!isManagerRole
      ? [
          {
            title: 'Фильтр по менеджеру',
            description: 'Можно посмотреть когорты конкретного менеджера, а можно оставить пустым — тогда покажет всю компанию.',
            target: targetOf(filterRef),
          },
        ]
      : []),
    {
      title: 'Сводка',
      description:
        'Сколько всего когорт (групп клиентов по месяцу первой покупки) и какой процент из них в среднем возвращается за покупкой через 1 и через 3 месяца.',
      target: targetOf(statsRef),
    },
    {
      title: 'Удержание по когортам',
      description:
        'Каждая строка — клиенты, впервые купившие в этот месяц. «Старт» — месяц первой покупки (всегда 100%), «+1 мес.», «+2 мес.» и т.д. — вернулись ли они через это время (под процентом виден и сам календарный месяц). Ярче цвет — выше процент, «—» значит месяц ещё не наступил. Наведите мышь — подсветится вся строка и столбец, как линейка. Кликните по любой ячейке — откроется список клиентов: кто купил, а кто отвалился.',
      target: targetOf(heatmapRef),
    },
    {
      title: 'Выручка на клиента (LTV)',
      description: 'Накопленная выручка на одного клиента когорты по мере того, как проходит время с его первой покупки.',
      target: targetOf(chartRef),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <Typography.Paragraph type="secondary" style={{ flex: 1 }}>
          {mode === 'new' ? (
            <>
              <strong>Режим «Новые клиенты»</strong>: строка — клиенты, для которых этот месяц был самой первой покупкой за всю
              историю. «Клиентов» — сколько новых пришло в этот месяц.{' '}
            </>
          ) : (
            <>
              <strong>Режим «Все клиенты»</strong>: строка — вообще все, кто купил в этот месяц (и новые, и давние). «Клиентов» —
              сколько всего купило в этот месяц.{' '}
            </>
          )}
          Дальше — <strong>из тех же самых клиентов</strong> сколько купило ещё раз: <strong>Старт</strong> = сам этот месяц (100%),{' '}
          <strong>+1 мес.</strong>, <strong>+2 мес.</strong> и т.д. — сколько вернулось через это время (под процентом — сам
          календарный месяц). Показаны последние 24 когорты.
        </Typography.Paragraph>
        {hasCohorts && (
          <Button icon={<QuestionCircleOutlined />} onClick={() => setTourOpen(true)}>
            Обучение
          </Button>
        )}
      </div>
      <Card ref={modeRef} size="small" bordered={false} style={{ marginBottom: 16 }} bodyStyle={{ paddingBottom: 12 }}>
        <Space wrap align="center">
          <Typography.Text type="secondary">Кого считать</Typography.Text>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as CohortMode)}
            options={[
              { label: 'Новые клиенты', value: 'new' },
              { label: 'Все клиенты', value: 'all' },
            ]}
          />
        </Space>
      </Card>
      {!isManagerRole && (
        <Card ref={filterRef} size="small" bordered={false} style={{ marginBottom: 16 }} bodyStyle={{ paddingBottom: 12 }}>
          <Space wrap align="center">
            <Typography.Text type="secondary">Менеджер</Typography.Text>
            <Select
              allowClear
              placeholder="Все менеджеры"
              style={{ minWidth: 200 }}
              value={managerId}
              onChange={(v) => setManagerId(v)}
              options={managerOptions}
            />
          </Space>
        </Card>
      )}

      {cohortLoading || !cohortData ? (
        <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />
      ) : cohortData.cohorts.length === 0 ? (
        <Empty description="Нет данных для когортного анализа" />
      ) : (
        <>
          <Row ref={statsRef} gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}>
              <Card bordered={false} size="small">
                <Statistic title="Когорт" value={summary?.cohortsCount ?? 0} prefix={<TeamOutlined />} />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card bordered={false} size="small">
                <Statistic
                  title={
                    <span>
                      Retention +1 мес.
                      <FormulaHint text="Доля клиентов когорты, купивших повторно через 1 месяц после первой покупки (усреднено по когортам, где этот месяц уже наступил)" />
                    </span>
                  }
                  value={summary?.retentionM1 ?? '—'}
                  suffix={summary?.retentionM1 != null ? '%' : ''}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card bordered={false} size="small">
                <Statistic
                  title={
                    <span>
                      Retention +3 мес.
                      <FormulaHint text="Доля клиентов когорты, купивших повторно через 3 месяца после первой покупки (усреднено по когортам, где этот месяц уже наступил)" />
                    </span>
                  }
                  value={summary?.retentionM3 ?? '—'}
                  suffix={summary?.retentionM3 != null ? '%' : ''}
                />
              </Card>
            </Col>
          </Row>

          <Card
            ref={heatmapRef}
            title="Удержание клиентов по когортам (Retention)"
            bordered={false}
            style={{ marginBottom: 16 }}
            styles={{ body: { paddingLeft: 12, paddingRight: 24 } }}
          >
            <Table
              columns={heatmapColumns}
              dataSource={cohortsDesc}
              rowKey="cohortMonth"
              pagination={false}
              size="small"
              scroll={{ x: 900 }}
            />
          </Card>

          <Card ref={chartRef} title="Выручка на клиента когорты (LTV), накопительно" bordered={false}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
              На графике — последние по времени когорты (не более 8). Значение — суммарная выручка на клиента когорты с момента
              первой покупки.
            </Typography.Paragraph>
            {ltvChartData.length > 0 ? (
              <Line
                data={ltvChartData}
                xField="monthOffset"
                yField="ltv"
                colorField="cohortLabel"
                height={340}
                shapeField="smooth"
                axis={{
                  y: {
                    labelFormatter: (v: number) => formatUZS(v),
                    labelFill: token.colorTextSecondary,
                    grid: true,
                    gridStroke: token.colorBorderSecondary,
                    gridLineDash: [4, 4],
                  },
                  x: {
                    title: 'Месяцев с первой покупки',
                    labelFill: token.colorTextSecondary,
                  },
                }}
                tooltip={{ items: [{ field: 'ltv', channel: 'y', valueFormatter: (v: number) => formatUZS(v) }] }}
                legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </>
      )}

      <Drawer
        title={
          drillDown
            ? `Когорта ${dayjs(`${drillDown.cohortMonth}-01`).format('MMM YYYY')} · ${offsetLabel(drillDown.monthOffset).toLowerCase()}`
            : ''
        }
        open={!!drillDown}
        onClose={() => setDrillDown(null)}
        width={480}
      >
        {drillDownLoading || !drillDownData ? (
          <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />
        ) : (
          <List
            dataSource={drillDownData.clients}
            locale={{ emptyText: 'Нет клиентов в этой когорте' }}
            renderItem={(c) => (
              <List.Item
                key={c.clientId}
                onClick={() => setQuickViewClientId(c.clientId)}
                style={{
                  cursor: 'pointer',
                  opacity: c.active ? 1 : 0.55,
                  padding: '10px 8px',
                  borderRadius: 8,
                }}
              >
                <List.Item.Meta
                  title={
                    <Space wrap size={6}>
                      <span style={{ fontWeight: 600 }}>{c.companyName}</span>
                      {c.active ? (
                        <Tag color="green">Купил · {formatUZS(c.revenueThisMonth)}</Tag>
                      ) : (
                        <Tag>Не покупал в этом месяце</Tag>
                      )}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2} style={{ fontSize: 12 }}>
                      {!c.active && (
                        <span>
                          Последняя покупка: {c.lastPurchaseAt ? dayjs(c.lastPurchaseAt).format('DD.MM.YYYY') : '—'}
                        </span>
                      )}
                      <span>
                        {c.lastContactAt
                          ? `Посл. контакт: ${dayjs(c.lastContactAt).format('DD.MM.YYYY')} · ${c.lastContactByName}`
                          : 'Контакта с клиентом ещё не было'}
                      </span>
                    </Space>
                  }
                />
                {c.phone && (
                  <Space size={10} onClick={(e) => e.stopPropagation()}>
                    <a href={`tel:${c.phone}`}>
                      <PhoneOutlined /> {c.phone}
                    </a>
                    <a href={telegramLinkFromPhone(c.phone)} target="_blank" rel="noreferrer" title="Написать в Telegram">
                      <SendOutlined style={{ color: '#229ED9' }} />
                    </a>
                  </Space>
                )}
              </List.Item>
            )}
          />
        )}
      </Drawer>

      <ClientQuickViewDrawer clientId={quickViewClientId} onClose={() => setQuickViewClientId(null)} />

      <Tour
        open={tourOpen}
        onClose={closeTour}
        onFinish={closeTour}
        steps={tourSteps}
        type="primary"
        mask={{
          style: { backdropFilter: 'blur(3px)' },
        }}
      />
    </div>
  );
}
