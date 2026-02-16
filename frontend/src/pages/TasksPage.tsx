import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Button, Modal, Form, Input, Select, Typography, message, Tag, Space,
  DatePicker, Drawer, Upload, List, Badge, Popconfirm, Row, Col, theme,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, UploadOutlined, PaperClipOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, CheckOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { tasksApi } from '../api/tasks.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import type { Task, TaskStatus } from '../types';
import dayjs from 'dayjs';

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  TODO: { label: 'К выполнению', color: 'default' },
  IN_PROGRESS: { label: 'В работе', color: 'processing' },
  DONE: { label: 'Готово', color: 'warning' },
  APPROVED: { label: 'Утверждено', color: 'success' },
};

const COLUMNS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'APPROVED'];

export default function TasksPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [reportModal, setReportModal] = useState<Task | null>(null);
  const [reportText, setReportText] = useState('');
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list(),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  const createMut = useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      message.success('Задача создана');
      setCreateOpen(false);
      form.resetFields();
    },
    onError: () => message.error('Ошибка создания'),
  });

  const moveMut = useMutation({
    mutationFn: ({ id, status, report }: { id: string; status: TaskStatus; report?: string }) =>
      tasksApi.moveStatus(id, { status, report }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      message.success('Статус обновлён');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const uploadMut = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => tasksApi.uploadAttachment(id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      message.success('Файл загружен');
    },
    onError: () => message.error('Ошибка загрузки'),
  });

  const deleteMut = useMutation({
    mutationFn: tasksApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      message.success('Задача удалена');
      setDetailTask(null);
    },
    onError: () => message.error('Ошибка удаления'),
  });

  const handleMove = (task: Task, targetStatus: TaskStatus) => {
    if (targetStatus === 'DONE' && !task.report) {
      setReportModal(task);
      setReportText(task.report || '');
      return;
    }
    moveMut.mutate({ id: task.id, status: targetStatus });
  };

  const handleReportSubmit = () => {
    if (!reportModal) return;
    if (!reportText.trim()) {
      message.warning('Заполните отчёт');
      return;
    }
    moveMut.mutate({ id: reportModal.id, status: 'DONE', report: reportText });
    setReportModal(null);
  };

  const getNextStatuses = (status: TaskStatus): TaskStatus[] => {
    const transitions: Record<TaskStatus, TaskStatus[]> = {
      TODO: ['IN_PROGRESS'],
      IN_PROGRESS: ['TODO', 'DONE'],
      DONE: ['IN_PROGRESS', 'APPROVED'],
      APPROVED: [],
    };
    const allowed = transitions[status];
    if (status === 'DONE') {
      return isAdmin ? allowed : allowed.filter((s) => s !== 'APPROVED');
    }
    return allowed;
  };

  const tasksByStatus = (status: TaskStatus) =>
    tasks.filter((t) => t.status === status).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const renderTaskCard = (task: Task) => {
    const isOverdue = task.dueDate && dayjs(task.dueDate).isBefore(dayjs(), 'day') && task.status !== 'APPROVED';
    const nextStatuses = getNextStatuses(task.status);

    return (
      <Card
        key={task.id}
        size="small"
        style={{
          marginBottom: 8,
          cursor: 'pointer',
          borderLeft: `3px solid ${isOverdue ? token.colorError : token.colorPrimary}`,
        }}
        onClick={() => setDetailTask(task)}
      >
        <div style={{ marginBottom: 4 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>{task.title}</Typography.Text>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {task.assignee?.fullName}
          </Typography.Text>
          {task.dueDate && (
            <Typography.Text
              type={isOverdue ? 'danger' : 'secondary'}
              style={{ fontSize: 11 }}
            >
              {dayjs(task.dueDate).format('DD.MM')}
            </Typography.Text>
          )}
        </div>
        {(task._count?.attachments ?? 0) > 0 && (
          <div style={{ marginTop: 4 }}>
            <PaperClipOutlined style={{ fontSize: 11, color: token.colorTextSecondary }} />
            <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
              {task._count?.attachments}
            </Typography.Text>
          </div>
        )}
        {nextStatuses.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
            {nextStatuses.map((s) => {
              const isForward = COLUMNS.indexOf(s) > COLUMNS.indexOf(task.status);
              return (
                <Button
                  key={s}
                  size="small"
                  type={isForward ? 'primary' : 'default'}
                  icon={isForward ? <ArrowRightOutlined /> : <ArrowLeftOutlined />}
                  onClick={() => handleMove(task, s)}
                  loading={moveMut.isPending}
                  style={{ fontSize: 11 }}
                >
                  {STATUS_CONFIG[s].label}
                </Button>
              );
            })}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Задачи</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          Новая задача
        </Button>
      </div>

      <Row gutter={12}>
        {COLUMNS.map((status) => {
          const col = tasksByStatus(status);
          return (
            <Col key={status} xs={24} sm={12} lg={6}>
              <div style={{
                background: token.colorBgLayout,
                borderRadius: 8,
                padding: 12,
                minHeight: 400,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Tag color={STATUS_CONFIG[status].color}>
                    {STATUS_CONFIG[status].label}
                  </Tag>
                  <Badge count={col.length} showZero style={{ backgroundColor: token.colorTextQuaternary }} />
                </div>
                {isLoading ? (
                  <Card loading size="small" />
                ) : (
                  col.map(renderTaskCard)
                )}
              </div>
            </Col>
          );
        })}
      </Row>

      {/* Create Modal */}
      <Modal
        title="Новая задача"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="Создать"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical" onFinish={(v) => {
          createMut.mutate({
            title: v.title,
            description: v.description,
            assigneeId: v.assigneeId,
            dueDate: v.dueDate ? v.dueDate.toISOString() : undefined,
          });
        }}>
          <Form.Item name="title" label="Заголовок" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="assigneeId" label="Исполнитель" rules={[{ required: true, message: 'Обязательно' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={users.filter((u) => u.isActive).map((u) => ({ label: u.fullName, value: u.id }))}
            />
          </Form.Item>
          <Form.Item name="dueDate" label="Срок">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Report Modal (required to move to DONE) */}
      <Modal
        title="Отчёт о выполнении"
        open={!!reportModal}
        onCancel={() => setReportModal(null)}
        onOk={handleReportSubmit}
        confirmLoading={moveMut.isPending}
        okText="Завершить"
        cancelText="Отмена"
      >
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Для перевода задачи в &quot;Готово&quot; необходимо заполнить отчёт.
        </Typography.Text>
        <Input.TextArea
          rows={4}
          value={reportText}
          onChange={(e) => setReportText(e.target.value)}
          placeholder="Опишите что было сделано..."
        />
      </Modal>

      {/* Task Detail Drawer */}
      <Drawer
        title={detailTask?.title}
        open={!!detailTask}
        onClose={() => setDetailTask(null)}
        width={480}
        extra={
          detailTask && (isAdmin || detailTask.createdById === user?.id) ? (
            <Popconfirm title="Удалить задачу?" onConfirm={() => deleteMut.mutate(detailTask.id)}>
              <Button danger icon={<DeleteOutlined />} size="small">Удалить</Button>
            </Popconfirm>
          ) : null
        }
      >
        {detailTask && (
          <div>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div>
                <Typography.Text type="secondary">Статус</Typography.Text>
                <div><Tag color={STATUS_CONFIG[detailTask.status].color}>{STATUS_CONFIG[detailTask.status].label}</Tag></div>
              </div>

              {detailTask.description && (
                <div>
                  <Typography.Text type="secondary">Описание</Typography.Text>
                  <div><Typography.Text>{detailTask.description}</Typography.Text></div>
                </div>
              )}

              <div>
                <Typography.Text type="secondary">Исполнитель</Typography.Text>
                <div><Typography.Text>{detailTask.assignee?.fullName}</Typography.Text></div>
              </div>

              <div>
                <Typography.Text type="secondary">Постановщик</Typography.Text>
                <div><Typography.Text>{detailTask.createdBy?.fullName}</Typography.Text></div>
              </div>

              {detailTask.dueDate && (
                <div>
                  <Typography.Text type="secondary">Срок</Typography.Text>
                  <div><Typography.Text>{dayjs(detailTask.dueDate).format('DD.MM.YYYY')}</Typography.Text></div>
                </div>
              )}

              <div>
                <Typography.Text type="secondary">Создано</Typography.Text>
                <div><Typography.Text>{dayjs(detailTask.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text></div>
              </div>

              {/* Report section */}
              <div>
                <Typography.Text type="secondary">Отчёт</Typography.Text>
                {detailTask.report ? (
                  <div style={{
                    background: token.colorBgLayout,
                    padding: 12,
                    borderRadius: 6,
                    marginTop: 4,
                  }}>
                    <Typography.Text>{detailTask.report}</Typography.Text>
                  </div>
                ) : (
                  <div>
                    <Typography.Text type="secondary" italic>Не заполнен</Typography.Text>
                  </div>
                )}
                {(detailTask.status === 'IN_PROGRESS' || detailTask.status === 'DONE') && (
                  <Button
                    icon={<FileTextOutlined />}
                    size="small"
                    style={{ marginTop: 6 }}
                    onClick={() => {
                      setReportModal(detailTask);
                      setReportText(detailTask.report || '');
                    }}
                  >
                    {detailTask.report ? 'Редактировать отчёт' : 'Написать отчёт'}
                  </Button>
                )}
              </div>

              {/* Approval info */}
              {detailTask.approvedBy && (
                <div>
                  <Typography.Text type="secondary">Утверждено</Typography.Text>
                  <div>
                    <Typography.Text>
                      {detailTask.approvedBy.fullName} — {dayjs(detailTask.approvedAt).format('DD.MM.YYYY HH:mm')}
                    </Typography.Text>
                  </div>
                </div>
              )}

              {/* Approve button */}
              {detailTask.status === 'DONE' && isAdmin && (
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={() => handleMove(detailTask, 'APPROVED')}
                  loading={moveMut.isPending}
                >
                  Утвердить
                </Button>
              )}

              {/* Attachments */}
              <div>
                <Typography.Text type="secondary">Вложения</Typography.Text>
                <List
                  size="small"
                  dataSource={detailTask.attachments || []}
                  locale={{ emptyText: 'Нет вложений' }}
                  renderItem={(att) => (
                    <List.Item>
                      <a
                        href={tasksApi.downloadAttachmentUrl(detailTask.id, att.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <PaperClipOutlined /> {att.filename}
                      </a>
                      <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
                        {(att.size / 1024).toFixed(0)} KB
                      </Typography.Text>
                    </List.Item>
                  )}
                />
                <Upload
                  showUploadList={false}
                  beforeUpload={(file) => {
                    uploadMut.mutate({ id: detailTask.id, file });
                    return false;
                  }}
                >
                  <Button icon={<UploadOutlined />} size="small" style={{ marginTop: 8 }} loading={uploadMut.isPending}>
                    Загрузить файл
                  </Button>
                </Upload>
              </div>
            </Space>
          </div>
        )}
      </Drawer>
    </div>
  );
}
