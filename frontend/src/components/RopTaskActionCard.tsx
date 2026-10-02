import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { ropAgentApi, type RopTaskAction } from '../api/ropAgent.api';

const { Text } = Typography;

const errText = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Не удалось выполнить запрос';

const STATUS: Record<RopTaskAction['status'], { label: string; color: string }> = {
  PENDING: { label: 'ждёт решения', color: 'gold' },
  DONE: { label: 'выполнено', color: 'success' },
  CANCELED: { label: 'отменено', color: 'default' },
};

/** Изменение задач, которое подготовил агент: «Выполнить» / «Отмена». */
export default function RopTaskActionCard({ action, chatId }: { action: RopTaskAction; chatId: string }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rop-agent', 'task-actions', chatId] });
  const confirm = useMutation({
    mutationFn: () => ropAgentApi.confirmTaskAction(action.id),
    onSuccess: (r) => { message.success(`Готово, изменено задач: ${r.changed}`); refresh(); },
    onError: (e) => message.error(errText(e)),
  });
  const cancel = useMutation({
    mutationFn: () => ropAgentApi.cancelTaskAction(action.id),
    onSuccess: () => { message.info('Отменено'); refresh(); },
    onError: (e) => message.error(errText(e)),
  });
  const pending = action.status === 'PENDING';
  const run = (
    <Button type="primary" size="small" icon={<CheckOutlined />} loading={confirm.isPending}
      danger={action.action === 'delete'} onClick={action.action === 'delete' ? undefined : () => confirm.mutate()}>
      Выполнить ({action.tasks})
    </Button>
  );

  return (
    <Card size="small" title="Изменение задач" extra={<Tag color={STATUS[action.status].color}>{STATUS[action.status].label}</Tag>}>
      <Text>{action.summary}</Text>
      {action.status === 'DONE' && action.changed != null && (
        <div style={{ marginTop: 6 }}><Text type="secondary">Изменено задач: {action.changed}. </Text><Link to="/tasks">Открыть задачи</Link></div>
      )}
      {pending && (
        <Space style={{ marginTop: 10 }} wrap>
          {action.action === 'delete'
            ? <Popconfirm title="Удалить задачи совсем? Вернуть их будет нельзя." okText="Удалить" okButtonProps={{ danger: true }} onConfirm={() => confirm.mutate()}>{run}</Popconfirm>
            : run}
          <Button size="small" icon={<CloseOutlined />} loading={cancel.isPending} onClick={() => cancel.mutate()}>Отмена</Button>
        </Space>
      )}
    </Card>
  );
}
