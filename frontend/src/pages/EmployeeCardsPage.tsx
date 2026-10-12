import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, DatePicker, Rate, Segmented, Space, Switch, Table, Tag, Tooltip, Typography, Progress } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { employeeCardsApi } from '../api/employeeCards.api';
import { getFirstName } from '../lib/name-utils';
import { useIsMobile } from '../hooks/useIsMobile';
import EmployeeCardDrawer from '../components/EmployeeCardDrawer';
import { EMPLOYEE_ROLE_LABELS } from '../constants/employeeCards';
import type { EmployeeCardRow } from '../types';

type GroupFilter = 'all' | EmployeeCardRow['group'];

/** Работа по роли: продажи — план и контакты, склад — отгрузки, офис — действия в CRM. */
function WorkCell({ row }: { row: EmployeeCardRow }) {
  if (row.sales) {
    const pct = row.sales.planPercent;
    return (
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        {pct !== null ? (
          <Tooltip title="Выполнение плана по выручке">
            <Progress
              percent={Math.round(pct * 100)}
              size="small"
              status={pct >= 1 ? 'success' : pct >= 0.7 ? 'normal' : 'exception'}
              format={(v) => `${v}%`}
            />
          </Tooltip>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>План не задан</Typography.Text>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Контакты: {row.sales.contacts}
          {row.sales.callScore !== null ? ` · звонки ${row.sales.callScore}/10` : ''}
        </Typography.Text>
      </Space>
    );
  }
  if (row.operations) {
    const o = row.operations;
    const parts = [
      o.shipments ? `отгрузок ${o.shipments}` : null,
      o.loadings ? `погрузок ${o.loadings}` : null,
      o.deliveries ? `доставок ${o.deliveries}` : null,
      o.itemsConfirmed ? `подтвердил позиций ${o.itemsConfirmed}` : null,
    ].filter(Boolean);
    return <Typography.Text style={{ fontSize: 13 }}>{parts.length ? parts.join(' · ') : '—'}</Typography.Text>;
  }
  return (
    <Tooltip title="Действий в CRM за месяц: сделки, клиенты, оплаты, задачи…">
      <Typography.Text style={{ fontSize: 13 }}>Действий в CRM: {row.crmActions}</Typography.Text>
    </Tooltip>
  );
}

function AttendanceCell({ a }: { a: EmployeeCardRow['attendance'] }) {
  return (
    <Space direction="vertical" size={2}>
      <Typography.Text style={{ fontSize: 13 }}>
        Вовремя {a.onTime} из {a.workdays}
      </Typography.Text>
      <Space size={4} wrap>
        {a.late > 0 && <Tag color="error">опозданий {a.late}</Tag>}
        {a.absent > 0 && <Tag color="red">прогулов {a.absent}</Tag>}
        {a.excluded > 0 && <Tag>отпуск/больн. {a.excluded}</Tag>}
      </Space>
    </Space>
  );
}

/**
 * Карточки сотрудников за месяц: что человек сделал (автоматически из CRM) и как
 * его оценил HR. Заменяет старый «Аудит сотрудников» с одной цифрой за день.
 */
export default function EmployeeCardsPage() {
  const isMobile = useIsMobile();
  const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'));
  const [group, setGroup] = useState<GroupFilter>('all');
  const [onlyUnrated, setOnlyUnrated] = useState(false);
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const year = month.year();
  const monthNum = month.month() + 1;

  const { data, isLoading } = useQuery({
    queryKey: ['employee-cards', year, monthNum],
    queryFn: () => employeeCardsApi.list(year, monthNum),
  });

  const rows = useMemo(
    () =>
      (data ?? []).filter((r) => (group === 'all' || r.group === group) && (!onlyUnrated || !r.review?.score)),
    [data, group, onlyUnrated],
  );
  const rated = (data ?? []).filter((r) => r.review?.score).length;

  const columns = [
    {
      title: 'Сотрудник',
      key: 'name',
      fixed: 'left' as const,
      width: 190,
      render: (_: unknown, r: EmployeeCardRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{getFirstName(r.fullName) || r.fullName}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {EMPLOYEE_ROLE_LABELS[r.role] ?? r.role}
            {r.department ? ` · ${r.department}` : ''}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Посещаемость',
      key: 'att',
      width: 200,
      sorter: (a: EmployeeCardRow, b: EmployeeCardRow) => a.attendance.late + a.attendance.absent - (b.attendance.late + b.attendance.absent),
      render: (_: unknown, r: EmployeeCardRow) => <AttendanceCell a={r.attendance} />,
    },
    {
      title: 'Задачи',
      key: 'tasks',
      width: 150,
      sorter: (a: EmployeeCardRow, b: EmployeeCardRow) => a.tasks.overdueOpen - b.tasks.overdueOpen,
      render: (_: unknown, r: EmployeeCardRow) => (
        <Space direction="vertical" size={2}>
          <Typography.Text style={{ fontSize: 13 }}>
            Сделано {r.tasks.done} из {r.tasks.dueInMonth}
          </Typography.Text>
          {r.tasks.overdueOpen > 0 && <Tag color="error">просрочено {r.tasks.overdueOpen}</Tag>}
        </Space>
      ),
    },
    {
      title: 'Работа',
      key: 'work',
      width: 240,
      render: (_: unknown, r: EmployeeCardRow) => <WorkCell row={r} />,
    },
    {
      title: 'Оценка HR',
      key: 'review',
      width: 170,
      sorter: (a: EmployeeCardRow, b: EmployeeCardRow) => (a.review?.score ?? 0) - (b.review?.score ?? 0),
      render: (_: unknown, r: EmployeeCardRow) =>
        r.review?.score ? (
          <Space size={6}>
            <Rate disabled allowHalf value={Math.round(r.review.score * 2) / 2} style={{ fontSize: 13 }} />
            <Typography.Text strong>{r.review.score}</Typography.Text>
          </Space>
        ) : (
          <Tag>Не оценён</Tag>
        ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Карточки сотрудников</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Показатели за месяц собираются из CRM автоматически, HR добавляет оценку и комментарии.
            Оценено: {rated} из {data?.length ?? 0}
          </Typography.Text>
        </div>
        <DatePicker
          picker="month"
          value={month}
          onChange={(v) => v && setMonth(v.startOf('month'))}
          allowClear={false}
          format="MMMM YYYY"
        />
      </div>

      <Card bordered={false}>
        <Space style={{ marginBottom: 16 }} wrap>
          <Segmented<GroupFilter>
            value={group}
            onChange={setGroup}
            options={[
              { value: 'all', label: 'Все' },
              { value: 'sales', label: 'Продажи' },
              { value: 'operations', label: 'Склад и доставка' },
              { value: 'office', label: 'Офис' },
            ]}
          />
          <Space size={6}>
            <Switch size="small" checked={onlyUnrated} onChange={setOnlyUnrated} />
            <Typography.Text>Только без оценки</Typography.Text>
          </Space>
        </Space>

        <Table<EmployeeCardRow>
          dataSource={rows}
          columns={columns}
          rowKey="userId"
          loading={isLoading}
          size="middle"
          pagination={false}
          scroll={{ x: isMobile ? 950 : undefined }}
          onRow={(r) => ({ onClick: () => setOpenUserId(r.userId), style: { cursor: 'pointer' } })}
          locale={{ emptyText: 'Нет сотрудников' }}
        />
      </Card>

      <EmployeeCardDrawer
        userId={openUserId}
        year={year}
        month={monthNum}
        onClose={() => setOpenUserId(null)}
      />
    </div>
  );
}
