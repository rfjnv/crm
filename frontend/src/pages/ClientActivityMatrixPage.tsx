import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, Select, Spin, Table, Tooltip, Tag, Typography, theme, Drawer } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import { analyticsApi } from '../api/analytics.api';
import { useIsMobile } from '../hooks/useIsMobile';
import type { HistoryClientActivity } from '../types';

const { Title } = Typography;

const MONTH_LABELS: Record<number, string> = {
  1: 'Янв', 2: 'Фев', 3: 'Мар', 4: 'Апр', 5: 'Май', 6: 'Июн',
  7: 'Июл', 8: 'Авг', 9: 'Сен', 10: 'Окт', 11: 'Ноя', 12: 'Дек',
};

export default function ClientActivityMatrixPage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [cellDrawer, setCellDrawer] = useState<{ clientId: string; clientName: string; month: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['manager-client-activity', year],
    queryFn: () => analyticsApi.getHistory(year),
  });

  const { data: clientMonthData, isLoading: clientMonthLoading } = useQuery({
    queryKey: ['manager-client-activity-client-month', cellDrawer?.clientId, cellDrawer?.month, year],
    queryFn: () => analyticsApi.getHistoryClientMonth(cellDrawer!.clientId, cellDrawer!.month, year),
    enabled: !!cellDrawer,
  });

  const clientActivity = data?.clientActivity ?? [];
  const visibleMonths = useMemo(() => {
    if (!data?.monthlyTrend?.length) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const maxMonth = Math.max(...data.monthlyTrend.map((m) => m.month));
    return Array.from({ length: maxMonth }, (_, i) => i + 1);
  }, [data?.monthlyTrend]);

  const displayedMonths = useMemo(() => {
    if (selectedMonths.length === 0) return visibleMonths;
    const available = new Set(visibleMonths);
    return selectedMonths.filter((m) => available.has(m)).sort((a, b) => a - b);
  }, [selectedMonths, visibleMonths]);

  const filteredActivity = useMemo(() => {
    if (selectedClients.length === 0) return clientActivity;
    return clientActivity.filter((c) => selectedClients.includes(c.clientId));
  }, [clientActivity, selectedClients]);

  const maxMonthRevenue = useMemo(() => {
    const all = clientActivity.flatMap((c) => c.monthlyData.map((m) => m.revenue));
    return all.reduce((a, b) => Math.max(a, b), 1);
  }, [clientActivity]);

  function getMonthRevenue(record: HistoryClientActivity, month: number): number {
    const m = record.monthlyData.find((d) => d.month === month);
    return m ? m.revenue : 0;
  }

  function getRevenueColor(revenue: number): string {
    if (revenue <= 0) return '#f5f5f5';
    const intensity = Math.min(revenue / maxMonthRevenue, 1);
    return `rgba(56,218,17,${0.2 + intensity * 0.8})`;
  }

  const activityCols = [
    {
      title: 'Клиент',
      dataIndex: 'companyName',
      key: 'companyName',
      fixed: 'left' as const,
      width: 260,
      render: (_: string, r: HistoryClientActivity) => (
        <a onClick={() => navigate(`/clients/${r.clientId}`)}>{r.companyName}</a>
      ),
    },
    ...displayedMonths.map((m) => ({
      title: MONTH_LABELS[m],
      key: `m${m}`,
      width: 76,
      align: 'center' as const,
      render: (_: unknown, record: HistoryClientActivity) => {
        const revenue = getMonthRevenue(record, m);
        const bgColor = getRevenueColor(revenue);
        const isClickable = revenue > 0;
        const intensity = revenue > 0 ? Math.min(revenue / maxMonthRevenue, 1) : 0;
        return (
          <Tooltip title={revenue > 0 ? revenue.toLocaleString('ru-RU') : 'Нет данных'}>
            <div
              style={{
                width: 34,
                height: 26,
                borderRadius: 6,
                margin: '0 auto',
                backgroundColor: bgColor,
                color: intensity > 0.5 ? '#fff' : token.colorTextSecondary,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isClickable ? 'pointer' : 'default',
              }}
              onClick={isClickable ? () => setCellDrawer({ clientId: record.clientId, clientName: record.companyName, month: m }) : undefined}
            >
              {revenue > 0 ? '●' : '—'}
            </div>
          </Tooltip>
        );
      },
    })),
    {
      title: 'Активные',
      key: 'active',
      width: 100,
      render: (_: unknown, r: HistoryClientActivity) => <Tag color="blue">{r.activeMonths.length} мес.</Tag>,
    },
  ];

  if (isLoading) {
    return <div style={{ textAlign: 'center', marginTop: 120 }}><Spin size="large" /></div>;
  }

  return (
    <div>
      <Title level={4} style={{ marginBottom: 12 }}><CalendarOutlined /> Матрица активности клиентов</Title>
      <Card
        size="small"
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select
              value={year}
              onChange={(nextYear) => {
                setYear(nextYear);
                setSelectedMonths([]);
              }}
              style={{ width: 110 }}
              options={[2024, 2025, 2026, 2027].map((y) => ({ label: y, value: y }))}
            />
            <Select
              mode="multiple"
              placeholder="Месяцы"
              allowClear
              style={{ width: isMobile ? 220 : 220 }}
              maxTagCount={2}
              value={selectedMonths}
              onChange={(vals) => setSelectedMonths(vals.sort((a, b) => a - b))}
              options={visibleMonths.map((m) => ({ label: MONTH_LABELS[m], value: m }))}
            />
            <Select
              mode="multiple"
              placeholder="Фильтр клиентов"
              allowClear
              showSearch
              style={{ width: isMobile ? 220 : 320 }}
              maxTagCount={2}
              value={selectedClients}
              onChange={setSelectedClients}
              options={clientActivity.map((c) => ({ label: c.companyName, value: c.clientId }))}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </div>
        )}
      >
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,0.2)' }} /> Мало</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,1)' }} /> Много</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: '#f5f5f5' }} /> Нет данных</span>
        </div>

        {isMobile ? (
          <div style={{ maxHeight: 560, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredActivity.map((record) => (
              <div key={record.clientId} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  <a onClick={() => navigate(`/clients/${record.clientId}`)}>{record.companyName}</a>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {displayedMonths.map((m) => {
                    const revenue = getMonthRevenue(record, m);
                    const isClickable = revenue > 0;
                    return (
                      <Tooltip key={m} title={`${MONTH_LABELS[m]}: ${revenue > 0 ? revenue.toLocaleString('ru-RU') : 'Нет данных'}`}>
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: 6,
                          backgroundColor: getRevenueColor(revenue),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 500,
                          cursor: isClickable ? 'pointer' : 'default',
                        }}>
                          <span
                            style={{ width: '100%', textAlign: 'center' }}
                            onClick={isClickable ? () => setCellDrawer({ clientId: record.clientId, clientName: record.companyName, month: m }) : undefined}
                          >
                            {MONTH_LABELS[m]}
                          </span>
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table
            dataSource={filteredActivity}
            columns={activityCols}
            rowKey="clientId"
            size="small"
            pagination={{ defaultPageSize: 20 }}
            scroll={{ x: 1000 }}
          />
        )}
      </Card>
      <Drawer
        title={cellDrawer ? `${cellDrawer.clientName} - ${MONTH_LABELS[cellDrawer.month]} ${year}` : ''}
        open={!!cellDrawer}
        onClose={() => setCellDrawer(null)}
        width="100%"
      >
        {clientMonthLoading ? (
          <Spin />
        ) : (
          <>
            <div style={{ marginBottom: 16, fontSize: 16, fontWeight: 600 }}>
              РС‚РѕРіРѕ: {(clientMonthData?.totalRevenue ?? 0).toLocaleString('ru-RU')}
            </div>
            <Table
              dataSource={clientMonthData?.items ?? []}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 700 }}
              columns={[
                { title: 'РўРѕРІР°СЂ', dataIndex: 'productName', key: 'productName', ellipsis: true },
                { title: 'Р•Рґ.', dataIndex: 'unit', key: 'unit', width: 60 },
                { title: 'РљРѕР»-РІРѕ', dataIndex: 'qty', key: 'qty', width: 90, render: (v: number) => v.toLocaleString('ru-RU') },
                { title: 'Р¦РµРЅР°', dataIndex: 'price', key: 'price', width: 100, render: (v: number) => Number(v || 0).toLocaleString('ru-RU') },
                { title: 'РС‚РѕРіРѕ', dataIndex: 'total', key: 'total', width: 120, render: (v: number) => Number(v || 0).toLocaleString('ru-RU') },
                { title: 'РЎРґРµР»РєР°', dataIndex: 'dealTitle', key: 'dealTitle', ellipsis: true },
                {
                  title: 'Р”Р°С‚Р°',
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  width: 110,
                  render: (v: string) => v ? new Date(v).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' }) : '—',
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
