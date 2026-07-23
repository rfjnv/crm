import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Typography,
  Button,
  Card,
  Popconfirm,
  message,
  Space,
  Tag,
  DatePicker,
  Select,
  Avatar,
  Statistic,
  Row,
  Col,
  Tooltip,
} from 'antd';
import {
  DeleteOutlined,
  SyncOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  UserOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { attendanceApi } from '../api/attendance.api';
import { usersApi } from '../api/users.api';
import { getFirstName } from '../lib/name-utils';
import { timepayApi } from '../api/timepay.api';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import type { AttendanceRecord } from '../types';

/** Рабочий день компании: начало 09:00, допуск на опоздание 15 минут, конец 18:00. */
const WORK_START_MIN = 9 * 60;
const GRACE_MIN = 15;
const LATE_THRESHOLD_MIN = WORK_START_MIN + GRACE_MIN;
const WORK_END_MIN = 18 * 60;

function minutesOfDay(iso: string): number {
  const d = dayjs(iso);
  return d.hour() * 60 + d.minute();
}

type StatusKind = 'ON_TIME' | 'LATE' | 'ABSENT' | 'PENDING';

function checkInStatus(record: AttendanceRecord): { kind: StatusKind; lateBy?: number } {
  if (!record.checkIn) return { kind: 'ABSENT' };
  const m = minutesOfDay(record.checkIn);
  if (m <= LATE_THRESHOLD_MIN) return { kind: 'ON_TIME' };
  return { kind: 'LATE', lateBy: m - WORK_START_MIN };
}

function checkOutEarlyBy(record: AttendanceRecord): number | null {
  if (!record.checkOut) return null;
  const m = minutesOfDay(record.checkOut);
  if (m >= WORK_END_MIN) return null;
  return WORK_END_MIN - m;
}

const formatTime = (v?: string | null) => (v ? dayjs(v).format('HH:mm') : '—');

function initials(fullName?: string): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

export default function AttendancePage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs()]);
  const [userFilter, setUserFilter] = useState<string | undefined>(undefined);

  const isSingleDay = dateRange[0].isSame(dateRange[1], 'day');

  const queryParams: { userId?: string; from?: string; to?: string } = {
    from: dateRange[0].format('YYYY-MM-DD'),
    to: dateRange[1].format('YYYY-MM-DD'),
  };
  if (userFilter) queryParams.userId = userFilter;

  const { data: records, isLoading } = useQuery({
    queryKey: ['attendance', queryParams],
    queryFn: () => attendanceApi.list(queryParams),
  });

  const { data: users } = useQuery({
    queryKey: ['users-for-attendance'],
    queryFn: () => usersApi.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: attendanceApi.remove,
    onSuccess: () => {
      message.success('Запись удалена');
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: () => message.error('Ошибка при удалении'),
  });

  const syncMutation = useMutation({
    mutationFn: () => timepayApi.sync(dateRange[1].format('YYYY-MM-DD')),
    onSuccess: (result) => {
      if (result.status === 'SUCCESS') {
        message.success(`Обновлено из TimePay: ${result.matched}, не найдено по ФИО: ${result.unmatched}`);
      } else if (result.status === 'AUTH_ERROR') {
        message.error('Токен TimePay недействителен — обновите его в Настройках компании');
      } else if (result.status === 'NOT_CONFIGURED') {
        message.warning('TimePay не подключен — настройте токен в Настройках компании');
      } else {
        message.error(result.error || 'Ошибка синхронизации');
      }
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: () => message.error('Ошибка синхронизации'),
  });

  const userOptions = useMemo(
    () => (users ?? []).map((u) => ({ value: u.id, label: getFirstName(u.fullName) })),
    [users],
  );

  const data = records ?? [];

  const summary = useMemo(() => {
    if (!isSingleDay || !users) return null;
    const activeUsers = users.filter((u) => u.isActive);
    const presentIds = new Set(data.filter((r) => r.checkIn).map((r) => r.userId));
    const late = data.filter((r) => checkInStatus(r).kind === 'LATE').length;
    const onTime = data.filter((r) => checkInStatus(r).kind === 'ON_TIME').length;
    const absent = Math.max(activeUsers.length - presentIds.size, 0);
    return { total: activeUsers.length, present: presentIds.size, onTime, late, absent };
  }, [isSingleDay, users, data]);

  const StatusTag = ({ record }: { record: AttendanceRecord }) => {
    const status = checkInStatus(record);
    const earlyBy = checkOutEarlyBy(record);
    if (status.kind === 'ABSENT') {
      return <Tag icon={<CloseCircleFilled />} color="default">Нет данных</Tag>;
    }
    return (
      <Space size={4} wrap>
        {status.kind === 'ON_TIME' ? (
          <Tag icon={<CheckCircleFilled />} color="success">Вовремя</Tag>
        ) : (
          <Tag icon={<ClockCircleFilled />} color="error">Опоздание {status.lateBy} мин</Tag>
        )}
        {earlyBy !== null && (
          <Tag icon={<ClockCircleFilled />} color="warning">Ушёл раньше на {earlyBy} мин</Tag>
        )}
      </Space>
    );
  };

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'date',
      width: 110,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Сотрудник',
      dataIndex: ['user', 'fullName'],
      render: (_: unknown, r: AttendanceRecord) => (
        <Space size={10}>
          <Avatar size={28} icon={<UserOutlined />}>{initials(r.user?.fullName)}</Avatar>
          <div>
            <div>{getFirstName(r.user?.fullName) || '—'}</div>
            {r.user?.department && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.user.department}</Typography.Text>
            )}
          </div>
        </Space>
      ),
    },
    {
      title: 'Приход',
      dataIndex: 'checkIn',
      width: 90,
      align: 'center' as const,
      render: (v: string | null) => formatTime(v),
    },
    {
      title: 'Уход',
      dataIndex: 'checkOut',
      width: 90,
      align: 'center' as const,
      render: (v: string | null) => formatTime(v),
    },
    {
      title: 'Статус',
      key: 'status',
      width: 220,
      render: (_: unknown, r: AttendanceRecord) => <StatusTag record={r} />,
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_: unknown, record: AttendanceRecord) => (
        <Popconfirm title="Удалить запись?" onConfirm={() => deleteMutation.mutate(record.id)} okText="Да" cancelText="Нет">
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Посещаемость</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Данные подтягиваются автоматически из TimePay · рабочий день 09:00–18:00, допуск на опоздание 15 мин
          </Typography.Text>
        </div>
        <Button icon={<SyncOutlined />} loading={syncMutation.isPending} onClick={() => syncMutation.mutate()}>
          {isMobile ? '' : 'Обновить из TimePay'}
        </Button>
      </div>

      {summary && (
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={6}>
            <Card size="small" bordered={false} style={{ background: 'var(--ant-color-fill-tertiary, rgba(0,0,0,0.02))' }}>
              <Statistic title="Пришли" value={summary.present} suffix={`/ ${summary.total}`} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" bordered={false}>
              <Statistic title="Вовремя" value={summary.onTime} valueStyle={{ color: '#3f8600' }} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" bordered={false}>
              <Statistic title="Опоздали" value={summary.late} valueStyle={{ color: '#cf1322' }} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Tooltip title="Активные сотрудники без отметки прихода за день">
              <Card size="small" bordered={false}>
                <Statistic title="Не пришли" value={summary.absent} valueStyle={{ color: summary.absent ? '#cf1322' : undefined }} />
              </Card>
            </Tooltip>
          </Col>
        </Row>
      )}

      <Card bordered={false}>
        <Space style={{ marginBottom: 16 }} wrap>
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(values) => {
              if (values?.[0] && values[1]) setDateRange([values[0], values[1]]);
            }}
            format="DD.MM.YYYY"
            allowClear={false}
            style={{ width: isMobile ? '100%' : undefined }}
          />
          <Button onClick={() => setDateRange([dayjs(), dayjs()])}>Сегодня</Button>
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
                  <Space size={10}>
                    <Avatar size={32} icon={<UserOutlined />}>{initials(item.user?.fullName)}</Avatar>
                    <div>
                      <Typography.Text strong>{getFirstName(item.user?.fullName) || '—'}</Typography.Text>
                      <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(item.date).format('DD.MM.YYYY')}</Typography.Text></div>
                    </div>
                  </Space>
                  <Popconfirm title="Удалить запись?" onConfirm={() => deleteMutation.mutate(item.id)} okText="Да" cancelText="Нет">
                    <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                  </Popconfirm>
                </div>
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography.Text>Приход {formatTime(item.checkIn)} · Уход {formatTime(item.checkOut)}</Typography.Text>
                </div>
                <div style={{ marginTop: 6 }}>
                  <StatusTag record={item} />
                </div>
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
    </div>
  );
}
