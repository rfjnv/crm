import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, Select, Typography, message, Tag,
  DatePicker, Card, Space, Descriptions, Drawer, Timeline, Statistic, Row, Col,
} from 'antd';
import {
  PlusOutlined, EditOutlined, FileTextOutlined,
  DollarOutlined, EyeOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { contractsApi } from '../api/contracts.api';
import { clientsApi } from '../api/clients.api';
import { dealsApi } from '../api/deals.api';
import type { ContractListItem, ContractDetail, DealStatus } from '../types';
import DealStatusTag from '../components/DealStatusTag';

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export default function ContractsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<ContractListItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentDealId, setPaymentDealId] = useState<string | null>(null);
  const [filterClient, setFilterClient] = useState<string>();
  const [form] = Form.useForm();
  const [payForm] = Form.useForm();

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['contracts-list', filterClient],
    queryFn: () => contractsApi.list(filterClient),
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  const { data: contractDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['contract-detail', detailId],
    queryFn: () => contractsApi.getById(detailId!),
    enabled: !!detailId,
  });

  const createMut = useMutation({
    mutationFn: (data: Parameters<typeof contractsApi.create>[0]) => contractsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts-list'] });
      message.success('Договор создан');
      setCreateOpen(false);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof contractsApi.update>[1] }) =>
      contractsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts-list'] });
      queryClient.invalidateQueries({ queryKey: ['contract-detail'] });
      message.success('Договор обновлён');
      setEditingContract(null);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const payMut = useMutation({
    mutationFn: ({ dealId, data }: { dealId: string; data: { amount: number; method?: string; note?: string } }) =>
      dealsApi.createPayment(dealId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts-list'] });
      queryClient.invalidateQueries({ queryKey: ['contract-detail'] });
      message.success('Оплата внесена');
      setPaymentOpen(false);
      payForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  function openCreate() {
    setEditingContract(null);
    form.resetFields();
    form.setFieldsValue({ startDate: dayjs() });
    setCreateOpen(true);
  }

  function openEdit(contract: ContractListItem) {
    setEditingContract(contract);
    form.setFieldsValue({
      clientId: contract.clientId,
      contractNumber: contract.contractNumber,
      startDate: dayjs(contract.startDate),
      endDate: contract.endDate ? dayjs(contract.endDate) : null,
      notes: contract.notes || '',
      isActive: contract.isActive,
    });
  }

  function handleCreateFinish(values: Record<string, unknown>) {
    createMut.mutate({
      clientId: values.clientId as string,
      contractNumber: values.contractNumber as string,
      startDate: (values.startDate as dayjs.Dayjs).format('YYYY-MM-DD'),
      endDate: values.endDate ? (values.endDate as dayjs.Dayjs).format('YYYY-MM-DD') : undefined,
      notes: (values.notes as string) || undefined,
    });
  }

  function handleEditFinish(values: Record<string, unknown>) {
    if (!editingContract) return;
    updateMut.mutate({
      id: editingContract.id,
      data: {
        contractNumber: values.contractNumber as string,
        startDate: (values.startDate as dayjs.Dayjs).format('YYYY-MM-DD'),
        endDate: values.endDate ? (values.endDate as dayjs.Dayjs).format('YYYY-MM-DD') : null,
        notes: (values.notes as string) || null,
        isActive: values.isActive as boolean,
      },
    });
  }

  function handlePayment(values: Record<string, unknown>) {
    if (!paymentDealId) return;
    payMut.mutate({
      dealId: paymentDealId,
      data: {
        amount: values.amount as number,
        method: (values.method as string) || undefined,
        note: (values.note as string) || undefined,
      },
    });
  }

  function openPaymentModal(dealId: string) {
    setPaymentDealId(dealId);
    payForm.resetFields();
    setPaymentOpen(true);
  }

  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ label: c.companyName, value: c.id })),
    [clients],
  );

  const columns = [
    {
      title: 'Номер',
      dataIndex: 'contractNumber',
      render: (v: string, r: ContractListItem) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => setDetailId(r.id)}>
          <FileTextOutlined style={{ marginRight: 4 }} />{v}
        </Button>
      ),
    },
    {
      title: 'Клиент',
      dataIndex: ['client', 'companyName'],
      render: (v: string, r: ContractListItem) => (
        <Link to={`/clients/${r.clientId}`}>{v}</Link>
      ),
    },
    {
      title: 'Дата начала',
      dataIndex: 'startDate',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Дата окончания',
      dataIndex: 'endDate',
      render: (v: string | null) => v ? dayjs(v).format('DD.MM.YYYY') : '—',
    },
    {
      title: 'Сделки',
      dataIndex: 'dealsCount',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Сумма',
      dataIndex: 'totalAmount',
      render: (v: number) => v > 0 ? fmt(v) : '—',
      align: 'right' as const,
    },
    {
      title: 'Оплачено',
      dataIndex: 'totalPaid',
      render: (v: number) => v > 0 ? <span style={{ color: '#52c41a' }}>{fmt(v)}</span> : '—',
      align: 'right' as const,
    },
    {
      title: 'Остаток',
      dataIndex: 'remaining',
      render: (v: number) => v > 0 ? <span style={{ color: '#ff4d4f', fontWeight: 500 }}>{fmt(v)}</span> : '—',
      align: 'right' as const,
    },
    {
      title: 'Статус',
      dataIndex: 'isActive',
      width: 100,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Активен' : 'Закрыт'}</Tag>,
    },
    {
      title: '',
      width: 80,
      render: (_: unknown, r: ContractListItem) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setDetailId(r.id)} />
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
        </Space>
      ),
    },
  ];

  const totals = useMemo(() => {
    if (!contracts) return { total: 0, paid: 0, remaining: 0, count: 0 };
    return {
      count: contracts.length,
      total: contracts.reduce((s, c) => s + c.totalAmount, 0),
      paid: contracts.reduce((s, c) => s + c.totalPaid, 0),
      remaining: contracts.reduce((s, c) => s + c.remaining, 0),
    };
  }, [contracts]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Договоры</Typography.Title>
        <Space>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Фильтр по клиенту"
            style={{ width: 250 }}
            value={filterClient}
            onChange={setFilterClient}
            options={clientOptions}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Создать</Button>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small"><Statistic title="Договоров" value={totals.count} /></Card>
        </Col>
        <Col span={6}>
          <Card size="small"><Statistic title="Общая сумма" value={totals.total} formatter={(v) => fmt(Number(v))} suffix="so'm" /></Card>
        </Col>
        <Col span={6}>
          <Card size="small"><Statistic title="Оплачено" value={totals.paid} formatter={(v) => fmt(Number(v))} suffix="so'm" valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col span={6}>
          <Card size="small"><Statistic title="Остаток" value={totals.remaining} formatter={(v) => fmt(Number(v))} suffix="so'm" valueStyle={{ color: totals.remaining > 0 ? '#ff4d4f' : undefined }} /></Card>
        </Col>
      </Row>

      <Table
        dataSource={contracts}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
        size="middle"
        bordered={false}
      />

      {/* Create Contract Modal */}
      <Modal
        title="Новый договор"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="Создать"
        cancelText="Отмена"
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleCreateFinish}>
          <Form.Item name="clientId" label="Клиент" rules={[{ required: true, message: 'Выберите клиента' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Выберите клиента" options={clientOptions} />
          </Form.Item>
          <Form.Item name="contractNumber" label="Номер договора" rules={[{ required: true, message: 'Укажите номер' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="startDate" label="Дата начала" rules={[{ required: true, message: 'Укажите дату' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="endDate" label="Дата окончания">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="notes" label="Примечание">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Contract Modal */}
      <Modal
        title="Редактировать договор"
        open={!!editingContract}
        onCancel={() => { setEditingContract(null); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={updateMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleEditFinish}>
          <Form.Item name="contractNumber" label="Номер договора" rules={[{ required: true, message: 'Укажите номер' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="startDate" label="Дата начала" rules={[{ required: true, message: 'Укажите дату' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="endDate" label="Дата окончания">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="notes" label="Примечание">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="isActive" label="Статус" valuePropName="checked">
            <Select
              options={[
                { label: 'Активен', value: true },
                { label: 'Закрыт', value: false },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Contract Detail Drawer */}
      <Drawer
        title={contractDetail ? `Договор ${contractDetail.contractNumber}` : 'Договор'}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        width={640}
        loading={detailLoading}
      >
        {contractDetail && <ContractDetailView detail={contractDetail} onPay={openPaymentModal} />}
      </Drawer>

      {/* Payment Modal */}
      <Modal
        title="Внести оплату"
        open={paymentOpen}
        onCancel={() => { setPaymentOpen(false); payForm.resetFields(); }}
        onOk={() => payForm.submit()}
        confirmLoading={payMut.isPending}
        okText="Внести"
        cancelText="Отмена"
        width={400}
      >
        <Form form={payForm} layout="vertical" onFinish={handlePayment}>
          <Form.Item name="amount" label="Сумма" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <Input type="number" min={1} suffix="so'm" />
          </Form.Item>
          <Form.Item name="method" label="Способ оплаты">
            <Select allowClear placeholder="Выберите" options={[
              { label: 'Наличные', value: 'cash' },
              { label: 'Перечисление', value: 'transfer' },
              { label: 'Карта', value: 'card' },
            ]} />
          </Form.Item>
          <Form.Item name="note" label="Примечание">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function ContractDetailView({ detail, onPay }: { detail: ContractDetail; onPay: (dealId: string) => void }) {
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="Клиент">
          <Link to={`/clients/${detail.clientId}`}>{detail.client?.companyName}</Link>
        </Descriptions.Item>
        <Descriptions.Item label="Статус">
          <Tag color={detail.isActive ? 'green' : 'red'}>{detail.isActive ? 'Активен' : 'Закрыт'}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Дата начала">{dayjs(detail.startDate).format('DD.MM.YYYY')}</Descriptions.Item>
        <Descriptions.Item label="Дата окончания">{detail.endDate ? dayjs(detail.endDate).format('DD.MM.YYYY') : '—'}</Descriptions.Item>
        {detail.notes && <Descriptions.Item label="Примечание" span={2}>{detail.notes}</Descriptions.Item>}
      </Descriptions>

      <Row gutter={12}>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Сумма" value={detail.totalAmount} formatter={(v) => fmt(Number(v))} suffix="so'm" />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Оплачено" value={detail.totalPaid} formatter={(v) => fmt(Number(v))} suffix="so'm" valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Остаток" value={detail.remaining} formatter={(v) => fmt(Number(v))} suffix="so'm" valueStyle={{ color: detail.remaining > 0 ? '#ff4d4f' : '#52c41a' }} />
          </Card>
        </Col>
      </Row>

      <div>
        <Typography.Title level={5} style={{ marginBottom: 8 }}>Сделки ({detail.deals?.length || 0})</Typography.Title>
        <Table
          dataSource={detail.deals || []}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            {
              title: 'Сделка',
              dataIndex: 'title',
              render: (v: string, r) => <Link to={`/deals/${r.id}`}>{v || r.id.slice(0, 8)}</Link>,
            },
            {
              title: 'Статус',
              dataIndex: 'status',
              width: 140,
              render: (v: DealStatus) => <DealStatusTag status={v} />,
            },
            {
              title: 'Сумма',
              dataIndex: 'amount',
              width: 120,
              align: 'right' as const,
              render: (v: string) => fmt(Number(v)),
            },
            {
              title: '',
              width: 100,
              render: (_: unknown, r: { id: string }) => (
                <Button type="link" size="small" icon={<DollarOutlined />} onClick={() => onPay(r.id)}>
                  Оплата
                </Button>
              ),
            },
          ]}
        />
      </div>

      <div>
        <Typography.Title level={5} style={{ marginBottom: 8 }}>История платежей ({detail.payments.length})</Typography.Title>
        {detail.payments.length === 0 ? (
          <Typography.Text type="secondary">Нет платежей</Typography.Text>
        ) : (
          <Timeline
            items={detail.payments.map((p) => ({
              color: 'green',
              children: (
                <div key={p.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{fmt(p.amount)} so'm</strong>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(p.paidAt).format('DD.MM.YYYY HH:mm')}
                    </Typography.Text>
                  </div>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    <span>Сделка: {p.deal?.title || p.dealId}</span>
                    {p.method && <span> · {p.method}</span>}
                    <span> · {p.creator?.fullName}</span>
                  </div>
                  {p.note && <div style={{ fontSize: 12, color: '#999' }}>{p.note}</div>}
                </div>
              ),
            }))}
          />
        )}
      </div>
    </Space>
  );
}
