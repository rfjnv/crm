import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Typography,
  Button,
  Card,
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
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { expensesApi } from '../api/expenses.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { useAuthStore } from '../store/authStore';
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
  'Прочее',
];

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canDelete = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  // Filters
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);

  const queryParams: { from?: string; to?: string; category?: string } = {};
  if (dateRange?.[0]) queryParams.from = dateRange[0].format('YYYY-MM-DD');
  if (dateRange?.[1]) queryParams.to = dateRange[1].format('YYYY-MM-DD');
  if (categoryFilter) queryParams.category = categoryFilter;

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', queryParams],
    queryFn: () => expensesApi.list(queryParams),
  });

  const createMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: () => {
      message.success('Расход добавлен');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setModalOpen(false);
      form.resetFields();
    },
    onError: () => message.error('Ошибка при добавлении расхода'),
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

  const expenses = data?.expenses ?? [];
  const total = data?.total ?? 0;

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
      title: 'Сумма',
      dataIndex: 'amount',
      align: 'right' as const,
      width: 160,
      render: (v: string) => formatUZS(v),
    },
    {
      title: 'Описание',
      dataIndex: 'note',
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Кем создано',
      dataIndex: ['creator', 'fullName'],
      width: 180,
      render: (v: string) => v || '—',
    },
    ...(canDelete
      ? [
        {
          title: '',
          key: 'actions',
          width: 60,
          render: (_: unknown, record: Expense) => (
            <Popconfirm
              title="Удалить расход?"
              onConfirm={() => deleteMutation.mutate(record.id)}
              okText="Да"
              cancelText="Нет"
            >
              <Button type="text" danger icon={<DeleteOutlined />} size="small" />
            </Popconfirm>
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
          Добавить
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
          />
          <Select
            placeholder="Категория"
            value={categoryFilter}
            onChange={(v) => setCategoryFilter(v)}
            allowClear
            style={{ width: 180 }}
            options={EXPENSE_CATEGORIES.map((c) => ({ label: c, value: c }))}
          />
        </Space>

        <Table
          dataSource={expenses}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          size="middle"
          locale={{ emptyText: 'Нет расходов' }}
        />

        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            Итого: {formatUZS(total)}
          </Typography.Text>
        </div>
      </Card>

      <Modal
        title="Добавить расход"
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={handleCreate}
        confirmLoading={createMutation.isPending}
        okText="Добавить"
        cancelText="Отмена"
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
    </div>
  );
}
