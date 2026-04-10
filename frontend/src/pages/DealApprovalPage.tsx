import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Table, Typography, Tag, Button, Modal, Input, message, Space, Badge, Card, Tabs } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import BackButton from '../components/BackButton';
import DealStatusTag from '../components/DealStatusTag';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'wm' ? 'wm' : 'approval';

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectDealId, setRejectDealId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [wmRejectId, setWmRejectId] = useState<string | null>(null);
  const [wmRejectReason, setWmRejectReason] = useState('');

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', 'deal-approval-queue'],
    queryFn: () => dealsApi.dealApprovalQueue(),
  });

  const { data: wmDeals = [], isLoading: wmLoading } = useQuery({
    queryKey: ['deals', 'wm-pending-admin'],
    queryFn: dealsApi.wmPendingAdmin,
    refetchInterval: 10_000,
  });

  const approveMutation = useMutation({
    mutationFn: (dealId: string) => dealsApi.approveDeal(dealId),
    onSuccess: () => {
      message.success('Сделка одобрена и готова к отгрузке');
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['deals', 'wm-pending-admin'] });
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
      queryClient.invalidateQueries({ queryKey: ['deals', 'wm-pending-admin'] });
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

  const wmApproveMut = useMutation({
    mutationFn: (dealId: string) => dealsApi.adminApproveNew(dealId),
    onSuccess: () => {
      message.success('Сделка одобрена');
      queryClient.invalidateQueries({ queryKey: ['deals', 'wm-pending-admin'] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['deals', 'deal-approval-queue'] });
    },
    onError: () => message.error('Ошибка при одобрении'),
  });

  const wmRejectMut = useMutation({
    mutationFn: ({ dealId, reason }: { dealId: string; reason: string }) =>
      dealsApi.adminRejectNew(dealId, reason),
    onSuccess: () => {
      message.success('Сделка отклонена');
      queryClient.invalidateQueries({ queryKey: ['deals', 'wm-pending-admin'] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['deals', 'deal-approval-queue'] });
      setWmRejectId(null);
      setWmRejectReason('');
    },
    onError: () => message.error('Ошибка при отклонении'),
  });

  const handleWmRejectConfirm = () => {
    if (!wmRejectId || !wmRejectReason.trim()) {
      message.warning('Укажите причину отклонения');
      return;
    }
    wmRejectMut.mutate({ dealId: wmRejectId, reason: wmRejectReason.trim() });
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
      key: 'client',
      render: (_: unknown, r: Deal) => <ClientCompanyDisplay client={r.client} link />,
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
  const wmCount = wmDeals.length;

  const wmColumns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, r: Deal) => <ClientCompanyDisplay client={r.client} link />,
    },
    { title: 'Сумма', dataIndex: 'amount', render: (v: string) => formatUZS(Number(v)) },
    { title: 'Статус', dataIndex: 'status', render: (v: Deal['status']) => <DealStatusTag status={v} /> },
    {
      title: 'Действия',
      key: 'actions',
      width: 200,
      render: (_: unknown, r: Deal) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            loading={wmApproveMut.isPending}
            onClick={() => wmApproveMut.mutate(r.id)}
          >
            Одобрить
          </Button>
          <Button danger size="small" icon={<CloseOutlined />} onClick={() => { setWmRejectId(r.id); setWmRejectReason(''); }}>
            Отклонить
          </Button>
        </Space>
      ),
    },
  ];

  const approvalTabLabel = (
    <span>
      Очередь одобрения
      {count > 0 ? <Badge count={count} size="small" style={{ marginLeft: 8 }} /> : null}
    </span>
  );

  const wmTabLabel = (
    <span>
      От зав. склада
      {wmCount > 0 ? <Badge count={wmCount} size="small" style={{ marginLeft: 8 }} /> : null}
    </span>
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space align="start">
          <BackButton fallback="/deals" />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>Одобрение</Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              Общая очередь и заявки, ожидающие решения администратора после зав. склада
            </Typography.Text>
          </div>
        </Space>
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => {
          if (key === 'wm') setSearchParams({ tab: 'wm' });
          else setSearchParams({});
        }}
        items={[
          {
            key: 'approval',
            label: approvalTabLabel,
            children: isMobile ? (
              <MobileCardList
                data={deals ?? []}
                rowKey="id"
                loading={isLoading}
                renderCard={(deal: Deal) => (
                  <Card size="small" bordered>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Link to={`/deals/${deal.id}`}><Typography.Text strong>{deal.title}</Typography.Text></Link>
                        <div style={{ fontSize: 12 }}><ClientCompanyDisplay client={deal.client} secondary /></div>
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
            ),
          },
          {
            key: 'wm',
            label: wmTabLabel,
            children: isMobile ? (
              <MobileCardList
                data={wmDeals}
                rowKey="id"
                loading={wmLoading}
                renderCard={(deal: Deal) => (
                  <Card size="small" bordered>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Link to={`/deals/${deal.id}`}><Typography.Text strong>{deal.title}</Typography.Text></Link>
                        <div style={{ fontSize: 12 }}><ClientCompanyDisplay client={deal.client} secondary /></div>
                      </div>
                      <DealStatusTag status={deal.status} />
                    </div>
                    <Typography.Text strong style={{ display: 'block', marginTop: 8 }}>{formatUZS(deal.amount)}</Typography.Text>
                    <Space style={{ marginTop: 8 }}>
                      <Button type="primary" size="small" icon={<CheckOutlined />} loading={wmApproveMut.isPending} onClick={() => wmApproveMut.mutate(deal.id)}>Одобрить</Button>
                      <Button danger size="small" icon={<CloseOutlined />} onClick={() => { setWmRejectId(deal.id); setWmRejectReason(''); }} />
                    </Space>
                  </Card>
                )}
              />
            ) : (
              <Table
                dataSource={wmDeals}
                columns={wmColumns}
                rowKey="id"
                loading={wmLoading}
                size="middle"
                bordered={false}
                pagination={false}
                scroll={{ x: 700 }}
                locale={{ emptyText: 'Нет заявок от зав. склада' }}
              />
            ),
          },
        ]}
      />

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

      <Modal
        title="Отклонить заявку зав. склада"
        open={!!wmRejectId}
        onOk={handleWmRejectConfirm}
        onCancel={() => {
          setWmRejectId(null);
          setWmRejectReason('');
        }}
        okText="Отклонить"
        cancelText="Отмена"
        okButtonProps={{ danger: true, loading: wmRejectMut.isPending }}
      >
        <Typography.Text>Укажите причину отклонения:</Typography.Text>
        <Input.TextArea
          rows={3}
          value={wmRejectReason}
          onChange={(e) => setWmRejectReason(e.target.value)}
          placeholder="Причина отклонения..."
          style={{ marginTop: 8 }}
        />
      </Modal>
    </div>
  );
}
