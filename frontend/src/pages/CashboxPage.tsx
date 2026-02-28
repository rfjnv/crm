import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Table, Typography, Select, Card, Statistic, Row, Col, Tag, Space, Segmented,
} from 'antd';
import dayjs from 'dayjs';
import { financeApi, type CashboxPayment } from '../api/finance.api';
import { clientsApi } from '../api/clients.api';
import { formatUZS } from '../utils/currency';

const methodLabels: Record<string, string> = {
  CASH: 'Наличные',
  TRANSFER: 'Перечисление',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка',
};

const paymentStatusLabels: Record<string, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Полностью' },
};

export default function CashboxPage() {
  const [period, setPeriod] = useState<string>('day');
  const [clientId, setClientId] = useState<string>();
  const [method, setMethod] = useState<string>();
  const [paymentStatus, setPaymentStatus] = useState<string>();

  const { data, isLoading } = useQuery({
    queryKey: ['cashbox', period, clientId, method, paymentStatus],
    queryFn: () => financeApi.cashbox({ period, clientId, method, paymentStatus }),
    refetchInterval: 15_000,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ label: c.companyName, value: c.id })),
    [clients],
  );

  const columns = [
    {
      title: 'Время',
      dataIndex: 'paidAt',
      width: 140,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: 'Сделка',
      dataIndex: 'dealTitle',
      render: (v: string, r: CashboxPayment) => (
        <Link to={`/deals/${r.dealId}`}>{v || r.dealId.slice(0, 8)}</Link>
      ),
    },
    {
      title: 'Клиент',
      dataIndex: 'clientName',
      render: (v: string, r: CashboxPayment) => (
        <Link to={`/clients/${r.clientId}`}>{v}</Link>
      ),
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      render: (v: number) => <strong>{formatUZS(v)}</strong>,
    },
    {
      title: 'Метод',
      dataIndex: 'method',
      width: 120,
      render: (v: string | null) => v ? (
        <Tag>{methodLabels[v] || v}</Tag>
      ) : '—',
    },
    {
      title: 'Статус сделки',
      dataIndex: 'dealPaymentStatus',
      width: 120,
      render: (v: string) => {
        const cfg = paymentStatusLabels[v] || { color: 'default', label: v };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Менеджер',
      dataIndex: 'manager',
    },
    {
      title: 'Принял',
      dataIndex: 'receivedBy',
    },
    {
      title: 'Примечание',
      dataIndex: 'note',
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ margin: '0 0 16px' }}>Касса</Typography.Title>

      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          value={period}
          onChange={(v) => setPeriod(v as string)}
          options={[
            { label: 'День', value: 'day' },
            { label: 'Неделя', value: 'week' },
            { label: 'Месяц', value: 'month' },
          ]}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Клиент"
          style={{ width: 200 }}
          value={clientId}
          onChange={setClientId}
          options={clientOptions}
        />
        <Select
          allowClear
          placeholder="Способ оплаты"
          style={{ width: 160 }}
          value={method}
          onChange={setMethod}
          options={[
            { label: 'Наличные', value: 'CASH' },
            { label: 'Перечисление', value: 'TRANSFER' },
            { label: 'Payme', value: 'PAYME' },
            { label: 'QR', value: 'QR' },
            { label: 'Click', value: 'CLICK' },
            { label: 'Терминал', value: 'TERMINAL' },
            { label: 'Рассрочка', value: 'INSTALLMENT' },
          ]}
        />
        <Select
          allowClear
          placeholder="Статус оплаты"
          style={{ width: 160 }}
          value={paymentStatus}
          onChange={setPaymentStatus}
          options={[
            { label: 'Полностью', value: 'PAID' },
            { label: 'Частично', value: 'PARTIAL' },
          ]}
        />
      </Space>

      {/* Summary cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Итого за период" value={data?.totals.totalAmount ?? 0} formatter={(v) => formatUZS(Number(v))} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Итого за сегодня" value={data?.totals.todayTotal ?? 0} formatter={(v) => formatUZS(Number(v))} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Количество оплат" value={data?.totals.count ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>По методам</Typography.Text>
            {data?.byMethod.map((m) => (
              <div key={m.method} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{methodLabels[m.method] || m.method}</span>
                <strong>{formatUZS(m.total)}</strong>
              </div>
            ))}
            {(!data?.byMethod || data.byMethod.length === 0) && (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Table
        dataSource={data?.payments}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
        size="middle"
        bordered={false}
        summary={() => data?.payments && data.payments.length > 0 ? (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3}><strong>Итого</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <strong>{formatUZS(data.totals.totalAmount)}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4} colSpan={5} />
          </Table.Summary.Row>
        ) : undefined}
      />
    </div>
  );
}
