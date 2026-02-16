import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Button, Typography, message, Card, Row, Col, Statistic, Popconfirm, Tag } from 'antd';
import { CalendarOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { financeApi } from '../api/finance.api';
import { useAuthStore } from '../store/authStore';
import { formatUZS } from '../utils/currency';
import type { DailyClosing, Deal, PaymentStatus } from '../types';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

export default function DayClosingPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['day-closings'],
    queryFn: () => financeApi.getDayClosings(),
  });

  const closeDayMut = useMutation({
    mutationFn: () => financeApi.closeDay(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['day-closings'] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      message.success('День закрыт');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка закрытия дня';
      message.error(msg);
    },
  });

  const closings = data?.closings || [];

  const expandedRowRender = (closing: DailyClosing) => {
    const deals = closing.deals || [];
    const dealColumns = [
      { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
      { title: 'Клиент', dataIndex: ['client', 'companyName'] },
      { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
      {
        title: 'Оплата',
        dataIndex: 'paymentStatus',
        render: (s: PaymentStatus) => {
          const cfg = paymentStatusLabels[s] || { color: 'default', label: s };
          return <Tag color={cfg.color}>{cfg.label}</Tag>;
        },
      },
      { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    ];

    return (
      <Table
        dataSource={deals}
        columns={dealColumns}
        rowKey="id"
        pagination={false}
        size="small"
      />
    );
  };

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'date',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Сделок закрыто',
      dataIndex: 'closedDealsCount',
      align: 'center' as const,
    },
    {
      title: 'Общая сумма',
      dataIndex: 'totalAmount',
      align: 'right' as const,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Закрыл',
      dataIndex: ['closedBy', 'fullName'],
    },
    {
      title: 'Время',
      dataIndex: 'createdAt',
      render: (v: string) => dayjs(v).format('HH:mm'),
    },
  ];

  const todayClosing = closings.find((c) => dayjs(c.date).isSame(dayjs(), 'day'));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Закрытие дня</Typography.Title>
        {isAdmin && (
          <Popconfirm
            title="Закрыть день?"
            description="Все сделки со статусом «Закрыта» будут записаны в отчёт."
            onConfirm={() => closeDayMut.mutate()}
          >
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={closeDayMut.isPending}
            >
              Закрыть день
            </Button>
          </Popconfirm>
        )}
      </div>

      {todayClosing && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="Сегодня закрыто сделок"
                value={todayClosing.closedDealsCount}
                prefix={<CalendarOutlined />}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="Сумма за сегодня"
                value={formatUZS(todayClosing.totalAmount)}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="Закрыл"
                value={todayClosing.closedBy?.fullName || '—'}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Table
        dataSource={closings}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20 }}
        size="middle"
        bordered={false}
        expandable={{ expandedRowRender }}
        locale={{ emptyText: 'Нет записей о закрытии дня' }}
      />
    </div>
  );
}
