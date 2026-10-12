import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Typography, Spin, Button, Card, Space, DatePicker, Segmented } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import dayjs, { type Dayjs } from 'dayjs';
import { dashboardApi } from '../api/warehouse.api';
import { formatUZS } from '../utils/currency';
import type { RevenueTodayPayment } from '../types';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import ReceiptPunchedTag from '../components/ReceiptPunchedTag';
import { getFirstName } from '../lib/name-utils';
import { useAuthStore } from '../store/authStore';
import RevenueByManagers from '../components/RevenueByManagers';

type View = 'managers' | 'lines';

export default function RevenueTodayPage() {
  const isMobile = useIsMobile();
  const role = useAuthStore((s) => s.user?.role);
  // HR смотрит, кто и что продал, — ей сразу разбивка по менеджерам.
  const [view, setView] = useState<View>(role === 'HR' ? 'managers' : 'lines');
  const [date, setDate] = useState<Dayjs>(dayjs());
  const isToday = date.isSame(dayjs(), 'day');
  const dateParam = isToday ? undefined : date.format('YYYY-MM-DD');

  const { data, isLoading } = useQuery({
    queryKey: ['revenue-today', dateParam ?? 'today'],
    queryFn: () => dashboardApi.revenueToday(dateParam),
    refetchInterval: isToday ? 60_000 : false,
  });

  // Прошлый день — для сравнения в виде «По менеджерам».
  const prevDate = date.subtract(1, 'day');
  const prevParam = prevDate.format('YYYY-MM-DD');
  const { data: prevData } = useQuery({
    queryKey: ['revenue-today', prevParam],
    queryFn: () => dashboardApi.revenueToday(prevParam),
    enabled: view === 'managers',
    staleTime: 5 * 60_000,
  });
  const curLabel = isToday ? 'Сегодня' : date.format('DD.MM');
  const prevLabel = isToday ? 'Вчера' : prevDate.format('DD.MM');

  const columns = [
    {
      title: 'Время',
      dataIndex: 'paidAt',
      width: 80,
      render: (v: string) => dayjs(v).format('HH:mm'),
    },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, r: RevenueTodayPayment) => <ClientCompanyDisplay client={r.client} link />,
    },
    {
      title: 'Сделка',
      dataIndex: ['deal', 'title'],
      render: (v: string, r: RevenueTodayPayment) => (
        <Space size={4} wrap>
          {r.deal.id ? <Link to={`/deals/${r.deal.id}`}>{v}</Link> : <span>{v}</span>}
          <ReceiptPunchedTag isReceiptPunched={r.deal.isReceiptPunched} />
        </Space>
      ),
    },
    {
      title: 'Менеджер',
      dataIndex: ['creator', 'fullName'],
      render: (v: string) => getFirstName(v) || v,
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Способ оплаты',
      dataIndex: 'method',
      width: 140,
      render: (v: string | null) => v || '—',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link to="/dashboard">
          <Button type="text" icon={<ArrowLeftOutlined />} />
        </Link>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Выручка за {isToday ? 'сегодня' : date.format('DD.MM.YYYY')}
        </Typography.Title>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: 'managers', label: 'По менеджерам' },
            { value: 'lines', label: 'Все продажи' },
          ]}
        />
        <DatePicker
          value={date}
          onChange={(v) => v && setDate(v)}
          format="DD.MM.YYYY"
          allowClear={false}
          disabledDate={(d) => d.isAfter(dayjs(), 'day')}
        />
        {!isToday && <Button onClick={() => setDate(dayjs())}>Сегодня</Button>}
      </Space>

      <Card bordered={false}>
        {isLoading || !data ? (
          <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />
        ) : view === 'managers' ? (
          <RevenueByManagers
            payments={data.payments}
            total={data.total}
            prevPayments={prevData?.payments}
            curLabel={curLabel}
            prevLabel={prevLabel}
          />
        ) : isMobile ? (
          <>
            <MobileCardList
              data={data.payments}
              rowKey="id"
              renderCard={(p: RevenueTodayPayment) => (
                <Card size="small" bordered>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography.Text strong>{formatUZS(p.amount)}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(p.paidAt).format('HH:mm')}</Typography.Text>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <Space size={4} wrap>
                      {p.deal.id ? (
                        <Link to={`/deals/${p.deal.id}`}>
                          <Typography.Text style={{ fontSize: 12 }}>{p.deal.title}</Typography.Text>
                        </Link>
                      ) : (
                        <Typography.Text style={{ fontSize: 12 }}>{p.deal.title}</Typography.Text>
                      )}
                      <ReceiptPunchedTag isReceiptPunched={p.deal.isReceiptPunched} />
                    </Space>
                  </div>
                  <div style={{ fontSize: 11 }}>
                    <ClientCompanyDisplay client={p.client} secondary />
                    <Typography.Text type="secondary"> · {p.method || '—'}</Typography.Text>
                  </div>
                </Card>
              )}
            />
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Typography.Text strong style={{ fontSize: 16, color: '#52c41a' }}>Итого: {formatUZS(data.total)}</Typography.Text>
            </div>
          </>
        ) : (
          <Table
            dataSource={data.payments}
            columns={columns}
            rowKey="id"
            pagination={false}
            size="middle"
            bordered={false}
            scroll={{ x: 600 }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}>
                  <strong>Итого</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <strong style={{ color: '#52c41a' }}>{formatUZS(data.total)}</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} />
              </Table.Summary.Row>
            )}
          />
        )}
      </Card>
    </div>
  );
}
