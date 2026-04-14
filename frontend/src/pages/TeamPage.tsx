import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Typography, Button, Modal, Form, Input, Select, ColorPicker, message } from 'antd';
import { Link } from 'react-router-dom';
import { UserOutlined, EditOutlined } from '@ant-design/icons';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { TeamMedalDisplay } from '../components/TeamMedalDisplay';
import { USER_BADGE_ICON_KEYS, USER_BADGE_ICON_LABELS } from '../constants/userBadges';
import type { User } from '../types';

/**
 * Команда — ФИО и медали (активные). Админы могут задать медаль здесь же.
 */
export default function TeamPage() {
  const isAdmin = useAuthStore((s) => {
    const r = s.user?.role;
    return r === 'ADMIN' || r === 'SUPER_ADMIN';
  });

  const [medalUser, setMedalUser] = useState<User | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const badgeOptions = USER_BADGE_ICON_KEYS.map((k) => ({
    value: k,
    label: USER_BADGE_ICON_LABELS[k],
  }));

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', 'team'],
    queryFn: () => usersApi.list(),
  });

  const updateMedalMut = useMutation({
    mutationFn: (payload: {
      id: string;
      data: { badgeLabel: string | null; badgeIcon: string | null; badgeColor: string | null };
    }) => usersApi.update(payload.id, payload.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      message.success('Медаль сохранена');
      closeMedalModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  function openMedalModal(user: User) {
    setMedalUser(user);
    form.setFieldsValue({
      badgeLabel: user.badgeLabel ?? '',
      badgeIcon: user.badgeIcon ?? undefined,
      badgeColor: user.badgeColor || '#22609A',
    });
  }

  function closeMedalModal() {
    setMedalUser(null);
    form.resetFields();
  }

  function submitMedal(values: Record<string, unknown>) {
    if (!medalUser) return;
    const rawColor = values.badgeColor;
    const color =
      typeof rawColor === 'string'
        ? rawColor
        : (rawColor as { toHexString?: () => string } | undefined)?.toHexString?.() ?? null;
    const rawLabel = (values.badgeLabel as string | undefined)?.trim();
    updateMedalMut.mutate({
      id: medalUser.id,
      data: {
        badgeLabel: rawLabel || null,
        badgeIcon: (values.badgeIcon as string | undefined) ?? null,
        badgeColor: color,
      },
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Команда
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Имена и медали (произвольная подпись, цвет и иконка — как у SVIP).
            {isAdmin
              ? ' Администраторы могут задать или изменить медаль прямо здесь.'
              : ' Учётные записи и роли — в разделе «Пользователи» (для администраторов).'}
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
        scroll={{ x: isAdmin ? 420 : 400 }}
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
          ...(isAdmin
            ? [
                {
                  title: '',
                  key: 'medalEdit',
                  width: 56,
                  align: 'center' as const,
                  render: (_: unknown, r: User) => (
                    <Button type="text" size="small" icon={<EditOutlined />} aria-label="Медаль" onClick={() => openMedalModal(r)} />
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        title={medalUser ? `Медаль — ${medalUser.fullName}` : 'Медаль'}
        open={!!medalUser}
        onCancel={closeMedalModal}
        onOk={() => form.submit()}
        confirmLoading={updateMedalMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
        width={440}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0, fontSize: 13 }}>
          Произвольная подпись (как «SVIP»), цвет и иконка — отдельно от системной роли.
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={submitMedal}>
          <Form.Item name="badgeLabel" label="Подпись">
            <Input placeholder="Например: упорный, лентяй, SVIP" maxLength={48} showCount />
          </Form.Item>
          <Form.Item name="badgeIcon" label="Иконка">
            <Select allowClear placeholder="Без иконки" options={badgeOptions} />
          </Form.Item>
          <Form.Item
            name="badgeColor"
            label="Цвет"
            getValueFromEvent={(v: string | { toHexString?: () => string }) =>
              typeof v === 'string' ? v : v?.toHexString?.() ?? '#22609A'
            }
          >
            <ColorPicker showText format="hex" disabledAlpha />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
