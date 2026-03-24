import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, Select, Spin, Table, Tooltip, Tag, Typography, theme } from 'antd';
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
  const [selectedClients, setSelectedClients] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['manager-client-activity', year],
    queryFn: () => analyticsApi.getHistory(year),
  });

  const clientActivity = data?.clientActivity ?? [];
  const visibleMonths = useMemo(() => {
    if (!data?.monthlyTrend?.length) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const maxMonth = Math.max(...data.monthlyTrend.map((m) => m.month));
    return Array.from({ length: maxMonth }, (_, i) => i + 1);
  }, [data?.monthlyTrend]);

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
    ...visibleMonths.map((m) => ({
      title: MONTH_LABELS[m],
      key: `m${m}`,
      width: 76,
      align: 'center' as const,
      render: (_: unknown, record: HistoryClientActivity) => {
        const revenue = getMonthRevenue(record, m);
        const bgColor = getRevenueColor(revenue);
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
              }}
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
              onChange={setYear}
              style={{ width: 110 }}
              options={[2024, 2025, 2026, 2027].map((y) => ({ label: y, value: y }))}
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
                  {visibleMonths.map((m) => {
                    const revenue = getMonthRevenue(record, m);
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
                        }}>
                          {MONTH_LABELS[m]}
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
    </div>
  );
}

