import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, List, Space, Tag, Typography, message, theme } from 'antd';
import { PhoneOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { hrCallsApi } from '../../api/calls.api';
import { useAuthStore } from '../../store/authStore';
import { formatUzPhone } from '../../utils/phone';
import { apiErrorMessage } from './callsUi';

/** Главная у HR: её пропущенные за сегодня с телефона HR и кнопка «Перезвонила». Нет пропущенных — нет виджета. */
export default function HrMissedCallsWidget() {
  const role = useAuthStore((s) => s.user?.role);
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['hr-calls-missed'],
    queryFn: hrCallsApi.missed,
    enabled: role === 'HR',
    refetchInterval: 60_000,
  });
  const calledBack = useMutation({
    mutationFn: (callId: string) => hrCallsApi.calledBack(callId),
    onSuccess: () => {
      message.success('Отмечено: перезвонила');
      queryClient.invalidateQueries({ queryKey: ['hr-calls-missed'] });
      queryClient.invalidateQueries({ queryKey: ['hr-calls'] });
      queryClient.invalidateQueries({ queryKey: ['hr-calls-summary'] });
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  if (role !== 'HR' || !data || data.items.length === 0) return null;
  return (
    <Card
      size="small"
      style={{ marginTop: 16 }}
      title={<Space><PhoneOutlined />Пропущенные сегодня (HR){data.pendingCount > 0 && <Badge count={data.pendingCount} />}</Space>}
      extra={<Link to="/hr-calls?missedOnly=1">Все</Link>}
    >
      <List
        size="small"
        dataSource={data.items}
        renderItem={(g) => (
          <List.Item
            style={{ background: g.overdue ? token.colorErrorBg : undefined, paddingInline: 8, borderRadius: token.borderRadiusSM }}
            actions={g.handled ? [<Tag key="ok" color="green">Перезвонила</Tag>] : [
              <Button key="cb" size="small" type="primary" loading={calledBack.isPending && calledBack.variables === g.callId} onClick={() => calledBack.mutate(g.callId)}>
                Перезвонила
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={<Link to={`/hr-calls?call=${g.callId}`}>{formatUzPhone(g.phone) || 'скрытый номер'}</Link>}
              description={(
                <Typography.Text type="secondary">
                  {dayjs(g.lastAt).format('HH:mm')}
                  {g.missedCount > 1 ? ` · ${g.missedCount} раза` : ''}
                  {g.overdue ? ' · больше 2 часов' : ''}
                </Typography.Text>
              )}
            />
          </List.Item>
        )}
      />
    </Card>
  );
}
