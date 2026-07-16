import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Table, Typography, Spin, Select, Space, Tooltip, Empty, theme } from 'antd';
import { TeamOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { Line } from '@ant-design/charts';
import dayjs from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { formatUZS } from '../utils/currency';
import type { UserRole, CohortRow } from '../types';

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

  const { data: cohortData, isLoading: cohortLoading } = useQuery({
    queryKey: ['analytics-cohorts', managerId],
    queryFn: () => analyticsApi.getCohorts(managerId),
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

  const heatmapColumns = useMemo(() => {
    const base = [
      {
        title: 'Когорта',
        dataIndex: 'cohortMonth',
        key: 'cohortMonth',
        fixed: 'left' as const,
        width: 110,
        render: (v: string) => dayjs(`${v}-01`).format('MMM YYYY'),
      },
      { title: 'Клиентов', dataIndex: 'cohortSize', key: 'cohortSize', width: 90, align: 'right' as const },
    ];
    const offsetCols = offsetColumns.map((offset) => ({
      title: `M${offset}`,
      key: `m${offset}`,
      width: 64,
      align: 'center' as const,
      render: (_: unknown, record: CohortRow) => {
        const elapsed = monthsElapsed(record.cohortMonth);
        if (offset > elapsed) {
          return <span style={{ color: token.colorTextQuaternary }}>—</span>;
        }
        const point = record.points.find((p) => p.monthOffset === offset);
        const percent = point?.retentionPercent ?? 0;
        const alpha = Math.min(1, Math.max(0.08, percent / 100));
        return (
          <Tooltip
            title={
              point
                ? `${point.activeClients} из ${record.cohortSize} клиентов · выручка ${formatUZS(point.revenue)}`
                : `0 из ${record.cohortSize} клиентов`
            }
          >
            <div
              style={{
                backgroundColor: `rgba(82, 196, 26, ${alpha})`,
                color: alpha > 0.55 ? '#fff' : token.colorText,
                borderRadius: 4,
                padding: '2px 0',
                fontWeight: 500,
              }}
            >
              {percent}%
            </div>
          </Tooltip>
        );
      },
    }));
    return [...base, ...offsetCols];
  }, [offsetColumns, token]);

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

  return (
    <div>
      <Typography.Paragraph type="secondary">
        <strong>Когорта</strong> — клиенты, сгруппированные по месяцу первой покупки (за всё время). <strong>M0</strong> — месяц первой
        покупки, <strong>M1</strong> — следующий месяц и т.д. Retention % — доля клиентов когорты, купивших что-либо в этот месяц
        (не обязательно каждый месяц подряд). Показаны последние 24 когорты.
      </Typography.Paragraph>
      {!isManagerRole && (
        <Card size="small" bordered={false} style={{ marginBottom: 16 }} bodyStyle={{ paddingBottom: 12 }}>
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
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
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
                      Retention M1
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
                      Retention M3
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

          <Card title="Выручка на клиента когорты (LTV), накопительно" bordered={false}>
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
    </div>
  );
}
