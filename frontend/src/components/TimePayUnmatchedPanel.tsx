import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Select, Space, Table, Typography, message } from 'antd';
import { LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { timepayApi } from '../api/timepay.api';
import { usersApi } from '../api/users.api';
import type { TimePayUnmatchedEmployee } from '../types';
import { smartFilterOption } from '../utils/translit';

/**
 * Сотрудники TimePay, которых синхронизация не смогла сопоставить с пользователями CRM.
 * Пока сотрудник не привязан, его отметки не попадают в «Посещаемость».
 */
export default function TimePayUnmatchedPanel() {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<Record<string, string | undefined>>({});

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['timepay-unmatched'],
    queryFn: () => timepayApi.unmatched(),
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
      queryClient.invalidateQueries({ queryKey: ['timepay-unmatched'] });
      queryClient.invalidateQueries({ queryKey: ['users-for-timepay'] });
      queryClient.invalidateQueries({ queryKey: ['users-for-attendance'] });
    },
    onError: () => message.error('Не удалось привязать'),
  });

  const userOptions = users.map((u) => ({
    value: u.id,
    label: `${u.fullName}${u.timepayEmployeeId ? ` · уже привязан (ID ${u.timepayEmployeeId})` : ''}${u.isActive ? '' : ' · неактивен'}`,
  }));

  if (data?.status === 'AUTH_ERROR') {
    return <Alert type="error" showIcon message="Токен TimePay недействителен — обновите его выше" />;
  }
  if (data?.status === 'NOT_CONFIGURED') return null;

  const employees = data?.employees ?? [];

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Space wrap>
        <Typography.Text strong>Не сопоставлены с пользователями CRM: {employees.length}</Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
          Обновить
        </Button>
      </Space>
      {employees.length > 0 && (
        <Table<TimePayUnmatchedEmployee>
          size="small"
          rowKey="timepayId"
          pagination={false}
          dataSource={employees}
          scroll={{ x: 560 }}
          columns={[
            { title: 'Сотрудник в TimePay', dataIndex: 'name' },
            { title: 'ID', dataIndex: 'timepayId', width: 90 },
            {
              title: 'Пользователь CRM',
              width: 280,
              render: (_, row) => (
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
              width: 120,
              render: (_, row) => {
                const userId = chosen[row.timepayId] ?? row.suggestedUserId ?? undefined;
                return (
                  <Button
                    size="small"
                    icon={<LinkOutlined />}
                    disabled={!userId}
                    loading={bindMut.isPending && bindMut.variables?.timepayId === row.timepayId}
                    onClick={() => userId && bindMut.mutate({ userId, timepayId: row.timepayId })}
                  >
                    Привязать
                  </Button>
                );
              },
            },
          ]}
        />
      )}
    </Space>
  );
}
