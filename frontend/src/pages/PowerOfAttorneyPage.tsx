import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography, Table, Tag, Space, Button, Popconfirm, message, Modal, Form, Input,
  Select, DatePicker, Card,
} from 'antd';
import {
  PlusOutlined, PrinterOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { poaApi } from '../api/power-of-attorney.api';
import type { PowerOfAttorney, CreatePoaData } from '../api/power-of-attorney.api';
import { contractsApi } from '../api/contracts.api';
import { useAuthStore } from '../store/authStore';

export default function PowerOfAttorneyPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';
  const canDelete = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const { data: poas, isLoading } = useQuery({
    queryKey: ['poas-all'],
    queryFn: () => poaApi.list(),
  });

  const { data: contracts } = useQuery({
    queryKey: ['contracts-list'],
    queryFn: () => contractsApi.list(),
  });

  const createMut = useMutation({
    mutationFn: (data: CreatePoaData) => poaApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['poas-all'] });
      message.success('Доверенность создана');
      setCreateOpen(false);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (poaId: string) => poaApi.delete(poaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['poas-all'] });
      message.success('Удалено');
    },
    onError: () => message.error('Ошибка удаления'),
  });

  function handlePrint(poaId: string) {
    const printUrl = poaApi.getPrintUrl(poaId);
    const token = useAuthStore.getState().accessToken;
    fetch(printUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((blob) => { window.open(URL.createObjectURL(blob), '_blank'); })
      .catch(() => message.error('Ошибка генерации PDF'));
  }

  const contractOptions = (contracts ?? []).map((c) => ({
    label: `${c.contractNumber} — ${c.client?.companyName || ''}`,
    value: c.id,
  }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Доверенности</Typography.Title>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Создать
          </Button>
        )}
      </div>

      <Card bordered={false}>
        <Table
          dataSource={poas ?? []}
          loading={isLoading}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 800 }}
          columns={[
            { title: '№', dataIndex: 'poaNumber', width: 140 },
            { title: 'Тип', dataIndex: 'poaType', width: 100, render: (v: string) => <Tag color={v === 'ANNUAL' ? 'blue' : 'default'}>{v === 'ANNUAL' ? 'Годовая' : 'Разовая'}</Tag> },
            {
              title: 'Договор', dataIndex: 'contract', render: (c: PowerOfAttorney['contract']) =>
                c ? <Link to={`/contracts/${c.id}`}>{c.contractNumber}</Link> : '—',
            },
            {
              title: 'Клиент', dataIndex: ['contract', 'client', 'companyName'],
              render: (v: string, r: PowerOfAttorney) => r.contract?.client ? <Link to={`/clients/${r.contract.client.id}`}>{v}</Link> : '—',
            },
            { title: 'Доверенное лицо', dataIndex: 'authorizedPersonName' },
            { title: 'Должность', dataIndex: 'authorizedPersonPosition', render: (v: string | null) => v || '—' },
            { title: 'С', dataIndex: 'validFrom', width: 110, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
            { title: 'По', dataIndex: 'validUntil', width: 110, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
            {
              title: '', width: 100, render: (_: unknown, r: PowerOfAttorney) => (
                <Space size="small">
                  <Button type="link" size="small" icon={<PrinterOutlined />} onClick={() => handlePrint(r.id)} />
                  {canDelete && (
                    <Popconfirm title="Удалить?" onConfirm={() => deleteMut.mutate(r.id)}>
                      <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Новая доверенность"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="Создать"
        cancelText="Отмена"
        width={560}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => createMut.mutate({
            contractId: v.contractId,
            poaNumber: v.poaNumber,
            poaType: v.poaType,
            authorizedPersonName: v.authorizedPersonName,
            authorizedPersonInn: v.authorizedPersonInn,
            authorizedPersonPosition: v.authorizedPersonPosition,
            validFrom: v.validFrom.format('YYYY-MM-DD'),
            validUntil: v.validUntil.format('YYYY-MM-DD'),
            notes: v.notes,
          })}
        >
          <Form.Item name="contractId" label="Договор" rules={[{ required: true, message: 'Выберите договор' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Выберите договор" options={contractOptions} />
          </Form.Item>
          <Form.Item name="poaNumber" label="Номер доверенности" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input placeholder="ДВР-001" />
          </Form.Item>
          <Form.Item name="poaType" label="Тип" rules={[{ required: true, message: 'Выберите тип' }]}>
            <Select options={[{ label: 'Годовая', value: 'ANNUAL' }, { label: 'Разовая', value: 'ONE_TIME' }]} />
          </Form.Item>
          <Form.Item name="authorizedPersonName" label="ФИО доверенного лица" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input placeholder="Иванов Иван Иванович" />
          </Form.Item>
          <Form.Item name="authorizedPersonPosition" label="Должность">
            <Input placeholder="Менеджер по закупкам" />
          </Form.Item>
          <Form.Item name="authorizedPersonInn" label="ИНН доверенного лица">
            <Input placeholder="123456789" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="validFrom" label="Действует с" rules={[{ required: true, message: 'Обязательное поле' }]} style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="validUntil" label="Действует до" rules={[{ required: true, message: 'Обязательное поле' }]} style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="Примечание">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
