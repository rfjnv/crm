import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Collapse, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { EyeInvisibleOutlined, LinkOutlined, ReloadOutlined, UndoOutlined } from '@ant-design/icons';
import { timepayApi } from '../api/timepay.api';
import { usersApi } from '../api/users.api';
import type { TimePayEmployee } from '../types';
import { smartFilterOption } from '../utils/translit';

/** Филиалы в аккаунте TimePay компании — подсказки для выбора; можно вписать и другой. */
const KNOWN_BRANCHES = ['Polygraph', 'Basys', "Do'mbirobod"];

/**
 * Сотрудники TimePay выбранных филиалов: привязка к пользователям CRM и скрытие.
 * Скрытые не синхронизируются — их отметки не попадают в «Посещаемость».
 */
export default function TimePayEmployeesPanel({ branches }: { branches: string[] }) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<Record<string, string | undefined>>({});

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['timepay-employees'],
    queryFn: () => timepayApi.employees(),
    staleTime: 60_000,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-for-timepay'],
    queryFn: () => usersApi.list({ includeInactive: true }),
  });

  const bindMut = useMutation({
    mutationFn: ({ userId, timepayId }: { userId: string; timepayId: string }) =>
      usersApi.update(userId, { timepayEmployeeId: timepayId }),
    onSuccess: () => {
      message.success('Сотрудник привязан. Отметки появятся после следующей синхронизации');
      queryClient.invalidateQueries({ queryKey: ['timepay-employees'] });
      queryClient.invalidateQueries({ queryKey: ['users-for-timepay'] });
      queryClient.invalidateQueries({ queryKey: ['users-for-attendance'] });
    },
    onError: () => message.error('Не удалось привязать'),
  });

  const settingsMut = useMutation({
    mutationFn: timepayApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timepay-status'] });
      queryClient.invalidateQueries({ queryKey: ['timepay-employees'] });
    },
    onError: () => message.error('Не удалось сохранить настройки TimePay'),
  });

  const hiddenIds = (data?.hidden ?? []).map((h) => h.timepayId);
  const setHidden = (ids: string[]) => settingsMut.mutate({ hiddenEmployeeIds: ids });

  const userOptions = users.map((u) => ({
    value: u.id,
    label: `${u.fullName}${u.timepayEmployeeId ? ` · уже привязан (ID ${u.timepayEmployeeId})` : ''}${u.isActive ? '' : ' · неактивен'}`,
  }));

  if (data?.status === 'AUTH_ERROR') {
    return <Alert type="error" showIcon message="Токен TimePay недействителен — обновите его выше" />;
  }
  if (data?.status === 'NOT_CONFIGURED') return null;

  const employees = data?.employees ?? [];
  const hidden = data?.hidden ?? [];
  const unboundCount = employees.filter((e) => !e.boundUser).length;

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Text>Филиалы:</Typography.Text>
        <Select
          mode="tags"
          style={{ minWidth: 280 }}
          placeholder="Все филиалы"
          value={branches}
          options={KNOWN_BRANCHES.map((b) => ({ value: b, label: b }))}
          loading={settingsMut.isPending && !!settingsMut.variables?.branches}
          onChange={(v: string[]) => settingsMut.mutate({ branches: v })}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {branches.length ? 'Синхронизируются только сотрудники этих филиалов' : 'Синхронизируются все филиалы'}
        </Typography.Text>
      </Space>

      <Space wrap>
        <Typography.Text strong>
          Сотрудники TimePay: {employees.length}
          {unboundCount > 0 && ` · не привязаны: ${unboundCount}`}
        </Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
          Обновить
        </Button>
      </Space>

      {employees.length > 0 && (
        <Table<TimePayEmployee>
          size="small"
          rowKey="timepayId"
          pagination={false}
          dataSource={employees}
          scroll={{ x: 640 }}
          columns={[
            { title: 'Сотрудник в TimePay', dataIndex: 'name' },
            { title: 'ID', dataIndex: 'timepayId', width: 90 },
            {
              title: 'Пользователь CRM',
              width: 280,
              render: (_, row) =>
                row.boundUser ? (
                  <Tag color="green">{row.boundUser.fullName}</Tag>
                ) : (
                  <Select
                    showSearch
                    allowClear
                    style={{ width: '100%' }}
                    placeholder="Выберите сотрудника"
                    filterOption={smartFilterOption}
                    options={userOptions}
                    value={chosen[row.timepayId] ?? row.suggestedUserId ?? undefined}
                    onChange={(v) => setChosen((prev) => ({ ...prev, [row.timepayId]: v }))}
                  />
                ),
            },
            {
              title: '',
              width: 200,
              render: (_, row) => {
                const userId = chosen[row.timepayId] ?? row.suggestedUserId ?? undefined;
                return (
                  <Space size={4}>
                    {!row.boundUser && (
                      <Button
                        size="small"
                        icon={<LinkOutlined />}
                        disabled={!userId}
                        loading={bindMut.isPending && bindMut.variables?.timepayId === row.timepayId}
                        onClick={() => userId && bindMut.mutate({ userId, timepayId: row.timepayId })}
                      >
                        Привязать
                      </Button>
                    )}
                    <Popconfirm
                      title="Скрыть сотрудника?"
                      description="Его отметки перестанут попадать в «Посещаемость». Вернуть можно ниже."
                      okText="Скрыть"
                      cancelText="Отмена"
                      onConfirm={() => setHidden([...hiddenIds, row.timepayId])}
                    >
                      <Button size="small" icon={<EyeInvisibleOutlined />}>
                        Скрыть
                      </Button>
                    </Popconfirm>
                  </Space>
                );
              },
            },
          ]}
        />
      )}

      {hidden.length > 0 && (
        <Collapse
          size="small"
          items={[
            {
              key: 'hidden',
              label: `Скрытые: ${hidden.length}`,
              children: (
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {hidden.map((h) => (
                    <Space key={h.timepayId} style={{ justifyContent: 'space-between', width: '100%' }}>
                      <Typography.Text>
                        {h.name} <Typography.Text type="secondary">· ID {h.timepayId}</Typography.Text>
                      </Typography.Text>
                      <Button
                        size="small"
                        icon={<UndoOutlined />}
                        onClick={() => setHidden(hiddenIds.filter((id) => id !== h.timepayId))}
                      >
                        Вернуть
                      </Button>
                    </Space>
                  ))}
                </Space>
              ),
            },
          ]}
        />
      )}
    </Space>
  );
}
