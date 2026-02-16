import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Button, Typography, message, Tag, Popconfirm } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import DealStatusTag from '../components/DealStatusTag';
import { formatUZS } from '../utils/currency';
import type { Deal, PaymentStatus } from '../types';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

export default function DealClosingPage() {
  const queryClient = useQueryClient();

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', 'SHIPPED'],
    queryFn: () => dealsApi.list('SHIPPED'),
  });

  const closeMut = useMutation({
    mutationFn: (dealId: string) => dealsApi.update(dealId, { status: 'CLOSED' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      message.success('Сделка закрыта');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка закрытия';
      message.error(msg);
    },
  });

  const columns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Статус', dataIndex: 'status', render: (s: Deal['status']) => <DealStatusTag status={s} /> },
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
    { title: 'Дата', dataIndex: 'updatedAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    {
      title: '',
      width: 140,
      render: (_: unknown, r: Deal) => (
        <Popconfirm title="Закрыть сделку?" onConfirm={() => closeMut.mutate(r.id)}>
          <Button type="primary" size="small" icon={<CheckCircleOutlined />} loading={closeMut.isPending}>
            Закрыть
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>Закрытие сделок</Typography.Title>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Сделки со статусом «Отгружена». Нажмите «Закрыть» для перевода в статус «Закрыта».
      </Typography.Text>

      <Table
        dataSource={deals}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20 }}
        size="middle"
        bordered={false}
        locale={{ emptyText: 'Нет сделок для закрытия' }}
      />
    </div>
  );
}
