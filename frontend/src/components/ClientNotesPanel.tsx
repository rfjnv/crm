import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Typography, Timeline, Button, Input, Space, Modal, Form, message, Spin, Empty, Tag, Popconfirm, theme,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import { clientsApi } from '../api/clients.api';
import { useAuthStore } from '../store/authStore';
import type { ClientNote } from '../types';

dayjs.extend(localizedFormat);
dayjs.locale('ru');

function groupNotesByDay(notes: ClientNote[]): { day: string; items: ClientNote[] }[] {
  const map = new Map<string, ClientNote[]>();
  for (const n of notes) {
    const key = dayjs(n.createdAt).format('YYYY-MM-DD');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({ day, items }));
}

export default function ClientNotesPanel({ clientId }: { clientId: string }) {
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [editing, setEditing] = useState<ClientNote | null>(null);

  const { data: notes, isLoading } = useQuery({
    queryKey: ['client-notes', clientId, isSuperAdmin ? 'with_deleted' : 'active'],
    queryFn: () => clientsApi.notes.list(clientId, { includeDeleted: isSuperAdmin }),
    enabled: !!clientId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['client-notes', clientId] });
    queryClient.invalidateQueries({ queryKey: ['clients'] });
    queryClient.invalidateQueries({ queryKey: ['client', clientId] });
  };

  const createMut = useMutation({
    mutationFn: (content: string) => clientsApi.notes.create(clientId, { content }),
    onSuccess: () => {
      message.success('Заметка добавлена');
      addForm.resetFields();
      invalidate();
    },
    onError: () => message.error('Не удалось сохранить заметку'),
  });

  const updateMut = useMutation({
    mutationFn: ({ noteId, content }: { noteId: string; content: string }) =>
      clientsApi.notes.update(clientId, noteId, { content }),
    onSuccess: () => {
      message.success('Заметка обновлена');
      setEditing(null);
      invalidate();
    },
    onError: () => message.error('Не удалось обновить заметку'),
  });

  const deleteMut = useMutation({
    mutationFn: (noteId: string) => clientsApi.notes.delete(clientId, noteId),
    onSuccess: () => {
      message.success('Заметка удалена');
      invalidate();
    },
    onError: () => message.error('Не удалось удалить заметку'),
  });

  const restoreMut = useMutation({
    mutationFn: (noteId: string) => clientsApi.notes.restore(clientId, noteId),
    onSuccess: () => {
      message.success('Заметка восстановлена');
      invalidate();
    },
    onError: () => message.error('Не удалось восстановить заметку'),
  });

  const canModify = (n: ClientNote) =>
    !n.deletedAt && user && (user.id === n.userId || isSuperAdmin);

  if (isLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />;
  }

  const grouped = groupNotesByDay(notes ?? []);

  return (
    <Card bordered={false}>
      <Form
        form={addForm}
        layout="vertical"
        onFinish={(v: { content: string }) => {
          const t = (v.content ?? '').trim();
          if (!t) {
            message.warning('Введите текст заметки');
            return;
          }
          createMut.mutate(t);
        }}
      >
        <Form.Item name="content" label="Новая заметка" rules={[{ required: true, message: 'Введите текст' }]}>
          <Input.TextArea rows={3} placeholder="Текст заметки…" maxLength={20000} showCount />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={createMut.isPending}>
          Добавить
        </Button>
      </Form>

      {!notes || notes.length === 0 ? (
        <Empty style={{ marginTop: 24 }} description="Пока нет заметок" />
      ) : (
        <div style={{ marginTop: 24 }}>
          {grouped.map(({ day, items }) => (
            <div key={day} style={{ marginBottom: token.marginLG }}>
              <Typography.Title level={5} style={{ marginBottom: token.marginSM, color: token.colorTextSecondary }}>
                {dayjs(day).format('LL')}
              </Typography.Title>
              <Timeline
                items={items.map((n) => ({
                  color: n.deletedAt ? 'gray' : 'blue',
                  children: (
                    <Card
                      size="small"
                      style={{
                        maxWidth: 640,
                        marginBottom: token.marginXS,
                        opacity: n.deletedAt ? 0.75 : 1,
                        borderRadius: token.borderRadiusLG,
                      }}
                    >
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space wrap size={8}>
                          <Typography.Text strong>{n.user.fullName}</Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {dayjs(n.createdAt).format('HH:mm')}
                          </Typography.Text>
                          {n.deletedAt && <Tag color="default">Удалена</Tag>}
                        </Space>
                        <Typography.Paragraph
                          style={{
                            marginBottom: 0,
                            whiteSpace: 'pre-wrap',
                            textDecoration: n.deletedAt ? 'line-through' : undefined,
                          }}
                          type={n.deletedAt ? 'secondary' : undefined}
                        >
                          {n.content}
                        </Typography.Paragraph>
                        <Space wrap size="small">
                          {canModify(n) && (
                            <>
                              <Button
                                type="link"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  setEditing(n);
                                  editForm.setFieldsValue({ content: n.content });
                                }}
                              >
                                Изменить
                              </Button>
                              <Popconfirm title="Удалить заметку?" onConfirm={() => deleteMut.mutate(n.id)}>
                                <Button type="link" size="small" danger icon={<DeleteOutlined />} loading={deleteMut.isPending}>
                                  Удалить
                                </Button>
                              </Popconfirm>
                            </>
                          )}
                          {isSuperAdmin && n.deletedAt && (
                            <Button
                              type="link"
                              size="small"
                              icon={<RollbackOutlined />}
                              loading={restoreMut.isPending}
                              onClick={() => restoreMut.mutate(n.id)}
                            >
                              Восстановить
                            </Button>
                          )}
                        </Space>
                      </Space>
                    </Card>
                  ),
                }))}
              />
            </div>
          ))}
        </div>
      )}

      <Modal
        title="Редактировать заметку"
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        confirmLoading={updateMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v: { content: string }) => {
            if (!editing) return;
            const t = (v.content ?? '').trim();
            if (!t) {
              message.warning('Введите текст');
              return;
            }
            updateMut.mutate({ noteId: editing.id, content: t });
          }}
        >
          <Form.Item name="content" rules={[{ required: true, message: 'Введите текст' }]}>
            <Input.TextArea rows={5} maxLength={20000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
