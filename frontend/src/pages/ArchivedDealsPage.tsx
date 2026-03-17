import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Button, Typography, message, Popconfirm, Tag, Space, Card } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import DealStatusTag from '../components/DealStatusTag';
import { useAuthStore } from '../store/authStore';
import { formatUZS } from '../utils/currency';
import type { Deal, DealStatus, PaymentStatus } from '../types';
import dayjs from 'dayjs';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

export default function ArchivedDealsPage() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canUnarchive = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals-archived'],
    queryFn: () => dealsApi.listArchived(),
  });

  const unarchiveMut = useMutation({
    mutationFn: (id: string) => dealsApi.unarchive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals-archived'] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      message.success('Сделка разархивирована');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const columns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Статус', dataIndex: 'status', render: (s: DealStatus) => <DealStatusTag status={s} /> },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Оплата', dataIndex: 'paymentStatus', render: (s: PaymentStatus) => {
        const cfg = paymentStatusLabels[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    {
      title: 'Архивировал',
      dataIndex: ['archivedBy', 'fullName'],
      render: (v: string) => v || '—',
    },
    {
      title: 'Дата архивации',
      dataIndex: 'archivedAt',
      render: (v: string) => v ? dayjs(v).format('DD.MM.YYYY HH:mm') : '—',
    },
    ...(canUnarchive
      ? [{
        title: '',
        width: 50,
        render: (_: unknown, r: Deal) => (
          <Popconfirm title="Разархивировать сделку?" onConfirm={() => unarchiveMut.mutate(r.id)}>
            <Button type="text" icon={<UndoOutlined />} size="small" />
          </Popconfirm>
        ),
      }]
      : []),
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Архив сделок</Typography.Title>
        <Tag>{deals?.length ?? 0}</Tag>
      </Space>

      {isMobile ? (
        <MobileCardList
          data={deals ?? []}
          rowKey="id"
          loading={isLoading}
          renderCard={(deal: Deal) => (
            <Card size="small" bordered>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/deals/${deal.id}`}><Typography.Text strong>{deal.title}</Typography.Text></Link>
                  <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{deal.client?.companyName}</Typography.Text></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Typography.Text strong>{formatUZS(deal.amount)}</Typography.Text>
                  <div><DealStatusTag status={deal.status} /></div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{deal.updatedAt ? dayjs(deal.updatedAt).format('DD.MM.YYYY') : ''}</Typography.Text>
                {canUnarchive && (
                  <Popconfirm title="Разархивировать?" onConfirm={() => unarchiveMut.mutate(deal.id)}>
                    <Button type="text" icon={<UndoOutlined />} size="small" />
                  </Popconfirm>
                )}
              </div>
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={deals}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          size="middle"
          bordered={false}
          scroll={{ x: 600 }}
        />
      )}
    </div>
  );
}
