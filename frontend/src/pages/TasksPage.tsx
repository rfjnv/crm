import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Button, Modal, Form, Input, Select, Typography, message, Tag, Space,
  DatePicker, Drawer, Upload, List, Badge, Popconfirm, Row, Col, theme, Segmented, Calendar, ColorPicker, Checkbox,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, UploadOutlined, PaperClipOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, CheckOutlined, FileTextOutlined,
  CalendarOutlined, LeftOutlined, RightOutlined, ClockCircleOutlined,
  AppstoreOutlined, WarningOutlined,
} from '@ant-design/icons';
import { tasksApi } from '../api/tasks.api';
import { usersApi } from '../api/users.api';
import { profileApi } from '../api/profile.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { useThemeStore } from '../store/themeStore';
import type { Task, TaskChecklistItem, TaskStatus } from '../types';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);
dayjs.locale('ru');

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  TODO: { label: 'К выполнению', color: 'default' },
  IN_PROGRESS: { label: 'В работе', color: 'processing' },
  DONE: { label: 'Готово', color: 'warning' },
  APPROVED: { label: 'Утверждено', color: 'success' },
};

const COLUMNS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'APPROVED'];

type DateViewMode = 'TODAY' | 'WEEK' | 'ALL';

function getTaskAnchorDate(task: Task) {
  const base = task.plannedDate || task.dueDate;
  return base ? dayjs(base) : null;
}

function sortTasksByAnchor(items: Task[]) {
  return [...items].sort((a, b) => {
    const aAnchor = getTaskAnchorDate(a);
    const bAnchor = getTaskAnchorDate(b);
    if (aAnchor && bAnchor && !aAnchor.isSame(bAnchor)) {
      return aAnchor.valueOf() - bAnchor.valueOf();
    }
    if (aAnchor && !bAnchor) return -1;
    if (!aAnchor && bAnchor) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function normalizeChecklist(items: Array<{ text?: string; checked?: boolean }> | undefined): TaskChecklistItem[] {
  return (items || [])
    .map((item) => ({
      text: (item.text || '').trim(),
      checked: Boolean(item.checked),
    }))
    .filter((item) => item.text.length > 0);
}

export default function TasksPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [reportModal, setReportModal] = useState<Task | null>(null);
  const [reportText, setReportText] = useState('');
  const [dateViewMode, setDateViewMode] = useState<DateViewMode>('WEEK');
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const isDark = useThemeStore((s) => s.mode) === 'dark';
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

  const updateTaskMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof tasksApi.update>[1] }) =>
      tasksApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setDetailTask((current) => (current?.id === updated.id ? updated : current));
    },
    onError: () => message.error('Не удалось обновить задачу'),
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

  const weekStart = selectedDate.startOf('isoWeek');
  const weekEnd = selectedDate.endOf('isoWeek');
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => weekStart.add(index, 'day')),
    [weekStart],
  );

  const todayTasks = useMemo(
    () => sortTasksByAnchor(tasks.filter((task) => getTaskAnchorDate(task)?.isSame(dayjs(), 'day'))),
    [tasks],
  );
  const selectedDayTasks = useMemo(
    () => sortTasksByAnchor(tasks.filter((task) => getTaskAnchorDate(task)?.isSame(selectedDate, 'day'))),
    [selectedDate, tasks],
  );
  const weekTasks = useMemo(
    () => sortTasksByAnchor(tasks.filter((task) => getTaskAnchorDate(task)?.isSame(selectedDate, 'isoWeek'))),
    [selectedDate, tasks],
  );
  const tasksWithoutDate = useMemo(
    () => tasks.filter((task) => !getTaskAnchorDate(task)),
    [tasks],
  );
  const overdueTasks = useMemo(
    () => tasks.filter((task) => {
      if (!task.dueDate || task.status === 'APPROVED') return false;
      return dayjs(task.dueDate).isBefore(dayjs(), 'day');
    }),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    if (dateViewMode === 'ALL') return sortTasksByAnchor(tasks);
    if (dateViewMode === 'TODAY') return todayTasks;
    return weekTasks;
  }, [dateViewMode, tasks, todayTasks, weekTasks]);
  const agendaTasks = dateViewMode === 'TODAY' ? todayTasks : dateViewMode === 'ALL' ? visibleTasks : weekTasks;
  const agendaLabel = dateViewMode === 'TODAY'
    ? 'Фокус на сегодня'
    : dateViewMode === 'ALL'
      ? 'Все задачи'
      : 'План недели';
  const upcomingTasks = agendaTasks.slice(0, 3);

  const tasksOnCalendarDay = (d: dayjs.Dayjs) =>
    sortTasksByAnchor(tasks.filter((task) => getTaskAnchorDate(task)?.isSame(d, 'day')));

  const tasksByStatus = (status: TaskStatus) =>
    sortTasksByAnchor(visibleTasks.filter((task) => task.status === status));

  const getTaskAccent = (task: Task) => {
    const isOverdue = task.dueDate && dayjs(task.dueDate).isBefore(dayjs(), 'day') && task.status !== 'APPROVED';
    return task.color || (isOverdue ? token.colorError : token.colorPrimary);
  };

  const formatTaskAnchor = (task: Task) => {
    if (task.plannedDate) return `План: ${dayjs(task.plannedDate).format('DD MMM')}`;
    if (task.dueDate) return `Срок: ${dayjs(task.dueDate).format('DD MMM')}`;
    return 'Без даты';
  };

  const getChecklistMeta = (task: Task) => {
    const items = task.checklist || [];
    const done = items.filter((item) => item.checked).length;
    return { total: items.length, done };
  };

  const sectionSurface = isDark
    ? `linear-gradient(180deg, ${token.colorBgContainer} 0%, ${token.colorFillAlter} 45%, ${token.colorBgLayout} 100%)`
    : token.colorBgContainer;
  const panelSurface = isDark
    ? `linear-gradient(180deg, ${token.colorBgContainer} 0%, ${token.colorBgElevated} 100%)`
    : token.colorBgContainer;
  const accentSurface = isDark
    ? `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 100%)`
    : token.colorPrimaryBg;
  const selectedDaySurface = isDark
    ? `linear-gradient(180deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 100%)`
    : token.colorPrimaryBg;
  const daySurface = isDark
    ? `linear-gradient(180deg, ${token.colorBgElevated} 0%, ${token.colorBgContainer} 100%)`
    : token.colorBgElevated;

  const renderTaskCard = (task: Task) => {
    const isOverdue = task.dueDate && dayjs(task.dueDate).isBefore(dayjs(), 'day') && task.status !== 'APPROVED';
    const nextStatuses = getNextStatuses(task.status);
    const accent = getTaskAccent(task);
    const checklistMeta = getChecklistMeta(task);

    return (
      <Card
        key={task.id}
        size="small"
        style={{
          marginBottom: 10,
          cursor: 'pointer',
          borderLeft: `5px solid ${accent}`,
          background: task.color ? `${task.color}14` : token.colorBgContainer,
          borderRadius: 18,
          borderColor: token.colorBorderSecondary,
          boxShadow: token.boxShadowSecondary,
        }}
        onClick={() => setDetailTask(task)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <Typography.Text strong style={{ fontSize: 13, lineHeight: 1.35 }}>{task.title}</Typography.Text>
          <Tag color={STATUS_CONFIG[task.status].color} style={{ margin: 0 }}>
            {STATUS_CONFIG[task.status].label}
          </Tag>
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
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {formatTaskAnchor(task)}
          </Typography.Text>
          {isOverdue ? <Tag color="error" style={{ margin: 0 }}>Просрочено</Tag> : null}
        </div>
        {(task._count?.attachments ?? 0) > 0 && (
          <div style={{ marginTop: 4 }}>
            <PaperClipOutlined style={{ fontSize: 11, color: token.colorTextSecondary }} />
            <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
              {task._count?.attachments}
            </Typography.Text>
          </div>
        )}
        {checklistMeta.total > 0 && (
          <div style={{ marginTop: 6 }}>
            <Tag bordered={false} style={{ margin: 0, borderRadius: 999, background: token.colorFillTertiary }}>
              Чеклист: {checklistMeta.done}/{checklistMeta.total}
            </Tag>
          </div>
        )}
        {nextStatuses.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 4, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
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

  const renderScheduleCard = (task: Task, compact = false, lane = false) => {
    const accent = getTaskAccent(task);
    const isOverdue = task.dueDate && dayjs(task.dueDate).isBefore(dayjs(), 'day') && task.status !== 'APPROVED';
    const statusLabel = STATUS_CONFIG[task.status].label;
    const checklistMeta = getChecklistMeta(task);

    return (
      <div
        key={task.id}
        role="button"
        tabIndex={0}
        onClick={() => setDetailTask(task)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setDetailTask(task);
        }}
        style={{
          padding: lane ? '8px 9px' : compact ? '10px 12px' : '12px 14px',
          borderRadius: 18,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: task.color ? `${task.color}18` : token.colorBgContainer,
          boxShadow: token.boxShadowSecondary,
          borderLeft: `5px solid ${accent}`,
          cursor: 'pointer',
          minWidth: 0,
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: lane ? 4 : 6, minWidth: 0 }}>
          <Typography.Paragraph
            ellipsis={{ rows: lane ? 2 : compact ? 2 : 3 }}
            style={{
              margin: 0,
              minWidth: 0,
              fontSize: lane ? 11 : compact ? 12 : 13,
              lineHeight: lane ? 1.25 : 1.35,
              fontWeight: 600,
              color: token.colorText,
            }}
          >
            {task.title}
          </Typography.Paragraph>
          {lane ? (
            <span
              title={statusLabel}
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: accent,
                flexShrink: 0,
                marginTop: 3,
              }}
            />
          ) : (
            <Tag color={STATUS_CONFIG[task.status].color} style={{ margin: 0, flexShrink: 0 }}>
              {statusLabel}
            </Tag>
          )}
        </div>

        {lane ? (
          <Typography.Text
            type="secondary"
            style={{
              fontSize: 10,
              display: 'block',
              marginBottom: 4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {formatTaskAnchor(task)}
          </Typography.Text>
        ) : (
          <Space size={6} wrap style={{ marginBottom: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {task.assignee?.fullName || 'Без исполнителя'}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {formatTaskAnchor(task)}
            </Typography.Text>
          </Space>
        )}

        {task.description && !lane ? (
          <Typography.Paragraph
            ellipsis={{ rows: compact ? 1 : 2 }}
            style={{ margin: 0, color: token.colorTextSecondary, fontSize: 11 }}
          >
            {task.description}
          </Typography.Paragraph>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: lane ? 6 : 8, gap: 6 }}>
          <Space size={6}>
            {!lane && (task._count?.attachments ?? 0) > 0 ? (
              <Tag bordered={false} style={{ margin: 0, borderRadius: 999, background: token.colorFillTertiary }}>
                <PaperClipOutlined /> {task._count?.attachments}
              </Tag>
            ) : null}
            {!lane && checklistMeta.total > 0 ? (
              <Tag bordered={false} style={{ margin: 0, borderRadius: 999, background: token.colorFillTertiary }}>
                Чеклист: {checklistMeta.done}/{checklistMeta.total}
              </Tag>
            ) : null}
            {isOverdue ? (
              lane ? (
                <Typography.Text style={{ color: token.colorError, fontSize: 10 }}>
                  Просрочено
                </Typography.Text>
              ) : (
                <Tag color="error" style={{ margin: 0 }}>
                  Просрочено
                </Tag>
              )
            ) : null}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: lane ? 10 : 11, flexShrink: 0 }}>
            {lane ? statusLabel : dayjs(task.createdAt).format('DD.MM')}
          </Typography.Text>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
          padding: isMobile ? '8px 0' : '8px 4px',
        }}
      >
        <div>
          <Typography.Text
            type="secondary"
            style={{
              display: 'inline-block',
              marginBottom: 6,
              padding: '6px 10px',
              borderRadius: 999,
              background: token.colorFillQuaternary,
              fontSize: 11,
              letterSpacing: 0.3,
            }}
          >
            TASKS CALENDAR
          </Typography.Text>
          <Typography.Title level={4} style={{ margin: 0 }}>Задачи</Typography.Title>
          <Typography.Text type="secondary">
            Неделя, фокус дня, срочные задачи и быстрый переход к работе.
          </Typography.Text>
        </div>
        <Space wrap>
          <Segmented
            value={dateViewMode}
            onChange={(v) => setDateViewMode(v as DateViewMode)}
            options={[
              { label: 'Сегодня', value: 'TODAY' },
              { label: 'Неделя', value: 'WEEK' },
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

      <Card
        size="small"
        style={{
          marginBottom: 16,
          borderRadius: 32,
          background: sectionSurface,
          borderColor: token.colorBorderSecondary,
          boxShadow: token.boxShadowSecondary,
        }}
        styles={{ body: { padding: isMobile ? 14 : 18 } }}
      >
        <Row gutter={[18, 18]}>
          <Col xs={24} xl={7}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div
                style={{
                  borderRadius: 24,
                  padding: 16,
                  background: panelSurface,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  boxShadow: token.boxShadowSecondary,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      <CalendarOutlined /> Календарь месяца
                    </Typography.Text>
                    <Typography.Text strong style={{ fontSize: 16 }}>
                      {selectedDate.format('MMMM YYYY')}
                    </Typography.Text>
                  </div>
                  <Tag bordered={false} style={{ borderRadius: 999, padding: '4px 10px', background: token.colorFillQuaternary }}>
                    {weekStart.format('D MMM')} - {weekEnd.format('D MMM')}
                  </Tag>
                </div>
                <Calendar
                  fullscreen={false}
                  value={selectedDate}
                  style={{ borderRadius: 16 }}
                  onSelect={(d) => {
                    setSelectedDate(d);
                    setDateViewMode('WEEK');
                  }}
                  dateCellRender={(d) => {
                    const dayTasks = tasksOnCalendarDay(d);
                    if (dayTasks.length === 0) return null;
                    return (
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
                        {dayTasks.slice(0, 3).map((task) => (
                          <span
                            key={task.id}
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: getTaskAccent(task),
                              boxShadow: `0 0 0 1px ${token.colorBgContainer}`,
                            }}
                          />
                        ))}
                      </div>
                    );
                  }}
                />
              </div>

              <div
                style={{
                  borderRadius: 24,
                  padding: 16,
                  background: panelSurface,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  boxShadow: token.boxShadowSecondary,
                }}
              >
                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>
                  Быстрый обзор
                </Typography.Text>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                  {[
                    { label: 'На сегодня', value: todayTasks.length, color: token.colorPrimary, icon: <ClockCircleOutlined /> },
                    { label: 'На неделю', value: weekTasks.length, color: token.colorSuccess, icon: <CalendarOutlined /> },
                    { label: 'Просрочено', value: overdueTasks.length, color: token.colorError, icon: <WarningOutlined /> },
                    { label: 'Без даты', value: tasksWithoutDate.length, color: token.colorWarning, icon: <AppstoreOutlined /> },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        borderRadius: 18,
                        padding: '12px 14px',
                        background: `${item.color}12`,
                        border: `1px solid ${item.color}22`,
                      }}
                    >
                      <div style={{ color: item.color, marginBottom: 8 }}>{item.icon}</div>
                      <Typography.Text strong style={{ display: 'block', fontSize: 18 }}>
                        {item.value}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {item.label}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  borderRadius: 24,
                  padding: 16,
                  background: panelSurface,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  boxShadow: token.boxShadowSecondary,
                }}
              >
                <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
                  Фокус дня
                </Typography.Text>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
                  {selectedDate.format('dddd, D MMMM')}
                </Typography.Text>
                <div
                  style={{
                    borderRadius: 18,
                    padding: '12px 14px',
                    marginBottom: 12,
                    background: accentSurface,
                    border: `1px solid ${token.colorPrimaryBorder}`,
                  }}
                >
                  <Typography.Text strong style={{ display: 'block' }}>
                    {selectedDayTasks.length} задач на день
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Нажмите на день в сетке, чтобы быстро менять фокус.
                  </Typography.Text>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {selectedDayTasks.length === 0 ? (
                    <Typography.Text type="secondary">На выбранный день задач нет.</Typography.Text>
                  ) : (
                    selectedDayTasks.slice(0, 4).map((task) => renderScheduleCard(task, true))
                  )}
                </div>
              </div>
            </div>
          </Col>

          <Col xs={24} xl={17}>
            <div
              style={{
                borderRadius: 28,
                padding: isMobile ? 14 : 18,
                background: panelSurface,
                border: `1px solid ${token.colorBorderSecondary}`,
                boxShadow: token.boxShadowSecondary,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  marginBottom: 16,
                  padding: isMobile ? 0 : '4px 2px',
                }}
              >
                <div>
                  <Typography.Text
                    type="secondary"
                    style={{
                      display: 'inline-block',
                      marginBottom: 6,
                      padding: '5px 10px',
                      borderRadius: 999,
                      background: token.colorFillQuaternary,
                      fontSize: 11,
                    }}
                  >
                    {agendaLabel.toUpperCase()}
                  </Typography.Text>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    Недельный календарь задач
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    {weekStart.format('D MMMM')} - {weekEnd.format('D MMMM YYYY')}
                  </Typography.Text>
                </div>
                <Space wrap>
                  <Button icon={<LeftOutlined />} onClick={() => setSelectedDate((prev) => prev.subtract(1, 'week'))}>
                    Назад
                  </Button>
                  <Button onClick={() => setSelectedDate(dayjs())}>Эта неделя</Button>
                  <Button icon={<RightOutlined />} iconPosition="end" onClick={() => setSelectedDate((prev) => prev.add(1, 'week'))}>
                    Вперёд
                  </Button>
                </Space>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.1fr) minmax(0, 1.9fr)',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    borderRadius: 22,
                    padding: 16,
                    background: accentSurface,
                    border: `1px solid ${token.colorPrimaryBorder}`,
                  }}
                >
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                    Активный обзор
                  </Typography.Text>
                  <Typography.Title level={3} style={{ margin: 0, lineHeight: 1.1 }}>
                    {agendaTasks.length}
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    {dateViewMode === 'TODAY'
                      ? 'задач на сегодня'
                      : dateViewMode === 'ALL'
                        ? 'задач во всем списке'
                        : 'задач в текущей неделе'}
                  </Typography.Text>
                </div>

                <div
                  style={{
                    borderRadius: 22,
                    padding: 16,
                    background: panelSurface,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                    <Typography.Text strong>Ближайшее</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {upcomingTasks.length > 0 ? 'Следующие задачи' : 'Пока пусто'}
                    </Typography.Text>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: upcomingTasks.length > 0
                        ? `repeat(${Math.max(1, Math.min(upcomingTasks.length, isMobile ? 1 : 3))}, minmax(0, 1fr))`
                        : '1fr',
                      gap: 10,
                    }}
                  >
                    {upcomingTasks.length === 0 ? (
                      <Typography.Text type="secondary">Нет задач в текущем режиме отображения.</Typography.Text>
                    ) : (
                      upcomingTasks.map((task) => renderScheduleCard(task, true))
                    )}
                  </div>
                </div>
              </div>

              {isMobile ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {weekDays.map((day) => {
                    const dayTasks = tasksOnCalendarDay(day);
                    const isCurrentDay = day.isSame(dayjs(), 'day');
                    const isSelectedDay = day.isSame(selectedDate, 'day');

                    return (
                      <div
                        key={day.toISOString()}
                        style={{
                          borderRadius: 22,
                          padding: 14,
                          background: isSelectedDay
                            ? selectedDaySurface
                            : daySurface,
                          border: `1px solid ${isCurrentDay ? token.colorPrimary : token.colorBorderSecondary}`,
                          boxShadow: isSelectedDay ? token.boxShadowSecondary : undefined,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                          <div>
                            <Typography.Text strong>{day.format('dddd')}</Typography.Text>
                            <div>
                              <Typography.Text type="secondary">{day.format('D MMMM')}</Typography.Text>
                            </div>
                          </div>
                          <Badge count={dayTasks.length} showZero style={{ backgroundColor: isCurrentDay ? token.colorPrimary : token.colorTextQuaternary }} />
                        </div>
                        <div style={{ display: 'grid', gap: 10 }}>
                          {dayTasks.length === 0 ? (
                            <Typography.Text type="secondary">Нет задач</Typography.Text>
                          ) : (
                            dayTasks.map((task) => renderScheduleCard(task, true, true))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                    gap: 12,
                  }}
                >
                  {weekDays.map((day) => {
                    const dayTasks = tasksOnCalendarDay(day);
                    const isCurrentDay = day.isSame(dayjs(), 'day');
                    const isSelectedDay = day.isSame(selectedDate, 'day');

                    return (
                      <div
                        key={day.toISOString()}
                        style={{
                          minHeight: 420,
                          borderRadius: 26,
                          padding: 12,
                          background: isSelectedDay
                            ? selectedDaySurface
                            : daySurface,
                          border: `1px solid ${isCurrentDay ? token.colorPrimary : token.colorBorderSecondary}`,
                          boxShadow: isSelectedDay ? token.boxShadowSecondary : undefined,
                          minWidth: 0,
                          overflow: 'hidden',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedDate(day)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            marginBottom: 12,
                            padding: 0,
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <Tag
                            bordered={false}
                            style={{
                              margin: 0,
                              borderRadius: 999,
                              padding: '4px 10px',
                              background: isCurrentDay ? token.colorPrimary : token.colorFillQuaternary,
                              color: isCurrentDay ? token.colorWhite : token.colorTextSecondary,
                            }}
                          >
                            {day.format('ddd')}
                          </Tag>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                            <Typography.Text strong style={{ fontSize: 24, lineHeight: 1 }}>
                              {day.format('DD')}
                            </Typography.Text>
                            <Badge count={dayTasks.length} showZero style={{ backgroundColor: isCurrentDay ? token.colorPrimary : token.colorTextQuaternary }} />
                          </div>
                        </button>

                        <div style={{ display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 2, minWidth: 0 }}>
                          {dayTasks.length === 0 ? (
                            <div
                              style={{
                                borderRadius: 18,
                                minHeight: 88,
                                border: `1px dashed ${token.colorBorderSecondary}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 8,
                              }}
                            >
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                Свободно
                              </Typography.Text>
                            </div>
                          ) : (
                            dayTasks.map((task) => renderScheduleCard(task, true, true))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
                background: token.colorBgContainer,
                borderRadius: 24,
                padding: 14,
                minHeight: 420,
                border: `1px solid ${token.colorBorderSecondary}`,
                boxShadow: token.boxShadowSecondary,
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
        title={(
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Новая задача</Typography.Text>
            <Typography.Title level={5} style={{ margin: 0 }}>Создать и запланировать задачу</Typography.Title>
          </div>
        )}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="Создать задачу"
        cancelText="Отмена"
        width={isMobile ? undefined : 720}
        styles={{ body: { paddingTop: 8 } }}
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
            checklist: normalizeChecklist(v.checklist),
          });
        }}>
          <div
            style={{
              borderRadius: 18,
              padding: '12px 14px',
              marginBottom: 16,
              background: accentSurface,
              border: `1px solid ${token.colorPrimaryBorder}`,
            }}
          >
            <Typography.Text strong style={{ display: 'block' }}>
              Коротко и понятно
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Укажите задачу, дату плана и цвет, чтобы она была заметнее в недельном календаре.
            </Typography.Text>
          </div>
          <Form.Item name="title" label="Заголовок" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input size="large" placeholder="Например: Позвонить клиенту и согласовать заказ" />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={4} placeholder="Что именно нужно сделать, какие детали важно не забыть?" />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                name="assigneeId"
                label="Исполнитель"
                rules={[{ required: true, message: 'Обязательно' }]}
                extra={!isAdmin ? 'Исполнитель назначается автоматически: вы' : undefined}
              >
                <Select
                  size="large"
                  showSearch
                  disabled={!isAdmin}
                  optionFilterProp="label"
                  placeholder="Выберите исполнителя"
                  options={users.filter((u) => u.isActive).map((u) => ({ label: u.fullName, value: u.id }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="color"
                label="Цвет задачи"
                getValueFromEvent={(v: string | { toHexString?: () => string }) =>
                  typeof v === 'string' ? v : v?.toHexString?.() ?? '#22609A'
                }
              >
                <ColorPicker showText format="hex" disabledAlpha size="large" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="dueDate" label="Срок">
                <DatePicker size="large" style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Когда дедлайн" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="plannedDate" label="План на дату">
                <DatePicker size="large" style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Когда делать" />
              </Form.Item>
            </Col>
          </Row>
          <div
            style={{
              borderRadius: 18,
              padding: 14,
              marginTop: 8,
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <div>
                <Typography.Text strong style={{ display: 'block' }}>Чеклист задачи</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Добавьте несколько пунктов, которые нужно отметить по ходу выполнения.
                </Typography.Text>
              </div>
            </div>
            <Form.List name="checklist">
              {(fields, { add, remove }) => (
                <div style={{ display: 'grid', gap: 10 }}>
                  {fields.map((field, index) => (
                    <div
                      key={field.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : '28px minmax(0, 1fr) auto',
                        gap: 10,
                        alignItems: 'center',
                      }}
                    >
                      <Form.Item name={[field.name, 'checked']} valuePropName="checked" style={{ margin: 0 }}>
                        <Checkbox />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'text']}
                        rules={[{ required: true, message: 'Введите текст пункта' }]}
                        style={{ margin: 0 }}
                      >
                        <Input
                          size="large"
                          placeholder={`Пункт ${index + 1}`}
                        />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>
                        Удалить
                      </Button>
                    </div>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ text: '', checked: false })}>
                    Добавить чекбокс
                  </Button>
                </div>
              )}
            </Form.List>
          </div>
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
        title={(
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Карточка задачи</Typography.Text>
            <Typography.Title level={5} style={{ margin: 0 }}>{detailTask?.title}</Typography.Title>
          </div>
        )}
        open={!!detailTask}
        onClose={() => setDetailTask(null)}
        width={isMobile ? '100%' : 560}
        styles={{ body: { paddingTop: 12 } }}
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
              <div
                style={{
                  borderRadius: 20,
                  padding: 16,
                  background: accentSurface,
                  border: `1px solid ${token.colorPrimaryBorder}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      Текущий статус
                    </Typography.Text>
                    <Tag color={STATUS_CONFIG[detailTask.status].color} style={{ marginTop: 8 }}>
                      {STATUS_CONFIG[detailTask.status].label}
                    </Tag>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {detailTask.color ? (
                      <>
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 999,
                            background: detailTask.color,
                            border: `1px solid ${token.colorBorder}`,
                          }}
                        />
                        <Typography.Text type="secondary">{detailTask.color}</Typography.Text>
                      </>
                    ) : (
                      <Typography.Text type="secondary">Без цвета</Typography.Text>
                    )}
                  </div>
                </div>
              </div>

              {detailTask.description && (
                <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                  <Typography.Text type="secondary">Описание</Typography.Text>
                  <div style={{ marginTop: 6 }}><Typography.Text>{detailTask.description}</Typography.Text></div>
                </div>
              )}

              <Row gutter={[12, 12]}>
                <Col xs={24} sm={12}>
                  <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <Typography.Text type="secondary">Исполнитель</Typography.Text>
                    <div style={{ marginTop: 6 }}><Typography.Text strong>{detailTask.assignee?.fullName}</Typography.Text></div>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <Typography.Text type="secondary">Постановщик</Typography.Text>
                    <div style={{ marginTop: 6 }}><Typography.Text strong>{detailTask.createdBy?.fullName}</Typography.Text></div>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <Typography.Text type="secondary">Срок</Typography.Text>
                    <div style={{ marginTop: 6 }}>
                      <Typography.Text>{detailTask.dueDate ? dayjs(detailTask.dueDate).format('DD.MM.YYYY') : 'Не задан'}</Typography.Text>
                    </div>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <Typography.Text type="secondary">Плановая дата</Typography.Text>
                    <div style={{ marginTop: 6 }}>
                      <Typography.Text>{detailTask.plannedDate ? dayjs(detailTask.plannedDate).format('DD.MM.YYYY') : 'Не задана'}</Typography.Text>
                    </div>
                  </div>
                </Col>
                <Col xs={24}>
                  <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <Typography.Text type="secondary">Создано</Typography.Text>
                    <div style={{ marginTop: 6 }}><Typography.Text>{dayjs(detailTask.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text></div>
                  </div>
                </Col>
              </Row>

              <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <Typography.Text type="secondary">Чеклист</Typography.Text>
                  {detailTask.checklist?.length ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Выполнено {getChecklistMeta(detailTask).done}/{getChecklistMeta(detailTask).total}
                    </Typography.Text>
                  ) : null}
                </div>
                {!detailTask.checklist?.length ? (
                  <Typography.Text type="secondary">Чеклист не добавлен.</Typography.Text>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {detailTask.checklist.map((item, index) => (
                      <Checkbox
                        key={`${detailTask.id}-${index}-${item.text}`}
                        checked={item.checked}
                        disabled={updateTaskMut.isPending}
                        onChange={(e) => {
                          const nextChecklist = (detailTask.checklist || []).map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, checked: e.target.checked } : entry,
                          );
                          updateTaskMut.mutate({
                            id: detailTask.id,
                            data: { checklist: nextChecklist },
                          });
                        }}
                      >
                        <Typography.Text delete={item.checked}>{item.text}</Typography.Text>
                      </Checkbox>
                    ))}
                  </div>
                )}
              </div>

              {/* Report section */}
              <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                <Typography.Text type="secondary">Отчёт</Typography.Text>
                {detailTask.report ? (
                  <div style={{
                    background: token.colorBgElevated,
                    padding: 12,
                    borderRadius: 12,
                    marginTop: 8,
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
                <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
                  <Typography.Text type="secondary">Утверждено</Typography.Text>
                  <div style={{ marginTop: 6 }}>
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
              <div style={{ borderRadius: 18, padding: 14, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}>
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
