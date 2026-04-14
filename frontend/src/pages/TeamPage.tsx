import { useQuery } from '@tanstack/react-query';
import { Table, Typography, Button } from 'antd';
import { Link } from 'react-router-dom';
import { UserOutlined } from '@ant-design/icons';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { TeamMedalDisplay } from '../components/TeamMedalDisplay';
import type { User } from '../types';

/**
 * Команда — только просмотр: ФИО и медали (активные пользователи).
 * Управление учётками — «Пользователи» (/users) для админов.
 */
export default function TeamPage() {
  const isAdmin = useAuthStore((s) => {
    const r = s.user?.role;
    return r === 'ADMIN' || r === 'SUPER_ADMIN';
  });

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', 'team'],
    queryFn: () => usersApi.list(),
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Команда
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Имена и медали. Учётные записи и роли настраиваются в разделе «Пользователи» (для администраторов).
          </Typography.Text>
        </div>
        {isAdmin && (
          <Link to="/users">
            <Button type="primary" icon={<UserOutlined />}>
              Пользователи
            </Button>
          </Link>
        )}
      </div>

      <Table<User>
        dataSource={users}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="middle"
        bordered={false}
        scroll={{ x: 400 }}
        columns={[
          {
            title: 'ФИО',
            dataIndex: 'fullName',
            key: 'fullName',
            ellipsis: true,
          },
          {
            title: 'Медаль',
            key: 'medal',
            width: 280,
            render: (_: unknown, r: User) => (
              <TeamMedalDisplay badgeLabel={r.badgeLabel} badgeIcon={r.badgeIcon} badgeColor={r.badgeColor} variant="full" />
            ),
          },
        ]}
      />
    </div>
  );
}
