import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Typography,
  Button,
  Card,
  Modal,
  Form,
  Input,
  DatePicker,
  TimePicker,
  Select,
  Popconfirm,
  message,
  Space,
  Tag,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { attendanceApi } from '../api/attendance.api';
import { usersApi } from '../api/users.api';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import type { AttendanceRecord } from '../types';

export default function AttendancePage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [form] = Form.useForm();

  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>([dayjs().startOf('month'), dayjs()]);
  const [userFilter, setUserFilter] = useState<string | undefined>(undefined);

  const queryParams: { userId?: string; from?: string; to?: string } = {};
  if (userFilter) queryParams.userId = userFilter;
  if (dateRange?.[0]) queryParams.from = dateRange[0].format('YYYY-MM-DD');
  if (dateRange?.[1]) queryParams.to = dateRange[1].format('YYYY-MM-DD');

  const { data: records, isLoading } = useQuery({
    queryKey: ['attendance', queryParams],
    queryFn: () => attendanceApi.list(queryParams),
  });

  const { data: users } = useQuery({
    queryKey: ['users-for-attendance'],
    queryFn: () => usersApi.list(),
  });

  const upsertMutation = useMutation({
    mutationFn: attendanceApi.upsert,
    onSuccess: () => {
      message.success('Запись сохранена');
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      closeModal();
    },
    onError: () => message.error('Ошибка при сохранении записи'),
  });

  const deleteMutation = useMutation({
    mutationFn: attendanceApi.remove,
    onSuccess: () => {
      message.success('Запись удалена');
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: () => message.error('Ошибка при удалении'),
  });

  const openCreateModal = () => {
    setEditingRecord(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (record: AttendanceRecord) => {
    setEditingRecord(record);
    form.setFieldsValue({
      userId: record.userId,
      date: dayjs(record.date),
      checkIn: record.checkIn ? dayjs(record.checkIn) : undefined,
      checkOut: record.checkOut ? dayjs(record.checkOut) : undefined,
      note: record.note ?? undefined,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingRecord(null);
    form.resetFields();
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      upsertMutation.mutate({
        userId: values.userId,
        date: values.date.format('YYYY-MM-DD'),
        checkIn: values.checkIn ? values.checkIn.format('HH:mm') : null,
        checkOut: values.checkOut ? values.checkOut.format('HH:mm') : null,
        note: values.note || null,
      });
    } catch {
      // validation error
    }
  };

  const userOptions = useMemo(
    () => (users ?? []).map((u) => ({ value: u.id, label: u.fullName })),
    [users],
  );

  const data = records ?? [];

  const formatTime = (v?: string | null) => (v ? dayjs(v).format('HH:mm') : '—');

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'date',
      width: 120,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Сотрудник',
      dataIndex: ['user', 'fullName'],
      render: (_: unknown, r: AttendanceRecord) => r.user?.fullName ?? '—',
    },
    {
      title: 'Приход',
      dataIndex: 'checkIn',
      width: 100,
      render: (v: string | null) => (v ? <Tag color="green">{formatTime(v)}</Tag> : <Tag>—</Tag>),
    },
    {
      title: 'Уход',
      dataIndex: 'checkOut',
      width: 100,
      render: (v: string | null) => (v ? <Tag color="blue">{formatTime(v)}</Tag> : <Tag>—</Tag>),
    },
    {
      title: 'Примечание',
      dataIndex: 'note',
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Внёс',
      dataIndex: ['enteredBy', 'fullName'],
      width: 160,
      render: (_: unknown, r: AttendanceRecord) => r.enteredBy?.fullName ?? '—',
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_: unknown, record: AttendanceRecord) => (
        <Space size={4}>
          <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEditModal(record)} />
          <Popconfirm title="Удалить запись?" onConfirm={() => deleteMutation.mutate(record.id)} okText="Да" cancelText="Нет">
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Посещаемость
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          {isMobile ? '' : 'Добавить запись'}
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
            placeholder="Сотрудник"
            value={userFilter}
            onChange={(v) => setUserFilter(v)}
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: isMobile ? '100%' : 220 }}
            options={userOptions}
          />
        </Space>

        {isMobile ? (
          <MobileCardList
            data={data}
            rowKey="id"
            loading={isLoading}
            renderCard={(item: AttendanceRecord) => (
              <Card size="small" bordered>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <Typography.Text strong>{item.user?.fullName ?? '—'}</Typography.Text>
                    <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(item.date).format('DD.MM.YYYY')}</Typography.Text></div>
                    <div style={{ marginTop: 4 }}>
                      <Tag color="green">Приход: {formatTime(item.checkIn)}</Tag>
                      <Tag color="blue">Уход: {formatTime(item.checkOut)}</Tag>
                    </div>
                  </div>
                  <Space>
                    <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEditModal(item)} />
                    <Popconfirm title="Удалить запись?" onConfirm={() => deleteMutation.mutate(item.id)} okText="Да" cancelText="Нет">
                      <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                    </Popconfirm>
                  </Space>
                </div>
                {item.note && (
                  <div style={{ marginTop: 4 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.note}</Typography.Text>
                  </div>
                )}
              </Card>
            )}
          />
        ) : (
          <Table
            dataSource={data}
            columns={columns}
            rowKey="id"
            loading={isLoading}
            pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
            size="middle"
            locale={{ emptyText: 'Нет записей' }}
          />
        )}
      </Card>

      <Modal
        title={editingRecord ? 'Редактировать запись' : 'Добавить запись'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={handleSave}
        confirmLoading={upsertMutation.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        width={isMobile ? '100%' : 480}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="userId" label="Сотрудник" rules={[{ required: true, message: 'Выберите сотрудника' }]}>
            <Select placeholder="Выберите сотрудника" showSearch optionFilterProp="label" options={userOptions} disabled={!!editingRecord} />
          </Form.Item>
          <Form.Item name="date" label="Дата" rules={[{ required: true, message: 'Выберите дату' }]}>
            <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} disabled={!!editingRecord} />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="checkIn" label="Приход" style={{ flex: 1 }}>
              <TimePicker format="HH:mm" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="checkOut" label="Уход" style={{ flex: 1, marginLeft: 8 }}>
              <TimePicker format="HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="note" label="Примечание">
            <Input placeholder="Необязательно" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
