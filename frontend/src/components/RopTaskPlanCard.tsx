import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, DatePicker, Input, Popconfirm, Select, Space, Tag, Typography, message, theme,
} from 'antd';
import { CheckCircleOutlined, CloseOutlined, DeleteOutlined, SendOutlined, UndoOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  ropAgentApi, type RopManager, type RopPlanItem, type RopTaskPlan,
} from '../api/ropAgent.api';

const { Text } = Typography;

function errorMessage(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Не удалось выполнить запрос';
}

const sameItems = (a: RopPlanItem[], b: RopPlanItem[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * План задач от РОП-агента под его ответом. Пока это черновик — директор правит
 * исполнителя, срок, текст и список клиентов и нажимает «Раздать»; только тогда
 * в CRM появляются задачи. Розданный или отклонённый план показывается итогом.
 */
export default function RopTaskPlanCard({ plan, managers }: { plan: RopTaskPlan; managers: RopManager[] }) {
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<RopPlanItem[]>(plan.items);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Сервер вернул новую версию (после сохранения или раздачи) — берём её.
  useEffect(() => setItems(plan.items), [plan.items]);

  const dirty = !sameItems(items, plan.items);
  const isDraft = plan.status === 'DRAFT';
  const totalClients = items.reduce((s, i) => s + i.clients.length, 0);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rop-agent', 'plans', plan.chatId] });

  const saveMutation = useMutation({
    mutationFn: () => ropAgentApi.updatePlan(plan.id, { items }),
    onSuccess: (r) => {
      setWarnings(r.warnings);
      refresh();
      message.success('План сохранён');
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (dirty) await ropAgentApi.updatePlan(plan.id, { items });
      return ropAgentApi.assignPlan(plan.id);
    },
    onSuccess: (r) => {
      setWarnings(r.warnings);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      message.success(`Роздано задач: ${r.createdTasks}`);
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const discardMutation = useMutation({
    mutationFn: () => ropAgentApi.discardPlan(plan.id),
    onSuccess: refresh,
    onError: (err) => message.error(errorMessage(err)),
  });

  const patchItem = (key: string, patch: Partial<RopPlanItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));
  const removeClient = (key: string, clientId: string) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, clients: i.clients.filter((c) => c.clientId !== clientId) } : i)));

  const managerOptions = useMemo(() => {
    const opts = managers.map((m) => ({ value: m.id, label: m.name }));
    // Сотрудник из плана мог не попасть в список (например, без клиентов) — не теряем его.
    for (const i of items) if (!opts.some((o) => o.value === i.managerId)) opts.push({ value: i.managerId, label: i.managerName });
    return opts;
  }, [managers, items]);

  const statusTag = plan.status === 'ASSIGNED'
    ? <Tag color="success" icon={<CheckCircleOutlined />}>Роздано {plan.assignedAt ? dayjs(plan.assignedAt).format('DD.MM HH:mm') : ''}</Tag>
    : plan.status === 'DISCARDED'
      ? <Tag>Отклонён</Tag>
      : <Tag color="processing">Черновик — задачи ещё не розданы</Tag>;

  if (plan.status === 'DISCARDED') {
    return (
      <div style={{ padding: '8px 12px', borderRadius: 10, border: `1px dashed ${token.colorBorder}`, opacity: 0.7 }}>
        <Space size={8} wrap>
          <Text delete>{plan.title}</Text>
          {statusTag}
        </Space>
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: 12, border: `1px solid ${isDraft ? token.colorPrimaryBorder : token.colorSuccessBorder}`,
      background: token.colorBgContainer, padding: 12,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
        <Text strong style={{ fontSize: 15 }}>{plan.title}</Text>
        {statusTag}
      </div>
      {plan.goal && <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>{plan.goal}</Text>}
      <Text type="secondary" style={{ fontSize: 12 }}>
        {items.length} {items.length === 1 ? 'задача' : 'задач(и)'} · {totalClients} клиентов
      </Text>

      {warnings.length > 0 && (
        <Alert type="warning" showIcon style={{ marginTop: 8 }} closable onClose={() => setWarnings([])}
          message="Часть плана изменена при проверке" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {items.map((item) => (
          <div key={item.key} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 10, padding: 10 }}>
            {isDraft ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Select
                    size="small"
                    style={{ minWidth: 170, flex: '1 1 170px' }}
                    value={item.managerId}
                    options={managerOptions}
                    showSearch
                    optionFilterProp="label"
                    onChange={(v, opt) => patchItem(item.key, { managerId: v, managerName: (opt as { label: string }).label })}
                  />
                  <DatePicker
                    size="small"
                    format="DD.MM.YYYY"
                    placeholder="Срок"
                    value={item.dueDate ? dayjs(item.dueDate) : null}
                    onChange={(d) => patchItem(item.key, { dueDate: d ? d.format('YYYY-MM-DD') : null })}
                    style={{ flex: '0 0 130px' }}
                  />
                  <Popconfirm title="Убрать задачу из плана?" okText="Да" cancelText="Нет" onConfirm={() => removeItem(item.key)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </div>
                <Input size="small" value={item.title} maxLength={200}
                  onChange={(e) => patchItem(item.key, { title: e.target.value })} placeholder="Название задачи" />
                <Input.TextArea size="small" value={item.description} maxLength={4000} autoSize={{ minRows: 1, maxRows: 5 }}
                  onChange={(e) => patchItem(item.key, { description: e.target.value })} placeholder="Что сделать и какой результат нужен" />
              </div>
            ) : (
              <div>
                <Space size={6} wrap>
                  <Text strong>{item.managerName}</Text>
                  <Text>· {item.title}</Text>
                  {item.dueDate && <Text type="secondary">до {dayjs(item.dueDate).format('DD.MM')}</Text>}
                </Space>
                {item.description && <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 2 }}>{item.description}</div>}
              </div>
            )}

            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {item.clients.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>Без списка клиентов</Text>}
              {item.clients.map((c) => (
                <div key={c.clientId} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 6px', borderRadius: 6,
                  background: token.colorFillQuaternary, fontSize: 13,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link to={`/clients/${c.clientId}`} target="_blank">{c.name}</Link>
                    {c.phone && <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{c.phone}</Text>}
                    {c.offer && <div>{c.offer}</div>}
                    {c.reason && <div><Text type="secondary" style={{ fontSize: 12 }}>{c.reason}</Text></div>}
                  </div>
                  {isDraft && (
                    <Button size="small" type="text" icon={<CloseOutlined />} title="Убрать клиента"
                      onClick={() => removeClient(item.key, c.clientId)} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {isDraft ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Popconfirm
            title="Раздать задачи менеджерам?"
            description={`Будет создано задач: ${items.length}. Менеджеры увидят их в разделе «Задачи».`}
            okText="Раздать"
            cancelText="Отмена"
            onConfirm={() => assignMutation.mutate()}
            disabled={!items.length}
          >
            <Button type="primary" icon={<SendOutlined />} loading={assignMutation.isPending} disabled={!items.length}>
              Раздать
            </Button>
          </Popconfirm>
          {dirty && (
            <>
              <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!items.length}>Сохранить правки</Button>
              <Button type="text" icon={<UndoOutlined />} onClick={() => setItems(plan.items)}>Вернуть как было</Button>
            </>
          )}
          <Popconfirm title="Отклонить план?" okText="Да" cancelText="Нет" onConfirm={() => discardMutation.mutate()}>
            <Button type="text" danger loading={discardMutation.isPending}>Отклонить</Button>
          </Popconfirm>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <Link to="/tasks">Открыть задачи</Link>
        </div>
      )}
    </div>
  );
}
