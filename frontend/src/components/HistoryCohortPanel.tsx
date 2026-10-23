import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tooltip, Select, Space, Typography, Spin, Drawer, theme } from 'antd';
import { analyticsApi } from '../api/analytics.api';
import CohortClientsList from './CohortClientsList';

const MONTH_LABELS: Record<number, string> = {
  1: 'Янв', 2: 'Фев', 3: 'Мар', 4: 'Апр', 5: 'Май', 6: 'Июн',
  7: 'Июл', 8: 'Авг', 9: 'Сен', 10: 'Окт', 11: 'Ноя', 12: 'Дек',
};

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

type CohortCell = { cohortMonth: number; activeMonth: number; lost: boolean };

/** Открытая ячейка в URL (`cohortCell=1-10-lost`): после «Назад» из карточки клиента список открыт снова. */
function parseCell(raw: string | null): CohortCell | null {
  const m = raw?.match(/^(\d{1,2})-(\d{1,2})(-lost)?$/);
  return m ? { cohortMonth: Number(m[1]), activeMonth: Number(m[2]), lost: !!m[3] } : null;
}

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = [currentYear, currentYear - 1, currentYear - 2].map((y) => ({ label: String(y), value: y }));

/**
 * Когортный анализ (простая таблица количества клиентов по когорта/месяц-активности внутри года).
 * Общий для «Аналитика история», «Аналитика» и «Аналитика для менеджеров» — если `year` не передан,
 * панель сама показывает свой селектор года. Данные скоупятся по менеджеру автоматически на бэкенде
 * (ownerScope) — для роли MANAGER видна только своя когорта.
 *
 * Верхняя «лесенка» (строка = когорта, столбец = месяц) — сколько клиентов когорты купили.
 * Нижняя «лесенка» зеркальная (столбец = когорта, строка = месяц) — сколько клиентов когорты
 * в этом месяце НЕ купили: размер когорты минус купившие.
 */
export default function HistoryCohortPanel({ year: controlledYear, fetchEnabled = true }: { year?: number; fetchEnabled?: boolean }) {
  const { token } = theme.useToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const internalYear = Number(searchParams.get('cohortYear')) || currentYear;
  const year = controlledYear ?? internalYear;
  const cohortDrawer = parseCell(searchParams.get('cohortCell'));

  const patchUrl = (patch: Record<string, string | null>) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  const setInternalYear = (y: number) => patchUrl({ cohortYear: y === currentYear ? null : String(y), cohortCell: null });
  const setCohortDrawer = (cell: CohortCell | null) =>
    patchUrl({ cohortCell: cell ? `${cell.cohortMonth}-${cell.activeMonth}${cell.lost ? '-lost' : ''}` : null });
  const cohortClientsKey = ['analytics-history-cohort-clients', cohortDrawer?.cohortMonth, cohortDrawer?.activeMonth, cohortDrawer?.lost, year];

  const { data: extended, isLoading } = useQuery({
    queryKey: ['analytics-history-extended-cohort', year],
    queryFn: () => analyticsApi.getHistoryExtended(year),
    staleTime: 120_000,
    enabled: fetchEnabled,
  });

  const { data: cohortClientsData, isLoading: cohortClientsLoading } = useQuery({
    queryKey: cohortClientsKey,
    queryFn: () => analyticsApi.getHistoryCohortClients(cohortDrawer!.cohortMonth, cohortDrawer!.activeMonth, year, cohortDrawer!.lost),
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
          const maxCount = Math.max(...Array.from(cohortMap.values()));

          const renderLost = (cohort: number, month: number) => {
            const size = cohortMap.get(`${cohort}-${cohort}`) || 0;
            if (!size) return <span style={{ color: token.colorTextDisabled }}>—</span>;
            const lost = size - (cohortMap.get(`${cohort}-${month}`) || 0);
            const share = lost / size;
            return (
              <Tooltip title={`Когорта ${MONTH_LABELS[cohort]}: в ${MONTH_LABELS[month]} не купили ${lost} из ${size} (${Math.round(share * 100)}%)`}>
                <div
                  style={{ backgroundColor: `rgba(245,34,45,${0.08 + share * 0.5})`, borderRadius: 3, padding: '4px 0', textAlign: 'center', fontWeight: 600, color: share > 0.6 ? '#fff' : token.colorText, cursor: lost ? 'pointer' : undefined }}
                  onClick={lost ? () => setCohortDrawer({ cohortMonth: cohort, activeMonth: month, lost: true }) : undefined}
                >{lost}</div>
              </Tooltip>
            );
          };

          const columns = [
            { title: 'Когорта', key: 'cohort', width: 80, render: (_: unknown, record: { cohort: number }) => MONTH_LABELS[record.cohort] },
            ...activeMonths.map((am) => ({
              title: MONTH_LABELS[am], key: `a${am}`, width: 60, align: 'center' as const,
              render: (_: unknown, record: { cohort: number }) => {
                // Ниже диагонали: столбец am — когорта, строка — месяц, в котором она не купила.
                if (am < record.cohort) return renderLost(am, record.cohort);
                const count = cohortMap.get(`${record.cohort}-${am}`) || 0;
                if (!count) return <span style={{ color: token.colorTextDisabled }}>—</span>;
                const intensity = maxCount > 0 ? count / maxCount : 0;
                return (
                  <Tooltip title={`${MONTH_LABELS[record.cohort]} → ${MONTH_LABELS[am]}: ${count} клиентов`}>
                    <div
                      style={{ backgroundColor: `rgba(22,119,255,${0.1 + intensity * 0.8})`, borderRadius: 3, padding: '4px 0', textAlign: 'center', fontWeight: 600, color: intensity > 0.5 ? '#fff' : token.colorText, cursor: 'pointer' }}
                      onClick={() => setCohortDrawer({ cohortMonth: record.cohort, activeMonth: am, lost: false })}
                    >{count}</div>
                  </Tooltip>
                );
              },
            })),
          ];
          const dataSource = cohortMonths.map((c) => ({ cohort: c, key: c }));

          const totalClients = cohortMonths.reduce((sum, c) => sum + (cohortMap.get(`${c}-${c}`) || 0), 0);
          const totalRevenue = extended.cohort.reduce((sum, r) => sum + r.revenueTotal, 0);
          const retentionRates: number[] = [];
          for (const c of cohortMonths) {
            const initial = cohortMap.get(`${c}-${c}`) || 0;
            const next = cohortMap.get(`${c}-${c + 1}`);
            if (initial > 0 && next !== undefined) retentionRates.push(next / initial);
          }
          const avgRetention = retentionRates.length
            ? Math.round((retentionRates.reduce((a, b) => a + b, 0) / retentionRates.length) * 100)
            : null;

          const monthTotals = activeMonths.map((am) =>
            cohortMonths.reduce((sum, c) => sum + (cohortMap.get(`${c}-${am}`) || 0), 0)
          );

          return (
            <>
              <Table
                dataSource={dataSource}
                columns={columns}
                size="small"
                pagination={false}
                scroll={{ x: 600 }}
                summary={() => (
                  <Table.Summary>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0}>
                        <Typography.Text strong>Итого</Typography.Text>
                      </Table.Summary.Cell>
                      {activeMonths.map((am, i) => (
                        <Table.Summary.Cell key={am} index={i + 1} align="center">
                          <Typography.Text strong>{monthTotals[i] ? fmtNum(monthTotals[i]) : '—'}</Typography.Text>
                        </Table.Summary.Cell>
                      ))}
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                Синие ячейки (строка — когорта): сколько клиентов когорты купили в месяце. Красные ячейки (столбец — когорта,
                строка — месяц): сколько клиентов этой когорты в том месяце не купили. Когорта — месяц первой покупки в {year} году.
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
                Итого: клиентов за год — {fmtNum(totalClients)}, суммарная выручка когорт — {fmtNum(totalRevenue)}
                {avgRetention !== null ? `, среднее удержание на месяц+1 — ${avgRetention}%` : ''}.
              </Typography.Paragraph>
            </>
          );
        })()
      )}

      <Drawer
        title={cohortDrawer
          ? cohortDrawer.lost
            ? `Когорта ${MONTH_LABELS[cohortDrawer.cohortMonth]}: не купили в ${MONTH_LABELS[cohortDrawer.activeMonth]} ${year}`
            : `Когорта ${MONTH_LABELS[cohortDrawer.cohortMonth]} → ${MONTH_LABELS[cohortDrawer.activeMonth]} ${year}`
          : ''}
        open={!!cohortDrawer} onClose={() => setCohortDrawer(null)} width="100%"
      >
        {cohortClientsLoading ? <Spin /> : cohortClientsData?.clients ? (
          <CohortClientsList clients={cohortClientsData.clients} lost={!!cohortDrawer?.lost} queryKey={cohortClientsKey} />
        ) : null}
      </Drawer>
    </Card>
  );
}
