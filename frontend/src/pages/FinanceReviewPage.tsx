import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Typography, Button, Space, Tag, Modal, Input, message, theme, Card,
} from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import type { Deal } from '../types';
import dayjs from 'dayjs';

const paymentTypeLabels: Record<string, string> = {
  FULL: 'Полная',
  PARTIAL: 'Частичная',
  INSTALLMENT: 'Рассрочка',
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'Наличные',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  TRANSFER: 'Перечисление',
  INSTALLMENT: 'Рассрочка',
};

const transferTypeLabels: Record<'ONE_TIME' | 'ANNUAL', string> = {
  ONE_TIME: 'Разовый',
  ANNUAL: 'Годовой',
};

type FinanceDeal = Deal & { clientDebt: number };

export default function FinanceReviewPage() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { token } = theme.useToken();

  const [rejectModal, setRejectModal] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: deals, isLoading } = useQuery({
    queryKey: ['finance-queue'],
    queryFn: dealsApi.financeQueue,
    refetchInterval: 10_000,
  });

  const approveMut = useMutation({
    mutationFn: (dealId: string) => dealsApi.approveFinance(dealId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-queue'] });
      message.success('Сделка одобрена');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ dealId, reason }: { dealId: string; reason: string }) =>
      dealsApi.rejectFinance(dealId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-queue'] });
      message.success('Сделка отклонена');
      setRejectModal(null);
      setRejectReason('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const renderTransferInfo = (deal: FinanceDeal) => {
    if (deal.paymentMethod !== 'TRANSFER') return '—';

    const documents = Array.isArray(deal.transferDocuments) ? deal.transferDocuments : [];

    return (
      <div style={{ minWidth: 240 }}>
        <div>
          <Typography.Text type="secondary">ИНН: </Typography.Text>
          <Typography.Text code>{deal.transferInn || '—'}</Typography.Text>
        </div>
        {documents.length > 0 && (
          <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {documents.map((doc) => (
              <Tag key={doc} color="cyan">{doc}</Tag>
            ))}
          </div>
        )}
        {deal.transferType && (
          <div style={{ marginTop: 4 }}>
            <Tag color="magenta">{transferTypeLabels[deal.transferType] ?? deal.transferType}</Tag>
          </div>
        )}
      </div>
    );
  };

  const columns = [
    {
      title: 'Сделка',
      dataIndex: 'title',
      render: (v: string, r: FinanceDeal) => <Link to={`/deals/${r.id}`}>{v}</Link>,
    },
    {
      title: 'Клиент',
      dataIndex: ['client', 'companyName'],
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Тип оплаты',
      dataIndex: 'paymentType',
      render: (v: string) => <Tag>{paymentTypeLabels[v] ?? v}</Tag>,
    },
    {
      title: 'Способ оплаты',
      dataIndex: 'paymentMethod',
      render: (v: string | null) => v ? <Tag color="blue">{paymentMethodLabels[v] ?? v}</Tag> : '—',
    },
    {
      title: 'Данные для бухгалтера',
      render: (_: unknown, deal: FinanceDeal) => renderTransferInfo(deal),
    },
    {
      title: 'Долг клиента',
      dataIndex: 'clientDebt',
      align: 'right' as const,
      render: (v: number) => (
        <Typography.Text style={{ color: v > 0 ? token.colorError : undefined, fontWeight: v > 0 ? 600 : undefined }}>
          {formatUZS(v)}
        </Typography.Text>
      ),
    },
    {
      title: 'Договор',
      dataIndex: ['contract', 'contractNumber'],
      render: (v: string | undefined) => v || '—',
    },
    {
      title: 'Срок оплаты',
      dataIndex: 'dueDate',
      render: (v: string | null) => v ? dayjs(v).format('DD.MM.YYYY') : '—',
    },
    {
      title: 'Менеджер',
      dataIndex: ['manager', 'fullName'],
    },
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Действия',
      width: 120,
      render: (_: unknown, r: FinanceDeal) => (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            loading={approveMut.isPending}
            onClick={() => approveMut.mutate(r.id)}
          />
          <Button
            danger
            size="small"
            icon={<CloseOutlined />}
            onClick={() => { setRejectModal(r.id); setRejectReason(''); }}
          />
        </Space>
      ),
    },
  ];

  const list = deals ?? [];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Финансы на проверке
        {list.length > 0 && <Tag style={{ marginLeft: 8, fontSize: 14 }}>{list.length}</Tag>}
      </Typography.Title>

      {isMobile ? (
        <MobileCardList
          data={list}
          rowKey="id"
          loading={isLoading}
          renderCard={(deal: FinanceDeal) => (
            <Card size="small" bordered>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/deals/${deal.id}`}><Typography.Text strong>{deal.title}</Typography.Text></Link>
                  <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{deal.client?.companyName}</Typography.Text></div>
                </div>
                <Typography.Text strong>{formatUZS(deal.amount)}</Typography.Text>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                {deal.paymentType && <Tag>{paymentTypeLabels[deal.paymentType] ?? deal.paymentType}</Tag>}
                {deal.paymentMethod && <Tag color="blue">{paymentMethodLabels[deal.paymentMethod] ?? deal.paymentMethod}</Tag>}
              </div>
              {deal.paymentMethod === 'TRANSFER' && (
                <div style={{ marginTop: 8 }}>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>ИНН: </Typography.Text>
                    <Typography.Text code style={{ fontSize: 12 }}>{deal.transferInn || '—'}</Typography.Text>
                  </div>
                  {Array.isArray(deal.transferDocuments) && deal.transferDocuments.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {deal.transferDocuments.map((doc) => (
                        <Tag key={doc} color="cyan">{doc}</Tag>
                      ))}
                    </div>
                  )}
                  {deal.transferType && (
                    <div style={{ marginTop: 4 }}>
                      <Tag color="magenta">{transferTypeLabels[deal.transferType] ?? deal.transferType}</Tag>
                    </div>
                  )}
                </div>
              )}
              {deal.clientDebt > 0 && (
                <div style={{ marginTop: 4 }}>
                  <Typography.Text style={{ color: token.colorError, fontSize: 12 }}>Долг клиента: {formatUZS(deal.clientDebt)}</Typography.Text>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <Button type="primary" size="small" icon={<CheckOutlined />} loading={approveMut.isPending} onClick={() => approveMut.mutate(deal.id)}>Одобрить</Button>
                <Button danger size="small" icon={<CloseOutlined />} onClick={() => { setRejectModal(deal.id); setRejectReason(''); }}>Отклонить</Button>
              </div>
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={list}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          size="middle"
          bordered={false}
          scroll={{ x: 980 }}
          locale={{ emptyText: 'Нет сделок на проверке' }}
          summary={() => {
            if (list.length === 0) return null;
            const total = list.reduce((s, d) => s + Number(d.amount), 0);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <Typography.Text strong>Итого: {list.length} сделок</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <Typography.Text strong>{formatUZS(total)}</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} colSpan={9} />
              </Table.Summary.Row>
            );
          }}
        />
      )}

      <Modal
        title="Отклонить сделку"
        open={!!rejectModal}
        onCancel={() => setRejectModal(null)}
        onOk={() => {
          if (!rejectReason.trim()) {
            message.error('Укажите причину отклонения');
            return;
          }
          rejectMut.mutate({ dealId: rejectModal!, reason: rejectReason });
        }}
        confirmLoading={rejectMut.isPending}
        okText="Отклонить"
        cancelText="Отмена"
        okButtonProps={{ danger: true }}
      >
        <Input.TextArea
          rows={3}
          placeholder="Причина отклонения..."
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
