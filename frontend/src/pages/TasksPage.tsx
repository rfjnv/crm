import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Button, Modal, Form, Input, Select, Typography, message, Tag, Space,
  DatePicker, Drawer, Upload, List, Badge, Popconfirm, Row, Col, theme, Segmented, Calendar, ColorPicker,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, UploadOutlined, PaperClipOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, CheckOutlined, FileTextOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { tasksApi } from '../api/tasks.api';
import { usersApi } from '../api/users.api';
import { profileApi } from '../api/profile.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
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
  const [dateViewMode, setDateViewMode] = useState<'ALL' | 'TODAY' | 'SELECTED'>('TODAY');
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const isMobile = useIsMobile();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list(),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  });

  const { data: myGoal } = useQuery({
    queryKey: ['profile-monthly-goal'],
    queryFn: () => profileApi.monthlyGoal(),
    refetchInterval: 60_000,
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

  const matchesActiveDate = (task: Task) => {
    if (dateViewMode === 'ALL') return true;
    const base = task.plannedDate || task.dueDate;
    if (!base) return false;
    const compareDate = dateViewMode === 'TODAY' ? dayjs() : selectedDate;
    return dayjs(base).isSame(compareDate, 'day');
  };

  const visibleTasks = tasks.filter(matchesActiveDate);

  const tasksByStatus = (status: TaskStatus) =>
    visibleTasks.filter((t) => t.status === status).sort((a, b) =>
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
          borderLeft: `6px solid ${task.color || (isOverdue ? token.colorError : token.colorPrimary)}`,
          background: task.color ? `${task.color}12` : token.colorBgContainer,
          borderRadius: 12,
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
        {task.plannedDate && (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            План: {dayjs(task.plannedDate).format('DD.MM.YYYY')}
          </Typography.Text>
        )}
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
        <Space>
          <Segmented
            value={dateViewMode}
            onChange={(v) => setDateViewMode(v as 'ALL' | 'TODAY' | 'SELECTED')}
            options={[
              { label: 'Сегодня', value: 'TODAY' },
              { label: 'Выбранная дата', value: 'SELECTED' },
              { label: 'Все', value: 'ALL' },
            ]}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setCreateOpen(true);
              if (!isAdmin && user?.id) {
                form.setFieldValue('assigneeId', user.id);
              }
            }}
          >
            Новая задача
          </Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 12, borderRadius: 16 }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={10}>
            <Typography.Text type="secondary">
              <CalendarOutlined /> Календарь планов
            </Typography.Text>
            <Calendar
              fullscreen={false}
              value={selectedDate}
              style={{ borderRadius: 14, background: token.colorBgContainer }}
              onSelect={(d) => {
                setSelectedDate(d);
                setDateViewMode('SELECTED');
              }}
            />
          </Col>
          <Col xs={24} md={14}>
            <Typography.Text strong>
              Планы на {dateViewMode === 'TODAY' ? 'сегодня' : selectedDate.format('DD.MM.YYYY')}
            </Typography.Text>
            <List
              size="small"
              style={{ marginTop: 8 }}
              locale={{ emptyText: 'На выбранную дату задач нет' }}
              dataSource={visibleTasks.slice(0, 8)}
              renderItem={(task) => (
                <List.Item>
                  <Space>
                    <span style={{ width: 10, height: 10, borderRadius: 10, background: task.color || token.colorPrimary }} />
                    <Typography.Text>{task.title}</Typography.Text>
                    <Tag>{STATUS_CONFIG[task.status].label}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Col>
        </Row>
      </Card>

      {myGoal && (myGoal.targets.deals != null || myGoal.targets.revenue != null || myGoal.targets.callNotes != null) && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            Мои цели на {dayjs().format('MMMM YYYY')}
          </Typography.Text>
          <Row gutter={[12, 8]}>
            {myGoal.targets.deals != null && (
              <Col xs={24} md={8}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Сделки</Typography.Text>
                <div style={{ fontSize: 13 }}>{myGoal.actual.dealsClosed} / {myGoal.targets.deals}</div>
                <Tag color="blue">{myGoal.progress.deals ?? 0}%</Tag>
              </Col>
            )}
            {myGoal.targets.revenue != null && (
              <Col xs={24} md={8}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Выручка</Typography.Text>
                <div style={{ fontSize: 13 }}>{myGoal.actual.revenue} / {myGoal.targets.revenue}</div>
                <Tag color="purple">{myGoal.progress.revenue ?? 0}%</Tag>
              </Col>
            )}
            {myGoal.targets.callNotes != null && (
              <Col xs={24} md={8}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Обзвоны</Typography.Text>
                <div style={{ fontSize: 13 }}>{myGoal.actual.callNotes} / {myGoal.targets.callNotes}</div>
                <Tag color="cyan">{myGoal.progress.callNotes ?? 0}%</Tag>
              </Col>
            )}
          </Row>
        </Card>
      )}

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
          const assigneeId = isAdmin ? v.assigneeId : user?.id;
          if (!assigneeId) {
            message.error('Не удалось определить исполнителя');
            return;
          }
          createMut.mutate({
            title: v.title,
            description: v.description,
            assigneeId,
            dueDate: v.dueDate ? v.dueDate.toISOString() : undefined,
            plannedDate: v.plannedDate ? v.plannedDate.toISOString() : undefined,
            color: typeof v.color === 'string' ? v.color : v.color?.toHexString?.(),
          });
        }}>
          <Form.Item name="title" label="Заголовок" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="assigneeId"
            label="Исполнитель"
            rules={[{ required: true, message: 'Обязательно' }]}
            extra={!isAdmin ? 'Исполнитель назначается автоматически: вы' : undefined}
          >
            <Select
              showSearch
              disabled={!isAdmin}
              optionFilterProp="label"
              options={users.filter((u) => u.isActive).map((u) => ({ label: u.fullName, value: u.id }))}
            />
          </Form.Item>
          <Form.Item name="dueDate" label="Срок">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="plannedDate" label="План на дату">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item
            name="color"
            label="Цвет задачи"
            getValueFromEvent={(v: string | { toHexString?: () => string }) =>
              typeof v === 'string' ? v : v?.toHexString?.() ?? '#22609A'
            }
          >
            <ColorPicker showText format="hex" disabledAlpha />
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
        width={isMobile ? '100%' : 480}
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

              {detailTask.plannedDate && (
                <div>
                  <Typography.Text type="secondary">Плановая дата</Typography.Text>
                  <div><Typography.Text>{dayjs(detailTask.plannedDate).format('DD.MM.YYYY')}</Typography.Text></div>
                </div>
              )}

              {detailTask.color && (
                <div>
                  <Typography.Text type="secondary">Цвет</Typography.Text>
                  <div>
                    <Tag color={detailTask.color}>{detailTask.color}</Tag>
                  </div>
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
