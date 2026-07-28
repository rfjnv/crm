import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Tooltip, Select, Space, Typography, Spin, Drawer, theme } from 'antd';
import { analyticsApi } from '../api/analytics.api';

const MONTH_LABELS: Record<number, string> = {
  1: 'Янв', 2: 'Фев', 3: 'Мар', 4: 'Апр', 5: 'Май', 6: 'Июн',
  7: 'Июл', 8: 'Авг', 9: 'Сен', 10: 'Окт', 11: 'Ноя', 12: 'Дек',
};

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

const clickableRow = { cursor: 'pointer' };

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = [currentYear, currentYear - 1, currentYear - 2].map((y) => ({ label: String(y), value: y }));

/**
 * Когортный анализ (простая таблица количества клиентов по когорта/месяц-активности внутри года).
 * Общий для «Аналитика история», «Аналитика» и «Аналитика для менеджеров» — если `year` не передан,
 * панель сама показывает свой селектор года. Данные скоупятся по менеджеру автоматически на бэкенде
 * (ownerScope) — для роли MANAGER видна только своя когорта.
 */
export default function HistoryCohortPanel({ year: controlledYear, fetchEnabled = true }: { year?: number; fetchEnabled?: boolean }) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [internalYear, setInternalYear] = useState(currentYear);
  const year = controlledYear ?? internalYear;
  const [cohortDrawer, setCohortDrawer] = useState<{ cohortMonth: number; activeMonth: number } | null>(null);

  const { data: extended, isLoading } = useQuery({
    queryKey: ['analytics-history-extended-cohort', year],
    queryFn: () => analyticsApi.getHistoryExtended(year),
    staleTime: 120_000,
    enabled: fetchEnabled,
  });

  const { data: cohortClientsData, isLoading: cohortClientsLoading } = useQuery({
    queryKey: ['analytics-history-cohort-clients', cohortDrawer?.cohortMonth, cohortDrawer?.activeMonth, year],
    queryFn: () => analyticsApi.getHistoryCohortClients(cohortDrawer!.cohortMonth, cohortDrawer!.activeMonth, year),
    enabled: !!cohortDrawer,
  });

  return (
    <Card
      title="Когортный анализ"
      size="small"
      extra={
        controlledYear === undefined ? (
          <Space>
            <Typography.Text type="secondary">Год</Typography.Text>
            <Select value={internalYear} onChange={setInternalYear} options={YEAR_OPTIONS} style={{ width: 100 }} />
          </Space>
        ) : undefined
      }
    >
      {isLoading || !extended ? (
        <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />
      ) : (
        (() => {
          const cohortMonths = [...new Set(extended.cohort.map((r) => r.cohortMonth))].sort((a, b) => a - b);
          const activeMonths = [...new Set(extended.cohort.map((r) => r.activeMonth))].sort((a, b) => a - b);
          const cohortMap = new Map<string, number>();
          for (const r of extended.cohort) cohortMap.set(`${r.cohortMonth}-${r.activeMonth}`, r.clientCount);

          const columns = [
            { title: 'Когорта', key: 'cohort', width: 80, render: (_: unknown, record: { cohort: number }) => MONTH_LABELS[record.cohort] },
            ...activeMonths.map((am) => ({
              title: MONTH_LABELS[am], key: `a${am}`, width: 60, align: 'center' as const,
              render: (_: unknown, record: { cohort: number }) => {
                const count = cohortMap.get(`${record.cohort}-${am}`) || 0;
                if (!count) return <span style={{ color: token.colorTextDisabled }}>—</span>;
                const maxCount = Math.max(...Array.from(cohortMap.values()));
                const intensity = maxCount > 0 ? count / maxCount : 0;
                return (
                  <Tooltip title={`${MONTH_LABELS[record.cohort]} → ${MONTH_LABELS[am]}: ${count} клиентов`}>
                    <div
                      style={{ backgroundColor: `rgba(22,119,255,${0.1 + intensity * 0.8})`, borderRadius: 3, padding: '4px 0', textAlign: 'center', fontWeight: 600, color: intensity > 0.5 ? '#fff' : token.colorText, cursor: 'pointer' }}
                      onClick={() => setCohortDrawer({ cohortMonth: record.cohort, activeMonth: am })}
                    >{count}</div>
                  </Tooltip>
                );
              },
            })),
          ];
          const dataSource = cohortMonths.map((c) => ({ cohort: c, key: c }));
          return <Table dataSource={dataSource} columns={columns} size="small" pagination={false} scroll={{ x: 600 }} />;
        })()
      )}

      <Drawer
        title={cohortDrawer ? `Когорта ${MONTH_LABELS[cohortDrawer.cohortMonth]} → ${MONTH_LABELS[cohortDrawer.activeMonth]} ${year}` : ''}
        open={!!cohortDrawer} onClose={() => setCohortDrawer(null)} width="100%"
      >
        {cohortClientsLoading ? <Spin /> : cohortClientsData?.clients ? (
          <Table dataSource={cohortClientsData.clients} rowKey="clientId" size="small"
            pagination={false} scroll={{ x: 500 }}
            columns={[
              { title: '#', key: 'idx', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
              { title: 'Компания', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
              { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 80 },
              { title: 'Выручка', dataIndex: 'revenue', key: 'revenue', width: 140, render: (v: number) => fmtNum(v) },
            ]}
            onRow={(record) => ({ onClick: () => navigate(`/clients/${record.clientId}`), style: clickableRow })}
          />
        ) : null}
      </Drawer>
    </Card>
  );
}
