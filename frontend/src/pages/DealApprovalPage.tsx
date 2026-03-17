import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography, Tag, Button, Modal, Input, message, Space, Badge, Card } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import type { Deal, PaymentStatus } from '../types';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

export default function DealApprovalPage() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectDealId, setRejectDealId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', 'deal-approval-queue'],
    queryFn: () => dealsApi.dealApprovalQueue(),
  });

  const approveMutation = useMutation({
    mutationFn: (dealId: string) => dealsApi.approveDeal(dealId),
    onSuccess: () => {
      message.success('Сделка одобрена и готова к отгрузке');
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
    onError: () => {
      message.error('Ошибка при одобрении сделки');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ dealId, reason }: { dealId: string; reason: string }) =>
      dealsApi.rejectDeal(dealId, reason),
    onSuccess: () => {
      message.success('Сделка отклонена и возвращена в работу');
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      setRejectModalOpen(false);
      setRejectDealId(null);
      setRejectReason('');
    },
    onError: () => {
      message.error('Ошибка при отклонении сделки');
    },
  });

  const handleRejectClick = (dealId: string) => {
    setRejectDealId(dealId);
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const handleRejectConfirm = () => {
    if (!rejectDealId || !rejectReason.trim()) {
      message.warning('Укажите причину отклонения');
      return;
    }
    rejectMutation.mutate({ dealId: rejectDealId, reason: rejectReason.trim() });
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 80,
      render: (v: string) => v.slice(0, 8),
    },
    {
      title: 'Сделка',
      dataIndex: 'title',
      render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link>,
    },
    {
      title: 'Клиент',
      dataIndex: ['client', 'companyName'],
    },
    {
      title: 'Менеджер',
      dataIndex: ['manager', 'fullName'],
    },
    {
      title: 'Сумма сделки',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Оплачено',
      dataIndex: 'paidAmount',
      align: 'right' as const,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Оплата',
      dataIndex: 'paymentStatus',
      render: (s: PaymentStatus) => {
        const cfg = paymentStatusLabels[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Создана',
      dataIndex: 'createdAt',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Завершена',
      dataIndex: 'updatedAt',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 200,
      render: (_: unknown, r: Deal) => (
        <Space>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            size="small"
            loading={approveMutation.isPending}
            onClick={() => approveMutation.mutate(r.id)}
          >
            Одобрить
          </Button>
          <Button
            danger
            icon={<CloseOutlined />}
            size="small"
            onClick={() => handleRejectClick(r.id)}
          >
            Отклонить
          </Button>
        </Space>
      ),
    },
  ];

  const count = deals?.length ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>Одобрение сделок</Typography.Title>
          {count > 0 && <Badge count={count} style={{ backgroundColor: '#faad14' }} />}
        </Space>
      </div>

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
                <Typography.Text strong>{formatUZS(deal.amount)}</Typography.Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <Tag color={paymentStatusLabels[deal.paymentStatus]?.color}>{paymentStatusLabels[deal.paymentStatus]?.label}</Tag>
                <Space size="small">
                  <Button type="primary" icon={<CheckOutlined />} size="small" loading={approveMutation.isPending} onClick={() => approveMutation.mutate(deal.id)}>OK</Button>
                  <Button danger icon={<CloseOutlined />} size="small" onClick={() => handleRejectClick(deal.id)} />
                </Space>
              </div>
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={deals ?? []}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          size="middle"
          bordered={false}
          scroll={{ x: 600 }}
          locale={{ emptyText: 'Нет сделок, ожидающих одобрения' }}
        />
      )}

      <Modal
        title="Отклонить сделку"
        open={rejectModalOpen}
        onOk={handleRejectConfirm}
        onCancel={() => {
          setRejectModalOpen(false);
          setRejectDealId(null);
          setRejectReason('');
        }}
        okText="Отклонить"
        cancelText="Отмена"
        okButtonProps={{ danger: true, loading: rejectMutation.isPending }}
      >
        <Typography.Text>Укажите причину отклонения:</Typography.Text>
        <Input.TextArea
          rows={3}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Причина отклонения..."
          style={{ marginTop: 8 }}
        />
      </Modal>
    </div>
  );
}
