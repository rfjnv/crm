import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography, Button, Card, Space, Input, message, Popconfirm } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { dealsApi } from '../api/deals.api';
import DealStatusTag from '../components/DealStatusTag';
import { formatUZS } from '../utils/currency';
import type { Deal } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import BackButton from '../components/BackButton';

export default function PendingAdminPage() {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['pending-admin'],
    queryFn: dealsApi.wmPendingAdmin,
    refetchInterval: 10_000,
  });

  const approveMut = useMutation({
    mutationFn: (dealId: string) => dealsApi.adminApproveNew(dealId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pending-admin'] }); message.success('Сделка одобрена'); },
  });

  const rejectMut = useMutation({
    mutationFn: ({ dealId, reason }: { dealId: string; reason: string }) => dealsApi.adminRejectNew(dealId, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pending-admin'] }); setRejectId(null); setReason(''); message.success('Сделка отклонена'); },
  });

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={3} style={{ margin: 0 }}>Ожидает одобрения ({deals.length})</Typography.Title>
      </div>
      <Card>
        <Table
          dataSource={deals}
          rowKey="id"
          loading={isLoading}
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
          columns={[
            { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
            { title: 'Клиент', dataIndex: ['client', 'companyName'] },
            { title: 'Сумма', dataIndex: 'amount', render: (v: string) => formatUZS(Number(v)) },
            { title: 'Статус', dataIndex: 'status', render: (v: Deal['status']) => <DealStatusTag status={v} /> },
            {
              title: '',
              key: 'actions',
              render: (_: unknown, r: Deal) => (
                <Space>
                  <Popconfirm title="Одобрить сделку?" onConfirm={() => approveMut.mutate(r.id)}>
                    <Button type="primary" size="small" icon={<CheckOutlined />} loading={approveMut.isPending}>
                      Одобрить
                    </Button>
                  </Popconfirm>
                  <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejectId(r.id)}>
                    Отклонить
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Popconfirm
        title="Причина отклонения"
        description={<Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Причина..." />}
        open={!!rejectId}
        onCancel={() => { setRejectId(null); setReason(''); }}
        onConfirm={() => rejectId && reason.trim() && rejectMut.mutate({ dealId: rejectId, reason })}
        okButtonProps={{ disabled: !reason.trim() }}
      >
        <span />
      </Popconfirm>
    </div>
  );
}
