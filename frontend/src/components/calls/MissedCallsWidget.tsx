import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, List, Space, Table, Tag, Typography, message, theme } from 'antd';
import { PhoneOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { callsApi, type MissedGroup } from '../../api/calls.api';
import { formatUzPhone } from '../../utils/phone';
import { apiErrorMessage } from './callsUi';

/**
 * Главная: «Пропущенные сегодня». Менеджер видит свои с кнопкой «Перезвонил»,
 * руководитель — сводку по менеджерам; не отработанные дольше 2 часов подсвечены.
 * Нет пропущенных — виджета нет.
 */
export default function MissedCallsWidget() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['calls-missed'], queryFn: callsApi.missed, refetchInterval: 60_000 });

  const calledBack = useMutation({
    mutationFn: (callId: string) => callsApi.calledBack(callId),
    onSuccess: () => {
      message.success('Отмечено: перезвонили');
      queryClient.invalidateQueries({ queryKey: ['calls-missed'] });
      queryClient.invalidateQueries({ queryKey: ['calls'] });
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  if (!data || data.items.length === 0) return null;

  const title = (
    <Space>
      <PhoneOutlined />
      Пропущенные сегодня
      {data.pendingCount > 0 && <Badge count={data.pendingCount} />}
    </Space>
  );
  const who = (g: MissedGroup) => g.client?.companyName ?? (formatUzPhone(g.phone) || 'скрытый номер');

  if (data.scope === 'all' && data.managers) {
    return (
      <Card title={title} size="small" style={{ marginTop: 16 }} extra={<Link to="/calls?missedOnly=1">Все звонки</Link>}>
        <Table
          size="small"
          rowKey="managerId"
          pagination={false}
          dataSource={data.managers}
          onRow={(m) => ({
            onClick: () => navigate(`/calls?missedOnly=1&managerId=${m.managerId}&from=${dayjs().format('YYYY-MM-DD')}`),
            style: { cursor: 'pointer', background: m.overdueCount > 0 ? token.colorErrorBg : undefined },
          })}
          columns={[
            { title: 'Менеджер', dataIndex: 'managerName' },
            { title: 'Пропущено', dataIndex: 'missedCount', width: 100 },
            { title: 'Не перезвонил', dataIndex: 'pendingCount', width: 120 },
            {
              title: 'Больше 2 ч',
              dataIndex: 'overdueCount',
              width: 110,
              render: (v: number) => (v > 0 ? <Tag color="red">{v}</Tag> : '—'),
            },
          ]}
        />
      </Card>
    );
  }

  return (
    <Card title={title} size="small" style={{ marginTop: 16 }} extra={<Link to="/calls?missedOnly=1">Все</Link>}>
      <List
        size="small"
        dataSource={data.items}
        renderItem={(g) => (
          <List.Item
            style={{ background: g.overdue ? token.colorErrorBg : undefined, paddingInline: 8, borderRadius: token.borderRadiusSM }}
            actions={g.handled ? [<Tag key="ok" color="green">Перезвонил</Tag>] : [
              <Button key="cb" size="small" type="primary" loading={calledBack.isPending && calledBack.variables === g.callId} onClick={() => calledBack.mutate(g.callId)}>
                Перезвонил
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={<Link to={`/calls?call=${g.callId}`}>{who(g)}</Link>}
              description={
                <Typography.Text type="secondary">
                  {g.client ? `${formatUzPhone(g.phone)} · ` : ''}
                  {dayjs(g.lastAt).format('HH:mm')}
                  {g.missedCount > 1 ? ` · ${g.missedCount} раза` : ''}
                  {g.overdue ? ' · больше 2 часов' : ''}
                </Typography.Text>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );
}
