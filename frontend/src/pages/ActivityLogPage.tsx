import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card, DatePicker, Select, Space, Table, Typography, Tag, Tooltip, Tabs, Button, Statistic, Row, Col, Empty,
} from 'antd';
import { HistoryOutlined, FieldTimeOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { adminApi } from '../api/admin.api';
import { usersApi } from '../api/users.api';
import BackButton from '../components/BackButton';
import { getAuditActionLabel, auditActionLabels } from '../lib/auditActionLabels';
import { renderJsonDiff } from '../lib/auditDiff';
import { formatUserAgent } from '../lib/formatUserAgent';
import type { AuditLog } from '../types';
import { theme } from 'antd';

const ENTITY_TYPES = [
  'deal', 'client', 'client_note', 'notes_board_row', 'client_stock_event', 'contract', 'contract_attachment',
  'user', 'user_goal', 'import_order', 'import_order_attachment', 'product',
  'stock_correction', 'inventory_movement', 'supplier', 'notification_batch',
  'power_of_attorney', 'session',
];

export default function ActivityLogPage() {
  return (
    <div>
      <BackButton />
      <Card size="small" title={<span style={{ fontWeight: 500 }}>Журнал действий</span>}>
        <Tabs
          defaultActiveKey="actions"
          items={[
            {
              key: 'actions',
              label: <Space><HistoryOutlined />Действия</Space>,
              children: <ActionsTab />,
            },
            {
              key: 'sessions',
              label: <Space><FieldTimeOutlined />Сессии</Space>,
              children: <SessionsTab />,
            },
          ]}
        />
      </Card>
    </div>
  );
}

function ActionsTab() {
  const { token: tk } = theme.useToken();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [action, setAction] = useState<string | undefined>(undefined);
  const [entityType, setEntityType] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list({ includeInactive: true }),
  });

  const params = useMemo(
    () => ({
      userId,
      action,
      entityType,
      from: range?.[0]?.startOf('day').toISOString(),
      to: range?.[1]?.endOf('day').toISOString(),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [userId, action, entityType, range, page, pageSize],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['activity-log', params],
    queryFn: () => adminApi.getAllAuditLogs(params),
  });

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }} size={8}>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => {
            setRange(v && v[0] && v[1] ? [v[0], v[1]] : null);
            setPage(1);
          }}
          format="DD.MM.YYYY"
          allowClear
        />
        <Select
          showSearch
          allowClear
          placeholder="Пользователь"
          style={{ width: 220 }}
          value={userId}
          onChange={(v) => { setUserId(v || undefined); setPage(1); }}
          optionFilterProp="label"
          options={(users ?? []).map((u) => ({ value: u.id, label: u.fullName }))}
        />
        <Select
          allowClear
          placeholder="Действие"
          style={{ width: 200 }}
          value={action}
          onChange={(v) => { setAction(v || undefined); setPage(1); }}
          options={Object.entries(auditActionLabels).map(([value, cfg]) => ({ value, label: cfg.label }))}
        />
        <Select
          allowClear
          placeholder="Тип объекта"
          style={{ width: 180 }}
          value={entityType}
          onChange={(v) => { setEntityType(v || undefined); setPage(1); }}
          options={ENTITY_TYPES.map((v) => ({ value: v, label: v }))}
        />
        <Typography.Text type="secondary">
          Всего записей: {data?.total ?? '—'}
        </Typography.Text>
      </Space>

      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        expandable={{
          rowExpandable: (row) => Boolean(row.before || row.after),
          expandedRowRender: (row) => (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {renderJsonDiff('До', row.before, tk.colorFillTertiary)}
              {renderJsonDiff('После', row.after, tk.colorFillTertiary)}
            </div>
          ),
        }}
        columns={[
          {
            title: 'Время',
            dataIndex: 'createdAt',
            width: 150,
            render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm:ss'),
          },
          {
            title: 'Пользователь',
            render: (_: unknown, row: AuditLog) => (
              <Space size={4}>
                <Typography.Text strong>{row.user?.fullName || '—'}</Typography.Text>
                {row.user?.role && <Tag>{row.user.role}</Tag>}
              </Space>
            ),
          },
          {
            title: 'Действие',
            dataIndex: 'action',
            width: 160,
            render: (v: string) => {
              const cfg = getAuditActionLabel(v);
              return <Tag color={cfg.color}>{cfg.label}</Tag>;
            },
          },
          {
            title: 'Объект',
            render: (_: unknown, row: AuditLog) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.entityType}{row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ''}
              </Typography.Text>
            ),
          },
          {
            title: 'IP',
            dataIndex: 'ip',
            width: 130,
            render: (v: string | null) => v || '—',
          },
          {
            title: 'Устройство',
            render: (_: unknown, row: AuditLog) => (
              <Tooltip title={row.deviceId ? `device: ${row.deviceId}` : undefined}>
                <Typography.Text style={{ fontSize: 12 }}>{formatUserAgent(row.userAgent)}</Typography.Text>
              </Tooltip>
            ),
          },
          {
            title: 'Причина',
            dataIndex: 'reason',
            render: (v: string | null) => v || '—',
          },
        ]}
      />
    </div>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return `${h} ч ${m} мин`;
}

function SessionsTab() {
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [queryArgs, setQueryArgs] = useState<{ userId: string; date: string } | null>(null);

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list({ includeInactive: true }),
  });

  const { data, isLoading, isFetched } = useQuery({
    queryKey: ['activity-sessions', queryArgs],
    queryFn: () => adminApi.getActivitySessions(queryArgs!),
    enabled: Boolean(queryArgs),
  });

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }} size={8}>
        <Select
          showSearch
          placeholder="Пользователь"
          style={{ width: 220 }}
          value={userId}
          onChange={setUserId}
          optionFilterProp="label"
          options={(users ?? []).map((u) => ({ value: u.id, label: u.fullName }))}
        />
        <DatePicker
          value={date}
          onChange={(v) => v && setDate(v)}
          format="DD.MM.YYYY"
          allowClear={false}
        />
        <Button
          type="primary"
          disabled={!userId}
          loading={isLoading}
          onClick={() => userId && setQueryArgs({ userId, date: date.format('YYYY-MM-DD') })}
        >
          Показать
        </Button>
      </Space>

      {!isFetched && !isLoading && (
        <Empty description="Выберите пользователя и дату" />
      )}

      {data && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col>
              <Statistic title="Активное время за день" value={formatDuration(data.totalActiveMinutes)} />
            </Col>
            <Col>
              <Statistic
                title="Первое событие"
                value={data.firstEventAt ? dayjs(data.firstEventAt).format('HH:mm:ss') : '—'}
              />
            </Col>
            <Col>
              <Statistic
                title="Последнее событие"
                value={data.lastEventAt ? dayjs(data.lastEventAt).format('HH:mm:ss') : '—'}
              />
            </Col>
            <Col>
              <Statistic title="Просмотров страниц" value={data.pageViews.length} />
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Typography.Title level={5}>Сессии активности</Typography.Title>
              <Table
                size="small"
                rowKey={(r) => r.start}
                dataSource={data.sessions}
                pagination={false}
                locale={{ emptyText: 'Активности не зафиксировано' }}
                columns={[
                  { title: '№', render: (_: unknown, __: unknown, i: number) => i + 1, width: 40 },
                  { title: 'Начало', dataIndex: 'start', render: (v: string) => dayjs(v).format('HH:mm:ss') },
                  { title: 'Конец', dataIndex: 'end', render: (v: string) => dayjs(v).format('HH:mm:ss') },
                  { title: 'Длительность', dataIndex: 'durationMinutes', render: (v: number) => formatDuration(v) },
                ]}
              />
            </Col>
            <Col span={12}>
              <Typography.Title level={5}>Просмотры страниц</Typography.Title>
              <Table
                size="small"
                rowKey={(r) => `${r.path}_${r.at}`}
                dataSource={data.pageViews}
                pagination={{ pageSize: 20 }}
                locale={{ emptyText: 'Страниц не открывал' }}
                columns={[
                  { title: 'Время', dataIndex: 'at', width: 100, render: (v: string) => dayjs(v).format('HH:mm:ss') },
                  { title: 'Страница', dataIndex: 'path' },
                ]}
              />
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
