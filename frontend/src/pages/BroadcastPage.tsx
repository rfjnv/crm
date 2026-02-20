import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Typography, Form, Input, Select, Radio, InputNumber, Button, Card,
  message, Space, Table, Tag, Alert, Result, Divider,
} from 'antd';
import { SendOutlined, EyeOutlined, LinkOutlined } from '@ant-design/icons';
import { notificationsApi } from '../api/notifications.api';
import { usersApi } from '../api/users.api';
import { dealsApi } from '../api/deals.api';
import type { BroadcastTargets, UserRole } from '../types';

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Супер Админ',
  ADMIN: 'Админ',
  OPERATOR: 'Оператор',
  MANAGER: 'Менеджер',
  ACCOUNTANT: 'Бухгалтер',
  WAREHOUSE: 'Склад',
  WAREHOUSE_MANAGER: 'Зав. складом',
};

const operatorLabels = [
  { label: 'Меньше (<)', value: 'LT' },
  { label: 'Больше (>)', value: 'GT' },
  { label: 'Меньше или равно (<=)', value: 'LTE' },
  { label: 'Больше или равно (>=)', value: 'GTE' },
];

export default function BroadcastPage() {
  const [form] = Form.useForm();
  const [targetType, setTargetType] = useState<BroadcastTargets['type']>('ALL');
  const [previewData, setPreviewData] = useState<{ count: number; users: { id: string; fullName: string; role: string }[] } | null>(null);
  const [lastSendResult, setLastSendResult] = useState<{ recipientCount: number; title: string; dealTitle?: string; recipients: { id: string; fullName: string; role: string }[] } | null>(null);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  const { data: deals } = useQuery({
    queryKey: ['deals-all'],
    queryFn: () => dealsApi.list(undefined, true),
  });

  const broadcastMut = useMutation({
    mutationFn: notificationsApi.broadcast,
    onSuccess: (result) => {
      const formValues = form.getFieldsValue();
      const selectedDeal = deals?.find((d) => d.id === formValues.dealId);
      setLastSendResult({
        recipientCount: result.recipientCount,
        title: formValues.title,
        dealTitle: selectedDeal?.title,
        recipients: previewData?.users ?? [],
      });
      message.success(`Рассылка отправлена: ${result.recipientCount} получателей`);
      form.resetFields();
      setTargetType('ALL');
      setPreviewData(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка отправки';
      message.error(msg);
    },
  });

  const previewMut = useMutation({
    mutationFn: notificationsApi.previewRecipients,
    onSuccess: (data) => setPreviewData(data),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка предпросмотра';
      message.error(msg);
    },
  });

  const buildTargets = (): BroadcastTargets => {
    const values = form.getFieldsValue();
    switch (targetType) {
      case 'USERS':
        return { type: 'USERS', userIds: values.userIds || [] };
      case 'ROLES':
        return { type: 'ROLES', roles: values.roles || [] };
      case 'DEALS_COUNT':
        return {
          type: 'DEALS_COUNT',
          periodDays: values.periodDays || 30,
          operator: values.operator || 'LT',
          value: values.dealValue ?? 0,
          ...(values.roleFilter ? { roleFilter: values.roleFilter } : {}),
        };
      default:
        return { type: 'ALL' };
    }
  };

  const handlePreview = () => {
    const targets = buildTargets();
    previewMut.mutate(targets);
  };

  const handleSubmit = (values: Record<string, unknown>) => {
    const targets = buildTargets();
    const link = values.dealId
      ? `/deals/${values.dealId}`
      : (values.link as string) || undefined;
    broadcastMut.mutate({
      title: values.title as string,
      body: values.body as string,
      severity: (values.severity as 'INFO' | 'WARNING' | 'URGENT') || 'INFO',
      ...(link ? { link } : {}),
      targets,
    });
  };

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>Рассылка уведомлений</Typography.Title>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <Card bordered={false}>
          <Form form={form} layout="vertical" onFinish={handleSubmit}>
            <Form.Item name="title" label="Заголовок" rules={[{ required: true, message: 'Обязательное поле' }, { max: 120, message: 'Максимум 120 символов' }]}>
              <Input placeholder="Тема уведомления" />
            </Form.Item>

            <Form.Item name="body" label="Текст" rules={[{ required: true, message: 'Обязательное поле' }, { max: 2000, message: 'Максимум 2000 символов' }]}>
              <Input.TextArea rows={4} placeholder="Текст уведомления..." showCount maxLength={2000} />
            </Form.Item>

            <Space style={{ width: '100%' }} size="middle">
              <Form.Item name="severity" label="Важность" initialValue="INFO" style={{ flex: 1 }}>
                <Select
                  options={[
                    { label: 'Информация', value: 'INFO' },
                    { label: 'Важно', value: 'WARNING' },
                    { label: 'Срочно', value: 'URGENT' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="dealId" label="Привязать к сделке" style={{ flex: 2 }}>
                <Select
                  showSearch
                  allowClear
                  placeholder="Выберите сделку..."
                  optionFilterProp="label"
                  suffixIcon={<LinkOutlined />}
                  options={(deals ?? []).map((d) => ({
                    label: `${d.title} — ${d.client?.companyName ?? ''}`,
                    value: d.id,
                  }))}
                />
              </Form.Item>
            </Space>

            <Form.Item name="link" label="Или ссылка вручную (необязательно)">
              <Input placeholder="/deals/... или /dashboard" />
            </Form.Item>

            <Form.Item label="Получатели">
              <Radio.Group
                value={targetType}
                onChange={(e) => { setTargetType(e.target.value); setPreviewData(null); }}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { label: 'Все', value: 'ALL' },
                  { label: 'Пользователи', value: 'USERS' },
                  { label: 'Роли', value: 'ROLES' },
                  { label: 'По сделкам', value: 'DEALS_COUNT' },
                ]}
              />
            </Form.Item>

            {targetType === 'USERS' && (
              <Form.Item name="userIds" label="Выберите пользователей" rules={[{ required: true, message: 'Выберите хотя бы одного' }]}>
                <Select
                  mode="multiple"
                  showSearch
                  optionFilterProp="label"
                  placeholder="Выберите пользователей"
                  options={(users ?? []).filter((u) => u.isActive).map((u) => ({
                    label: `${u.fullName} (${roleLabels[u.role] || u.role})`,
                    value: u.id,
                  }))}
                />
              </Form.Item>
            )}

            {targetType === 'ROLES' && (
              <Form.Item name="roles" label="Выберите роли" rules={[{ required: true, message: 'Выберите хотя бы одну роль' }]}>
                <Select
                  mode="multiple"
                  placeholder="Выберите роли"
                  options={Object.entries(roleLabels).map(([value, label]) => ({ label, value }))}
                />
              </Form.Item>
            )}

            {targetType === 'DEALS_COUNT' && (
              <Card size="small" style={{ marginBottom: 16 }}>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Отправить пользователям у которых количество сделок за указанный период
                </Typography.Text>
                <Space wrap style={{ width: '100%' }}>
                  <Form.Item name="operator" label="Условие" initialValue="LT" style={{ marginBottom: 8 }}>
                    <Select options={operatorLabels} style={{ width: 200 }} />
                  </Form.Item>
                  <Form.Item name="dealValue" label="Значение" initialValue={5} style={{ marginBottom: 8 }}>
                    <InputNumber min={0} style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item name="periodDays" label="За дней" initialValue={30} style={{ marginBottom: 8 }}>
                    <InputNumber min={1} max={365} style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item name="roleFilter" label="Только роль" style={{ marginBottom: 8 }}>
                    <Select
                      allowClear
                      placeholder="Все роли"
                      style={{ width: 160 }}
                      options={Object.entries(roleLabels).map(([value, label]) => ({ label, value }))}
                    />
                  </Form.Item>
                </Space>
              </Card>
            )}

            <Space>
              <Button icon={<EyeOutlined />} onClick={handlePreview} loading={previewMut.isPending}>
                Предпросмотр получателей
              </Button>
              <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={broadcastMut.isPending}>
                Отправить
              </Button>
            </Space>
          </Form>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Preview recipients */}
          {previewData && (
            <Card bordered={false} title={`Получатели (${previewData.count})`}>
              {previewData.count === 0 ? (
                <Alert message="Нет пользователей, соответствующих критериям" type="warning" showIcon />
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {previewData.users.map((u) => (
                      <Tag key={u.id} color="blue">
                        {u.fullName} ({roleLabels[u.role] || u.role})
                      </Tag>
                    ))}
                  </div>
                  <Table
                    dataSource={previewData.users}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    columns={[
                      { title: 'Имя', dataIndex: 'fullName' },
                      {
                        title: 'Роль',
                        dataIndex: 'role',
                        render: (r: UserRole) => <Tag>{roleLabels[r] || r}</Tag>,
                      },
                    ]}
                  />
                </>
              )}
            </Card>
          )}

          {/* Last send result */}
          {lastSendResult && (
            <Card bordered={false}>
              <Result
                status="success"
                title="Рассылка отправлена"
                subTitle={
                  <div>
                    <div><strong>{lastSendResult.title}</strong></div>
                    <div>Получателей: {lastSendResult.recipientCount}</div>
                    {lastSendResult.dealTitle && (
                      <div>Сделка: {lastSendResult.dealTitle}</div>
                    )}
                  </div>
                }
              />
              {lastSendResult.recipients.length > 0 && (
                <>
                  <Divider>Кому отправлено</Divider>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {lastSendResult.recipients.map((u) => (
                      <Tag key={u.id} color="green">
                        {u.fullName} ({roleLabels[u.role] || u.role})
                      </Tag>
                    ))}
                  </div>
                </>
              )}
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Button type="link" onClick={() => setLastSendResult(null)}>Новая рассылка</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
