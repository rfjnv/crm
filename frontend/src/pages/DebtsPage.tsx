import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography, Input, Tag, Modal, Spin, Descriptions } from 'antd';
import { financeApi } from '../api/finance.api';
import { formatUZS } from '../utils/currency';
import type { Deal, PaymentStatus } from '../types';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

const disciplineConfig: Record<string, { color: string; label: string }> = {
  good: { color: 'green', label: 'Надёжный' },
  pays_late: { color: 'orange', label: 'Задерживает' },
  chronic: { color: 'red', label: 'Хронический' },
};

export default function DebtsPage() {
  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['finance-debts'],
    queryFn: financeApi.getDebts,
  });

  const { data: clientDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['client-debt-detail', selectedClientId],
    queryFn: () => financeApi.clientDebtDetail(selectedClientId!),
    enabled: !!selectedClientId,
  });

  const deals = data?.deals ?? [];
  const totals = data?.totals;

  const filtered = deals.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return d.title.toLowerCase().includes(q) || d.client?.companyName?.toLowerCase().includes(q);
  });

  const now = dayjs();

  const handleClientClick = (clientId: string) => {
    setSelectedClientId(clientId);
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setSelectedClientId(null);
  };

  const columns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    {
      title: 'Клиент',
      dataIndex: ['client', 'companyName'],
      render: (v: string, r: Deal) => (
        <a onClick={() => r.client?.id && handleClientClick(r.client.id)} style={{ cursor: 'pointer' }}>
          {v}
        </a>
      ),
    },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    { title: 'Оплачено', dataIndex: 'paidAmount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Остаток',
      key: 'debt',
      align: 'right' as const,
      render: (_: unknown, r: Deal) => (
        <span style={{ color: '#ff4d4f', fontWeight: 600 }}>
          {formatUZS(Number(r.amount) - Number(r.paidAmount))}
        </span>
      ),
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
      title: 'Срок оплаты',
      dataIndex: 'dueDate',
      render: (v: string | null) => {
        if (!v) return '\u2014';
        const date = dayjs(v);
        const overdue = date.isBefore(now, 'day');
        return <span style={overdue ? { color: '#ff4d4f', fontWeight: 600 } : {}}>{date.format('DD.MM.YYYY')}</span>;
      },
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
  ];

  const detailDealsColumns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    { title: 'Оплачено', dataIndex: 'paidAmount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Остаток',
      key: 'debt',
      align: 'right' as const,
      render: (_: unknown, r: Deal) => (
        <span style={{ color: '#ff4d4f', fontWeight: 600 }}>
          {formatUZS(Number(r.amount) - Number(r.paidAmount))}
        </span>
      ),
    },
    {
      title: 'Оплата',
      dataIndex: 'paymentStatus',
      render: (s: PaymentStatus) => {
        const cfg = paymentStatusLabels[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
  ];

  const detailPaymentsColumns = [
    { title: 'Дата', dataIndex: 'paidAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    { title: 'Способ', dataIndex: 'method', render: (v: string | null) => v || '\u2014' },
    { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '\u2014' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Долги</Typography.Title>
        <Input.Search
          placeholder="Поиск по названию или клиенту..."
          style={{ width: 300 }}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {totals && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 24 }}>
          <Typography.Text type="secondary">
            Всего: <strong>{totals.count}</strong> сделок
          </Typography.Text>
          <Typography.Text type="secondary">
            Общий долг: <strong style={{ color: '#ff4d4f' }}>{formatUZS(totals.totalDebt)}</strong>
          </Typography.Text>
        </div>
      )}

      <Table
        dataSource={filtered}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20 }}
        size="middle"
        bordered={false}
        locale={{ emptyText: 'Нет задолженностей' }}
        rowClassName={(r: Deal) => {
          if (r.dueDate && dayjs(r.dueDate).isBefore(now, 'day')) return 'ant-table-row-overdue';
          return '';
        }}
      />

      <Modal
        title={clientDetail ? `Клиент: ${clientDetail.client.companyName}` : 'Детали клиента'}
        open={modalOpen}
        onCancel={handleModalClose}
        footer={null}
        width={800}
      >
        {detailLoading ? (
          <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />
        ) : clientDetail ? (
          <div>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Компания">{clientDetail.client.companyName}</Descriptions.Item>
              <Descriptions.Item label="Контакт">{clientDetail.client.contactName}</Descriptions.Item>
              <Descriptions.Item label="Телефон">{clientDetail.client.phone || '\u2014'}</Descriptions.Item>
              <Descriptions.Item label="Общий долг">
                <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{formatUZS(clientDetail.totalDebt)}</span>
              </Descriptions.Item>
              <Descriptions.Item label="Дисциплина">
                {(() => {
                  const cfg = disciplineConfig[clientDetail.discipline.tag] || { color: 'default', label: clientDetail.discipline.tag };
                  return <Tag color={cfg.color}>{cfg.label}</Tag>;
                })()}
              </Descriptions.Item>
              <Descriptions.Item label="Оплата вовремя">
                {(clientDetail.discipline.onTimeRate * 100).toFixed(0)}%
              </Descriptions.Item>
              <Descriptions.Item label="Ср. задержка (дн.)">
                {clientDetail.discipline.avgPaymentDelay.toFixed(1)}
              </Descriptions.Item>
              <Descriptions.Item label="Закрытых сделок">
                {clientDetail.discipline.totalClosedDeals}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 16 }}>Сделки</Typography.Title>
            <Table
              dataSource={clientDetail.deals}
              columns={detailDealsColumns}
              rowKey="id"
              pagination={false}
              size="small"
              locale={{ emptyText: 'Нет сделок' }}
            />

            <Typography.Title level={5} style={{ marginTop: 16 }}>Платежи</Typography.Title>
            <Table
              dataSource={clientDetail.payments}
              columns={detailPaymentsColumns}
              rowKey="id"
              pagination={false}
              size="small"
              locale={{ emptyText: 'Нет платежей' }}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
