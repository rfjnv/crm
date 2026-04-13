import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Typography,
  Button,
  Card,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  DatePicker,
  Select,
  Popconfirm,
  message,
  Space,
} from 'antd';
import { PlusOutlined, DeleteOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { expensesApi } from '../api/expenses.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import type { Expense } from '../types';

const EXPENSE_CATEGORIES = [
  'Аренда',
  'Зарплата',
  'Транспорт',
  'Реклама',
  'Коммунальные',
  'Канцелярия',
  'Связь',
  'Налоги',
  'Аванс',
  'Прочее',
];

const EXPENSE_STATUS_OPTIONS = [
  { label: 'На одобрении', value: 'PENDING' as const, color: 'gold' },
  { label: 'Одобрено', value: 'APPROVED' as const, color: 'green' },
  { label: 'Отклонено', value: 'REJECTED' as const, color: 'red' },
];

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const canSeeActions = isAdmin || !!user?.permissions?.includes('manage_expenses');
  const isMobile = useIsMobile();

  const [modalOpen, setModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [pendingRejectExpenseId, setPendingRejectExpenseId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [rejectForm] = Form.useForm();

  // Filters
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | undefined>(undefined);

  const queryParams: { from?: string; to?: string; category?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED' } = {};
  if (dateRange?.[0]) queryParams.from = dateRange[0].format('YYYY-MM-DD');
  if (dateRange?.[1]) queryParams.to = dateRange[1].format('YYYY-MM-DD');
  if (categoryFilter) queryParams.category = categoryFilter;
  if (statusFilter) queryParams.status = statusFilter;

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', queryParams],
    queryFn: () => expensesApi.list(queryParams),
  });

  const createMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: () => {
      message.success(isAdmin ? 'Расход добавлен и сразу одобрен' : 'Заявка на расход отправлена администратору');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setModalOpen(false);
      form.resetFields();
    },
    onError: () => message.error('Ошибка при добавлении расхода'),
  });

  const approveMutation = useMutation({
    mutationFn: expensesApi.approve,
    onSuccess: () => {
      message.success('Заявка одобрена');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => message.error('Не удалось одобрить заявку'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => expensesApi.reject(id, reason),
    onSuccess: () => {
      message.success('Заявка отклонена');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setRejectModalOpen(false);
      setPendingRejectExpenseId(null);
      rejectForm.resetFields();
    },
    onError: () => message.error('Не удалось отклонить заявку'),
  });

  const deleteMutation = useMutation({
    mutationFn: expensesApi.remove,
    onSuccess: () => {
      message.success('Расход удалён');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => message.error('Ошибка при удалении'),
  });

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      createMutation.mutate({
        date: values.date.format('YYYY-MM-DD'),
        category: values.category,
        amount: values.amount,
        note: values.note || undefined,
      });
    } catch {
      // validation error
    }
  };

  const openRejectModal = (expenseId: string) => {
    setPendingRejectExpenseId(expenseId);
    setRejectModalOpen(true);
  };

  const handleReject = async () => {
    if (!pendingRejectExpenseId) return;
    try {
      const values = await rejectForm.validateFields();
      rejectMutation.mutate({ id: pendingRejectExpenseId, reason: values.reason });
    } catch {
      // validation error
    }
  };

  const expenses = data?.expenses ?? [];
  const total = data?.total ?? 0;

  const canDeleteExpense = (expense: Expense) => {
    if (isAdmin) return true;
    return expense.createdBy === user?.id && expense.status === 'PENDING';
  };

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'date',
      width: 120,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Категория',
      dataIndex: 'category',
      width: 160,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 130,
      render: (v: 'PENDING' | 'APPROVED' | 'REJECTED') => {
        const status = EXPENSE_STATUS_OPTIONS.find((s) => s.value === v);
        return <Tag color={status?.color}>{status?.label || v}</Tag>;
      },
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      width: 160,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Описание',
      dataIndex: 'note',
      render: (_: string | null, record: Expense) => {
        if (record.status === 'REJECTED' && record.rejectedReason) {
          return record.note ? `${record.note} | Причина отклонения: ${record.rejectedReason}` : `Причина отклонения: ${record.rejectedReason}`;
        }
        return record.note || '—';
      },
    },
    {
      title: 'Кем создано',
      dataIndex: ['creator', 'fullName'],
      width: 180,
      render: (v: string) => v || '—',
    },
    ...(canSeeActions
      ? [
        {
          title: '',
          key: 'actions',
          width: 60,
          render: (_: unknown, record: Expense) => (
            <Space size={4}>
              {isAdmin && record.status === 'PENDING' && (
                <>
                  <Button
                    type="text"
                    icon={<CheckOutlined />}
                    size="small"
                    onClick={() => approveMutation.mutate(record.id)}
                    loading={approveMutation.isPending}
                  />
                  <Button
                    type="text"
                    danger
                    icon={<CloseOutlined />}
                    size="small"
                    onClick={() => openRejectModal(record.id)}
                  />
                </>
              )}
              {canDeleteExpense(record) && (
                <Popconfirm
                  title="Удалить расход?"
                  onConfirm={() => deleteMutation.mutate(record.id)}
                  okText="Да"
                  cancelText="Нет"
                >
                  <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                </Popconfirm>
              )}
            </Space>
          ),
        },
      ]
      : []),
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Расходы
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          {isMobile ? '' : isAdmin ? 'Добавить расход' : 'Новая заявка'}
        </Button>
      </div>

      <Card bordered={false}>
        <Space style={{ marginBottom: 16 }} wrap>
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(values) => setDateRange(values)}
            format="DD.MM.YYYY"
            placeholder={['С', 'По']}
            allowClear
            style={{ width: isMobile ? '100%' : undefined }}
          />
          <Select
            placeholder="Категория"
            value={categoryFilter}
            onChange={(v) => setCategoryFilter(v)}
            allowClear
            style={{ width: isMobile ? '100%' : 180 }}
            options={EXPENSE_CATEGORIES.map((c) => ({ label: c, value: c }))}
          />
          <Select
            placeholder="Статус"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            allowClear
            style={{ width: isMobile ? '100%' : 180 }}
            options={EXPENSE_STATUS_OPTIONS.map((s) => ({ label: s.label, value: s.value }))}
          />
        </Space>

        {isMobile ? (
          <MobileCardList
            data={expenses}
            rowKey="id"
            loading={isLoading}
            renderCard={(item: Expense) => (
              <Card size="small" bordered>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <Typography.Text strong>{item.category}</Typography.Text>
                    <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(item.date).format('DD.MM.YYYY')}</Typography.Text></div>
                    <div><Tag color={EXPENSE_STATUS_OPTIONS.find((s) => s.value === item.status)?.color}>{EXPENSE_STATUS_OPTIONS.find((s) => s.value === item.status)?.label || item.status}</Tag></div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Typography.Text strong>{formatUZS(item.amount)}</Typography.Text>
                    {isAdmin && item.status === 'PENDING' && (
                      <>
                        <Button type="text" icon={<CheckOutlined />} size="small" onClick={() => approveMutation.mutate(item.id)} />
                        <Button type="text" danger icon={<CloseOutlined />} size="small" onClick={() => openRejectModal(item.id)} />
                      </>
                    )}
                    {canDeleteExpense(item) && (
                      <Popconfirm title="Удалить расход?" onConfirm={() => deleteMutation.mutate(item.id)} okText="Да" cancelText="Нет">
                        <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                      </Popconfirm>
                    )}
                  </div>
                </div>
                {(item.note || item.rejectedReason) && (
                  <div style={{ marginTop: 4 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.note || '—'}
                      {item.rejectedReason ? ` | Причина отклонения: ${item.rejectedReason}` : ''}
                    </Typography.Text>
                  </div>
                )}
              </Card>
            )}
          />
        ) : (
          <Table
            dataSource={expenses}
            columns={columns}
            rowKey="id"
            loading={isLoading}
            pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
            size="middle"
            locale={{ emptyText: 'Нет расходов' }}
          />
        )}

        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            Итого: {formatUZS(total)}
          </Typography.Text>
        </div>
      </Card>

      <Modal
        title={isAdmin ? 'Добавить расход' : 'Новая заявка на расход'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={handleCreate}
        confirmLoading={createMutation.isPending}
        okText={isAdmin ? 'Добавить' : 'Отправить на одобрение'}
        cancelText="Отмена"
        width={isMobile ? '100%' : 520}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="date" label="Дата" rules={[{ required: true, message: 'Выберите дату' }]}>
            <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="category" label="Категория" rules={[{ required: true, message: 'Укажите категорию' }]}>
            <Select
              placeholder="Выберите категорию"
              options={EXPENSE_CATEGORIES.map((c) => ({ label: c, value: c }))}
              showSearch
            />
          </Form.Item>
          <Form.Item name="amount" label="Сумма" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              formatter={moneyFormatter}
              parser={moneyParser as never}
              placeholder="0"
            />
          </Form.Item>
          <Form.Item name="note" label="Описание">
            <Input placeholder="Необязательно" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Отклонить заявку"
        open={rejectModalOpen}
        onCancel={() => {
          setRejectModalOpen(false);
          setPendingRejectExpenseId(null);
          rejectForm.resetFields();
        }}
        onOk={handleReject}
        okText="Отклонить"
        cancelText="Отмена"
        okButtonProps={{ danger: true, loading: rejectMutation.isPending }}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item name="reason" label="Причина" rules={[{ required: true, message: 'Укажите причину отклонения' }]}>
            <Input.TextArea rows={3} placeholder="Почему заявка отклонена" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
