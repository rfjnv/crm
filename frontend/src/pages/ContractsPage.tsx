import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Typography, message, Tag,
  DatePicker, Card, Space, Descriptions, Drawer, Timeline, Statistic, Row, Col, Tabs,
} from 'antd';
import {
  PlusOutlined, EditOutlined, FileTextOutlined,
  DollarOutlined, EyeOutlined,
} from '@ant-design/icons';
import { theme } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { contractsApi } from '../api/contracts.api';
import { clientsApi } from '../api/clients.api';
import { dealsApi } from '../api/deals.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { matchesSearch } from '../utils/translit';
import type { Client, ContractListItem, ContractDetail, DealStatus } from '../types';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import DealStatusTag from '../components/DealStatusTag';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';

function getDefaultContractEndDate(start?: dayjs.Dayjs) {
  return dayjs(start ?? dayjs()).endOf('year');
}

export default function ContractsPage() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManageContracts = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';
  const [createOpen, setCreateOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<ContractListItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentDealId, setPaymentDealId] = useState<string | null>(null);
  const [filterClient, setFilterClient] = useState<string>();
  const [filterType, setFilterType] = useState<string>('ALL');
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
    const startDate = dayjs();
    form.setFieldsValue({ startDate, endDate: getDefaultContractEndDate(startDate) });
    setCreateOpen(true);
  }

  function openEdit(contract: ContractListItem) {
    setEditingContract(contract);
    form.setFieldsValue({
      clientId: contract.clientId,
      contractNumber: contract.contractNumber,
      contractType: contract.contractType || 'ONE_TIME',
      amount: Number(contract.amount) || 0,
      startDate: dayjs(contract.startDate),
      endDate: contract.endDate ? dayjs(contract.endDate) : null,
      notes: contract.notes || '',
      isActive: contract.isActive,
    });
  }

  function handleCreateFinish(values: Record<string, unknown>) {
    const startDate = values.startDate as dayjs.Dayjs;
    const endDate = (values.endDate as dayjs.Dayjs | undefined) || getDefaultContractEndDate(startDate);
    createMut.mutate({
      clientId: values.clientId as string,
      contractNumber: values.contractNumber as string,
      contractType: (values.contractType as 'ANNUAL' | 'ONE_TIME') || 'ONE_TIME',
      amount: (values.amount as number) || undefined,
      startDate: startDate.format('YYYY-MM-DD'),
      endDate: endDate.format('YYYY-MM-DD'),
      notes: (values.notes as string) || undefined,
    });
  }

  function handleEditFinish(values: Record<string, unknown>) {
    if (!editingContract) return;
    updateMut.mutate({
      id: editingContract.id,
      data: {
        contractNumber: values.contractNumber as string,
        contractType: values.contractType as 'ANNUAL' | 'ONE_TIME',
        amount: (values.amount as number) || 0,
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
    () =>
      (clients ?? []).map((c: Client) => ({
        value: c.id,
        label: <ClientCompanyDisplay client={c} />,
      })),
    [clients],
  );

  const filterClientByName = (input: string, option: { value?: string } | undefined) => {
    const c = (clients ?? []).find((x) => x.id === option?.value);
    if (!c) return false;
    return matchesSearch(
      [c.companyName, c.contactName || '', c.phone || ''].join(' '),
      input,
    );
  };

  const filteredContracts = useMemo(() => {
    if (filterType === 'ALL') return contracts ?? [];
    return (contracts ?? []).filter((c) => c.contractType === filterType);
  }, [contracts, filterType]);

  const columns = [
    {
      title: 'Номер',
      dataIndex: 'contractNumber',
      render: (v: string, r: ContractListItem) => (
        <Link to={`/contracts/${r.id}`}>
          <FileTextOutlined style={{ marginRight: 4 }} />{v}
        </Link>
      ),
    },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, r: ContractListItem) => <ClientCompanyDisplay client={r.client} link />,
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
      title: 'Тип',
      dataIndex: 'contractType',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'ANNUAL' ? 'blue' : 'default'}>
          {v === 'ANNUAL' ? 'Годовой' : 'Разовый'}
        </Tag>
      ),
    },
    {
      title: 'Сделки',
      dataIndex: 'dealsCount',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Сумма договора',
      dataIndex: 'amount',
      render: (v: number) => Number(v) > 0 ? formatUZS(Number(v)) : '—',
      align: 'right' as const,
    },
    {
      title: 'Сумма сделок',
      dataIndex: 'totalAmount',
      render: (v: number) => v > 0 ? formatUZS(v) : '—',
      align: 'right' as const,
    },
    {
      title: 'Оплачено',
      dataIndex: 'totalPaid',
      render: (v: number) => v > 0 ? <span style={{ color: '#52c41a' }}>{formatUZS(v)}</span> : '—',
      align: 'right' as const,
    },
    {
      title: 'Остаток',
      dataIndex: 'remaining',
      render: (v: number) => v > 0 ? <span style={{ color: '#ff4d4f', fontWeight: 500 }}>{formatUZS(v)}</span> : '—',
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
          <Link to={`/contracts/${r.id}`}><Button type="text" size="small" icon={<EyeOutlined />} /></Link>
          {canManageContracts && <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />}
        </Space>
      ),
    },
  ];

  const totals = useMemo(() => {
    if (!filteredContracts.length) return { total: 0, paid: 0, remaining: 0, count: 0 };
    return {
      count: filteredContracts.length,
      total: filteredContracts.reduce((s, c) => s + c.totalAmount, 0),
      paid: filteredContracts.reduce((s, c) => s + c.totalPaid, 0),
      remaining: filteredContracts.reduce((s, c) => s + c.remaining, 0),
    };
  }, [filteredContracts]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Договоры</Typography.Title>
        <Space>
          <Select
            allowClear
            showSearch
            placeholder="Фильтр по клиенту"
            style={{ width: isMobile ? '100%' : 250 }}
            value={filterClient}
            onChange={setFilterClient}
            options={clientOptions}
            filterOption={filterClientByName}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!canManageContracts}>Создать</Button>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small"><Statistic title="Договоров" value={totals.count} /></Card>
        </Col>
        <Col span={6}>
          <Card size="small"><Statistic title="Общая сумма" value={totals.total} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" /></Card>
        </Col>
        <Col span={6}>
          <Card size="small"><Statistic title="Оплачено" value={totals.paid} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col span={6}>
          <Card size="small"><Statistic title="Остаток" value={totals.remaining} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" valueStyle={{ color: totals.remaining > 0 ? '#ff4d4f' : undefined }} /></Card>
        </Col>
      </Row>

      <Tabs
        activeKey={filterType}
        onChange={setFilterType}
        style={{ marginBottom: 16 }}
        items={[
          { key: 'ALL', label: 'Все' },
          { key: 'ANNUAL', label: 'Годовые' },
          { key: 'ONE_TIME', label: 'Разовые' },
        ]}
      />

      <Table
        dataSource={filteredContracts}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
        size="middle"
        bordered={false}
        scroll={{ x: 600 }}
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
        width={isMobile ? '100%' : 520}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateFinish}
          onValuesChange={(changed) => {
            if (changed.contractType || changed.startDate) {
              const startDate = changed.startDate || form.getFieldValue('startDate') || dayjs();
              form.setFieldsValue({ startDate, endDate: getDefaultContractEndDate(startDate) });
            }
          }}
        >
          <Form.Item name="clientId" label="Клиент" rules={[{ required: true, message: 'Выберите клиента' }]}>
            <Select showSearch placeholder="Выберите клиента" options={clientOptions} filterOption={filterClientByName} />
          </Form.Item>
          <Form.Item name="contractNumber" label="Номер договора" rules={[{ required: true, message: 'Укажите номер' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contractType" label="Тип договора" initialValue="ONE_TIME">
            <Select options={[
              { label: 'Разовый', value: 'ONE_TIME' },
              { label: 'Годовой', value: 'ANNUAL' },
            ]} />
          </Form.Item>
          <Form.Item name="amount" label="Сумма договора">
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} placeholder="0" />
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
        width={isMobile ? '100%' : 520}
      >
        <Form form={form} layout="vertical" onFinish={handleEditFinish}>
          <Form.Item name="contractNumber" label="Номер договора" rules={[{ required: true, message: 'Укажите номер' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contractType" label="Тип договора">
            <Select options={[
              { label: 'Разовый', value: 'ONE_TIME' },
              { label: 'Годовой', value: 'ANNUAL' },
            ]} />
          </Form.Item>
          <Form.Item name="amount" label="Сумма договора">
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
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
          <Form.Item name="isActive" label="Статус">
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
        width={isMobile ? '100%' : 640}
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
        width={isMobile ? '100%' : 400}
      >
        <Form form={payForm} layout="vertical" onFinish={handlePayment}>
          <Form.Item name="amount" label="Сумма" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <Input type="number" min={1} suffix="so'm" />
          </Form.Item>
          <Form.Item name="method" label="Способ оплаты">
            <Select allowClear placeholder="Выберите" options={[
              { label: 'Наличные', value: 'CASH' },
              { label: 'Перечисление', value: 'TRANSFER' },
              { label: 'Payme', value: 'PAYME' },
              { label: 'QR', value: 'QR' },
              { label: 'Click', value: 'CLICK' },
              { label: 'Терминал', value: 'TERMINAL' },
              { label: 'Рассрочка', value: 'INSTALLMENT' },
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
  const { token: tk } = theme.useToken();
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="Клиент">
          <ClientCompanyDisplay client={detail.client} link variant="full" />
        </Descriptions.Item>
        <Descriptions.Item label="Статус">
          <Tag color={detail.isActive ? 'green' : 'red'}>{detail.isActive ? 'Активен' : 'Закрыт'}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Дата начала">{dayjs(detail.startDate).format('DD.MM.YYYY')}</Descriptions.Item>
        <Descriptions.Item label="Дата окончания">{detail.endDate ? dayjs(detail.endDate).format('DD.MM.YYYY') : '—'}</Descriptions.Item>
        {detail.notes && <Descriptions.Item label="Примечание" span={2}>{detail.notes}</Descriptions.Item>}
      </Descriptions>

      <Row gutter={12}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Сумма договора" value={Number(detail.amount)} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Сумма сделок" value={detail.totalAmount} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Оплачено" value={detail.totalPaid} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Остаток" value={detail.remaining} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" valueStyle={{ color: detail.remaining > 0 ? '#ff4d4f' : '#52c41a' }} />
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
              render: (v: string) => formatUZS(v),
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
                    <strong>{formatUZS(p.amount)}</strong>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(p.paidAt).format('DD.MM.YYYY HH:mm')}
                    </Typography.Text>
                  </div>
                  <div style={{ fontSize: 12, color: tk.colorTextSecondary }}>
                    <span>Сделка: {p.deal?.title || p.dealId}</span>
                    {p.method && <span> · {p.method}</span>}
                    <span> · {p.creator?.fullName}</span>
                  </div>
                  {p.note && <div style={{ fontSize: 12, color: tk.colorTextTertiary }}>{p.note}</div>}
                </div>
              ),
            }))}
          />
        )}
      </div>
    </Space>
  );
}
