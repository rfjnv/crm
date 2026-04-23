import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message,
} from 'antd';
import { PlusOutlined, EditOutlined, InboxOutlined, EyeOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { suppliersApi, type SupplierPayload } from '../api/suppliers.api';
import {
  type SupplierListItem,
  type SupplierCurrency,
  type Incoterms,
  SUPPLIER_CURRENCIES,
  INCOTERMS_LIST,
} from '../types';
import { useAuthStore } from '../store/authStore';
import { matchesSearch } from '../utils/translit';

export default function SuppliersPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage =
    user?.role === 'SUPER_ADMIN'
    || user?.role === 'ADMIN'
    || (user?.permissions ?? []).includes('manage_suppliers');

  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierListItem | null>(null);
  const [form] = Form.useForm<SupplierPayload>();

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', includeArchived],
    queryFn: () => suppliersApi.list({ includeArchived }),
  });

  const createMut = useMutation({
    mutationFn: (payload: SupplierPayload) => suppliersApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      message.success('Поставщик создан');
      setModalOpen(false);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SupplierPayload> }) =>
      suppliersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      message.success('Поставщик обновлён');
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => suppliersApi.toggleArchive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      message.success('Готово');
    },
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ currency: 'USD' });
    setModalOpen(true);
  }

  function openEdit(row: SupplierListItem) {
    setEditing(row);
    form.setFieldsValue({
      companyName: row.companyName,
      country: row.country,
      contactPerson: row.contactPerson,
      email: row.email,
      phone: row.phone,
      currency: row.currency,
      incoterms: row.incoterms,
      paymentTerms: row.paymentTerms,
      bankSwift: row.bankSwift,
      iban: row.iban,
      notes: row.notes,
    });
    setModalOpen(true);
  }

  function handleSubmit(values: SupplierPayload) {
    if (editing) {
      updateMut.mutate({ id: editing.id, data: values });
    } else {
      createMut.mutate(values);
    }
  }

  const filtered = useMemo(() => {
    const list = data ?? [];
    if (!search) return list;
    return list.filter((s) =>
      matchesSearch([s.companyName, s.country ?? '', s.contactPerson ?? ''].join(' '), search),
    );
  }, [data, search]);

  const columns = [
    {
      title: 'Компания',
      dataIndex: 'companyName',
      render: (v: string, r: SupplierListItem) => (
        <Space size={6}>
          <Link to={`/foreign-trade/suppliers/${r.id}`} style={{ fontWeight: 500 }}>{v}</Link>
          {r.isArchived && <Tag color="default">Архив</Tag>}
        </Space>
      ),
    },
    { title: 'Страна', dataIndex: 'country', render: (v: string | null) => v || '—' },
    { title: 'Контакт', dataIndex: 'contactPerson', render: (v: string | null) => v || '—' },
    { title: 'Телефон', dataIndex: 'phone', render: (v: string | null) => v || '—' },
    {
      title: 'Валюта',
      dataIndex: 'currency',
      width: 90,
      render: (v: SupplierCurrency) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: 'Inco.',
      dataIndex: 'incoterms',
      width: 80,
      render: (v: Incoterms | null) => (v ? <Tag>{v}</Tag> : '—'),
    },
    {
      title: 'Заказов',
      dataIndex: 'ordersCount',
      width: 90,
      align: 'center' as const,
    },
    {
      title: 'Товаров',
      dataIndex: 'productsCount',
      width: 90,
      align: 'center' as const,
    },
    {
      title: 'Создан',
      dataIndex: 'createdAt',
      width: 120,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: '',
      key: 'actions',
      width: 140,
      render: (_: unknown, r: SupplierListItem) => (
        <Space size={4}>
          <Link to={`/foreign-trade/suppliers/${r.id}`}>
            <Button type="text" size="small" icon={<EyeOutlined />} />
          </Link>
          {canManage && (
            <>
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
              <Button
                type="text"
                size="small"
                icon={<InboxOutlined />}
                title={r.isArchived ? 'Восстановить' : 'В архив'}
                onClick={() => archiveMut.mutate(r.id)}
              />
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Поставщики (ВЭД)</Typography.Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Поиск по названию / стране / контакту"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 320 }}
          />
          <Space size={6}>
            <span>Архивные:</span>
            <Switch checked={includeArchived} onChange={setIncludeArchived} />
          </Space>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Новый поставщик
            </Button>
          )}
        </Space>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={filtered}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      </Card>

      <Modal
        title={editing ? 'Редактировать поставщика' : 'Новый поставщик'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending}
        okText={editing ? 'Сохранить' : 'Создать'}
        width={680}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="companyName" label="Название компании" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="country" label="Страна" style={{ flex: 1 }}>
              <Input placeholder="Например, China" />
            </Form.Item>
            <Form.Item name="contactPerson" label="Контактное лицо" style={{ flex: 1, marginLeft: 8 }}>
              <Input />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="email" label="Email" style={{ flex: 1 }}>
              <Input placeholder="info@supplier.com" />
            </Form.Item>
            <Form.Item name="phone" label="Телефон" style={{ flex: 1, marginLeft: 8 }}>
              <Input />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="currency" label="Валюта" style={{ flex: 1 }} initialValue="USD">
              <Select options={SUPPLIER_CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
            <Form.Item name="incoterms" label="Инкотермс" style={{ flex: 1, marginLeft: 8 }}>
              <Select allowClear options={INCOTERMS_LIST.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="paymentTerms" label="Условия оплаты">
            <Input placeholder="Например, 30% предоплата, 70% после отгрузки" />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="bankSwift" label="SWIFT" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="iban" label="IBAN" style={{ flex: 1, marginLeft: 8 }}>
              <Input />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="notes" label="Заметки">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
