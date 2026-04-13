import { useState } from 'react';
import {
  Card, Button, Typography, Input, Switch, Space, Spin, Empty,
  Popconfirm, Modal, Form, message, Tag, theme,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ArrowLeftOutlined,
  BookOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiTrainingApi, type AiTrainingRule } from '../api/ai-assistant.api';

const { Title, Text, Paragraph } = Typography;

export default function AiTrainingPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AiTrainingRule | null>(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token: themeToken } = theme.useToken();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['ai-training-rules'],
    queryFn: aiTrainingApi.list,
  });

  const createMutation = useMutation({
    mutationFn: aiTrainingApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-training-rules'] });
      setModalOpen(false);
      form.resetFields();
      message.success('Правило создано');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof aiTrainingApi.update>[1] }) =>
      aiTrainingApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-training-rules'] });
      setModalOpen(false);
      setEditingRule(null);
      form.resetFields();
      message.success('Правило обновлено');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: aiTrainingApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-training-rules'] });
      message.success('Правило удалено');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      aiTrainingApi.update(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-training-rules'] });
    },
  });

  const openCreate = () => {
    setEditingRule(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (rule: AiTrainingRule) => {
    setEditingRule(rule);
    form.setFieldsValue({ title: rule.title, content: rule.content });
    setModalOpen(true);
  };

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      if (editingRule) {
        updateMutation.mutate({ id: editingRule.id, data: values });
      } else {
        createMutation.mutate(values);
      }
    });
  };

  const activeCount = rules.filter((r) => r.isActive).length;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/ai-assistant')}
        />
        <div style={{ flex: 1 }}>
          <Title level={4} style={{ margin: 0 }}>
            <BookOutlined style={{ marginRight: 8 }} />
            Обучение AI ассистента
          </Title>
          <Text type="secondary">
            Добавьте правила и инструкции, чтобы AI лучше понимал ваш бизнес
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Новое правило
        </Button>
      </div>

      {activeCount > 0 && (
        <div style={{
          padding: '10px 16px',
          marginBottom: 16,
          borderRadius: 8,
          background: themeToken.colorSuccessBg,
          border: `1px solid ${themeToken.colorSuccessBorder}`,
        }}>
          <Text>
            <CheckCircleOutlined style={{ color: themeToken.colorSuccess, marginRight: 8 }} />
            Активных правил: <strong>{activeCount}</strong> из {rules.length}
            {' '}— AI учитывает их при каждом ответе
          </Text>
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
      ) : rules.length === 0 ? (
        <Empty
          description={
            <span>
              Нет правил обучения.<br />
              <Text type="secondary">
                Создайте правила, чтобы AI знал особенности вашего бизнеса
              </Text>
            </span>
          }
          style={{ padding: 60 }}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Создать первое правило
          </Button>
        </Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rules.map((rule) => (
            <Card
              key={rule.id}
              size="small"
              style={{
                borderRadius: 10,
                opacity: rule.isActive ? 1 : 0.6,
                transition: 'opacity 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Switch
                  checked={rule.isActive}
                  onChange={(checked) => toggleMutation.mutate({ id: rule.id, isActive: checked })}
                  size="small"
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Text strong>{rule.title}</Text>
                    <Tag color={rule.isActive ? 'green' : 'default'} style={{ borderRadius: 8 }}>
                      {rule.isActive ? 'Активно' : 'Отключено'}
                    </Tag>
                  </div>
                  <Paragraph
                    type="secondary"
                    style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}
                    ellipsis={{ rows: 3, expandable: true, symbol: 'Показать всё' }}
                  >
                    {rule.content}
                  </Paragraph>
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Автор: {rule.author.fullName} · {new Date(rule.createdAt).toLocaleDateString('ru')}
                    </Text>
                  </div>
                </div>
                <Space>
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => openEdit(rule)}
                  />
                  <Popconfirm
                    title="Удалить правило?"
                    description="AI больше не будет использовать это правило"
                    onConfirm={() => deleteMutation.mutate(rule.id)}
                    okText="Удалить"
                    cancelText="Отмена"
                  >
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title={editingRule ? 'Редактировать правило' : 'Новое правило'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditingRule(null); form.resetFields(); }}
        onOk={handleSubmit}
        okText={editingRule ? 'Сохранить' : 'Создать'}
        cancelText="Отмена"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="title"
            label="Название правила"
            rules={[{ required: true, message: 'Введите название' }]}
          >
            <Input placeholder="Например: Валюта компании" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="content"
            label="Содержание правила"
            rules={[{ required: true, message: 'Введите содержание' }]}
            extra="Напишите инструкцию для AI на простом языке"
          >
            <Input.TextArea
              rows={5}
              placeholder="Например: Наша валюта — узбекский сум (UZS). Когда показываешь суммы, используй формат: 1,000,000 UZS"
              maxLength={5000}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>

      <div style={{ marginTop: 32, padding: 16, borderRadius: 10, background: themeToken.colorBgLayout }}>
        <Title level={5} style={{ marginTop: 0 }}>
          <CloseCircleOutlined style={{ marginRight: 8, color: themeToken.colorTextSecondary }} />
          Примеры правил
        </Title>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { t: 'Валюта', c: 'Наша валюта — узбекский сум (UZS). Форматируй суммы: 1,000,000 UZS' },
            { t: 'VIP клиенты', c: 'Клиенты с долгом более 50,000,000 UZS — VIP. Упоминай это при анализе' },
            { t: 'Рабочие дни', c: 'Рабочие дни: понедельник-суббота. Воскресенье — выходной' },
            { t: 'Терминология', c: 'Полиграфия — наша основная сфера. Товары: бумага, плёнка, ламинация, краски' },
          ].map(({ t, c }) => (
            <div
              key={t}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: themeToken.colorBgContainer,
                border: `1px solid ${themeToken.colorBorderSecondary}`,
                cursor: 'pointer',
              }}
              onClick={() => {
                form.setFieldsValue({ title: t, content: c });
                setEditingRule(null);
                setModalOpen(true);
              }}
            >
              <Text strong style={{ fontSize: 13 }}>{t}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>{c}</Text>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
