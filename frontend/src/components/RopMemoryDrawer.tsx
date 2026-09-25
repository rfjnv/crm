import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Drawer, Empty, Input, List, Popconfirm, Space, Spin, Tag, Typography, message, theme } from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useIsMobile } from '../hooks/useIsMobile';
import { ropAgentApi, type RopMemory } from '../api/ropAgent.api';

const { Text } = Typography;

function errorMessage(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Не удалось выполнить запрос';
}

const isExpired = (m: RopMemory) => !!m.expiresAt && dayjs(m.expiresAt).isBefore(dayjs());

/**
 * Что помнит РОП-агент: решения и договорённости директора, которые действуют во всех
 * разговорах, в сводке и сигналах. Агент пополняет память сам («Запомнил: …»), здесь
 * её можно поправить, удалить лишнее или добавить вручную.
 */
export default function RopMemoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [draftExpires, setDraftExpires] = useState<Dayjs | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editExpires, setEditExpires] = useState<Dayjs | null>(null);

  const { data: memories = [], isLoading } = useQuery({
    queryKey: ['rop-agent', 'memories'],
    queryFn: ropAgentApi.listMemories,
    enabled: open,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rop-agent', 'memories'] });

  const addMutation = useMutation({
    mutationFn: () => ropAgentApi.addMemory({ content: draft.trim(), expiresOn: draftExpires?.format('YYYY-MM-DD') ?? null }),
    onSuccess: () => { setDraft(''); setDraftExpires(null); refresh(); },
    onError: (err) => message.error(errorMessage(err)),
  });
  const updateMutation = useMutation({
    mutationFn: (id: string) => ropAgentApi.updateMemory(id, { content: editText.trim(), expiresOn: editExpires?.format('YYYY-MM-DD') ?? null }),
    onSuccess: () => { setEditingId(null); refresh(); },
    onError: (err) => message.error(errorMessage(err)),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => ropAgentApi.deleteMemory(id),
    onSuccess: refresh,
    onError: (err) => message.error(errorMessage(err)),
  });

  const startEdit = (m: RopMemory) => {
    setEditingId(m.id);
    setEditText(m.content);
    setEditExpires(m.expiresAt ? dayjs(m.expiresAt) : null);
  };

  return (
    <Drawer title="Что помнит агент" open={open} onClose={onClose} width={isMobile ? '100%' : 520} destroyOnHidden>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
        Решения и договорённости, которые агент учитывает во всех разговорах, в сводке и сигналах.
        Обычно он запоминает сам, когда вы говорите «запомни» или принимаете решение.
      </Text>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        <Input.TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Например: скидки на ламинацию не предлагать"
          autoSize={{ minRows: 1, maxRows: 4 }}
          maxLength={500}
        />
        <Space wrap>
          <DatePicker value={draftExpires} onChange={setDraftExpires} format="DD.MM.YYYY" placeholder="Срок, если временно" style={{ width: 180 }} />
          <Button type="primary" icon={<PlusOutlined />} disabled={!draft.trim()} loading={addMutation.isPending} onClick={() => addMutation.mutate()}>
            Запомнить
          </Button>
        </Space>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : memories.length === 0 ? (
        <Empty description="Пока ничего не запомнено" />
      ) : (
        <List
          dataSource={memories}
          renderItem={(m) => (
            <List.Item style={{ display: 'block', opacity: isExpired(m) ? 0.55 : 1 }}>
              {editingId === m.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Input.TextArea value={editText} onChange={(e) => setEditText(e.target.value)} autoSize={{ minRows: 1, maxRows: 5 }} maxLength={500} />
                  <Space wrap>
                    <DatePicker value={editExpires} onChange={setEditExpires} format="DD.MM.YYYY" placeholder="Бессрочно" />
                    <Button size="small" type="primary" icon={<CheckOutlined />} disabled={!editText.trim()}
                      loading={updateMutation.isPending} onClick={() => updateMutation.mutate(m.id)}>Сохранить</Button>
                    <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingId(null)}>Отмена</Button>
                  </Space>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    <Space size={6} wrap style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {m.createdBy.fullName}, {dayjs(m.createdAt).format('DD.MM.YYYY')}
                      </Text>
                      {m.source === 'agent' && <Tag color="purple" style={{ margin: 0 }}>из разговора</Tag>}
                      {m.expiresAt && (
                        <Tag color={isExpired(m) ? 'default' : 'blue'} style={{ margin: 0 }}>
                          {isExpired(m) ? 'истекло' : 'до'} {dayjs(m.expiresAt).format('DD.MM.YYYY')}
                        </Tag>
                      )}
                    </Space>
                  </div>
                  <Space size={0}>
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => startEdit(m)} />
                    <Popconfirm title="Забыть это?" okText="Да" cancelText="Нет" onConfirm={() => deleteMutation.mutate(m.id)}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined style={{ color: token.colorError }} />} />
                    </Popconfirm>
                  </Space>
                </div>
              )}
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
}
