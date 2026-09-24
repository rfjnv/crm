import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Collapse, Drawer, Empty, Input, Popconfirm, Spin, Tag, Typography, message, theme,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, MenuOutlined, PlusOutlined,
  RobotOutlined, SendOutlined, UserOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useIsMobile } from '../hooks/useIsMobile';
import { ropAgentApi, type RopAgentChat, type RopAgentMessage, type RopTaskPlan } from '../api/ropAgent.api';
import RopTaskPlanCard from '../components/RopTaskPlanCard';

const { Text } = Typography;

const SIDEBAR_WIDTH = 280;

const SUGGESTIONS = [
  'Где конкуренты дешевле нас и на чём можно сделать демпинг без потери денег?',
  'Найди пропавших постоянных клиентов и подготовь задачи менеджерам на обзвон',
  'Какой товар залежался на складе и кому его предложить? Подготовь задачи',
  'Составь горячий и холодный списки клиентов по менеджерам',
  'Как менеджеры выполняют розданные задачи? Кого надо обсудить?',
  'Сравни менеджеров за этот месяц: выручка, сделки, активность',
];

function errorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { message?: string } } })?.response?.data;
  return data?.message || 'Не удалось выполнить запрос';
}

/** Сколько секунд агент уже думает — обновляется раз в секунду. */
function Elapsed({ since }: { since?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const sec = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return <Text type="secondary" style={{ fontSize: 12 }}>{sec} с</Text>;
}

export default function RopAgentPage() {
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: chats = [], isLoading: chatsLoading } = useQuery({
    queryKey: ['rop-agent', 'chats'],
    queryFn: ropAgentApi.listChats,
  });

  const { data: chatData, isLoading: messagesLoading } = useQuery({
    queryKey: ['rop-agent', 'messages', activeChatId],
    queryFn: () => ropAgentApi.getMessages(activeChatId!),
    enabled: !!activeChatId,
    // Пока агент отвечает — опрашиваем, чтобы видеть шаги и забрать ответ. Ответ идёт
    // минутами, и директор успевает уйти на другую вкладку — опрос не останавливаем.
    refetchInterval: (q) => (q.state.data?.status.running ? 2500 : false),
    refetchIntervalInBackground: true,
  });
  const messages = chatData?.messages ?? [];
  const status = chatData?.status;
  const running = !!status?.running;

  const { data: plans = [] } = useQuery({
    queryKey: ['rop-agent', 'plans', activeChatId],
    queryFn: () => ropAgentApi.listPlans(activeChatId!),
    enabled: !!activeChatId,
  });
  const planById = new Map(plans.map((p: RopTaskPlan) => [p.id, p]));
  const { data: managers = [] } = useQuery({
    queryKey: ['rop-agent', 'managers'],
    queryFn: ropAgentApi.listManagers,
    enabled: plans.length > 0,
    staleTime: 300_000,
  });

  // Ответ пришёл — обновим список чатов (название и порядок).
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      queryClient.invalidateQueries({ queryKey: ['rop-agent', 'chats'] });
      queryClient.invalidateQueries({ queryKey: ['rop-agent', 'plans', activeChatId] });
    }
    wasRunning.current = running;
  }, [running, queryClient, activeChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, status?.steps.length]);

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      let chatId = activeChatId;
      if (!chatId) {
        const chat = await ropAgentApi.createChat();
        chatId = chat.id;
        setActiveChatId(chat.id);
      }
      await ropAgentApi.ask(chatId, question);
      return chatId;
    },
    onSuccess: (chatId) => {
      setInput('');
      queryClient.invalidateQueries({ queryKey: ['rop-agent', 'messages', chatId] });
      queryClient.invalidateQueries({ queryKey: ['rop-agent', 'chats'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => ropAgentApi.renameChat(id, title),
    onSuccess: () => {
      setEditingChatId(null);
      queryClient.invalidateQueries({ queryKey: ['rop-agent', 'chats'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ropAgentApi.deleteChat(id),
    onSuccess: (_d, id) => {
      if (id === activeChatId) setActiveChatId(null);
      queryClient.invalidateQueries({ queryKey: ['rop-agent', 'chats'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const send = (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || running || askMutation.isPending) return;
    askMutation.mutate(question);
  };

  const askReport = (plan: RopTaskPlan) =>
    send(`Проверь выполнение плана «${plan.title}» (plan_id ${plan.id}): кто что сделал, где проблемы и что делать дальше.`);

  const openChat = (id: string | null) => {
    setActiveChatId(id);
    setSidebarOpen(false);
  };

  const sidebar = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 12 }}>
        <Button block icon={<PlusOutlined />} onClick={() => openChat(null)}>Новый разговор</Button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}>
        {chatsLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin size="small" /></div>
        ) : chats.length === 0 ? (
          <Text type="secondary" style={{ display: 'block', padding: 12, fontSize: 13 }}>Разговоров пока нет</Text>
        ) : chats.map((chat: RopAgentChat) => (
          <div
            key={chat.id}
            className="rop-chat-row"
            onClick={() => openChat(chat.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8,
              cursor: 'pointer',
              background: chat.id === activeChatId ? token.colorPrimaryBg : 'transparent',
            }}
          >
            {editingChatId === chat.id ? (
              <div style={{ flex: 1, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                <Input
                  size="small"
                  value={editTitle}
                  autoFocus
                  onChange={(e) => setEditTitle(e.target.value)}
                  onPressEnter={() => editTitle.trim() && renameMutation.mutate({ id: chat.id, title: editTitle.trim() })}
                />
                <Button size="small" type="text" icon={<CheckOutlined />}
                  onClick={() => editTitle.trim() && renameMutation.mutate({ id: chat.id, title: editTitle.trim() })} />
                <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setEditingChatId(null)} />
              </div>
            ) : (
              <>
                <Text ellipsis style={{ flex: 1, fontSize: 13 }}>{chat.title}</Text>
                <div className="rop-chat-actions" style={{ display: 'flex' }} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" type="text" icon={<EditOutlined style={{ fontSize: 12 }} />}
                    onClick={() => { setEditingChatId(chat.id); setEditTitle(chat.title); }} />
                  <Popconfirm title="Удалить разговор?" okText="Да" cancelText="Нет" onConfirm={() => deleteMutation.mutate(chat.id)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined style={{ fontSize: 12 }} />} />
                  </Popconfirm>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderMessage = (msg: RopAgentMessage) => {
    const isUser = msg.role === 'user';
    const tools = msg.toolCalls ?? [];
    const msgPlans = tools
      .map((t) => (t.planId ? planById.get(t.planId) : undefined))
      .filter((p): p is RopTaskPlan => !!p);
    return (
      <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isUser ? token.colorPrimary : token.colorBgElevated,
            color: isUser ? '#fff' : token.colorPrimary,
            border: isUser ? 'none' : `1px solid ${token.colorBorderSecondary}`,
          }}>
            {isUser ? <UserOutlined /> : <RobotOutlined />}
          </div>
          <div style={{
            maxWidth: isMobile ? '88%' : '80%', minWidth: 0, padding: '10px 14px', borderRadius: 12,
            background: isUser ? token.colorPrimary : msg.isError ? token.colorErrorBg : token.colorBgElevated,
            color: isUser ? '#fff' : undefined,
            border: isUser ? 'none' : `1px solid ${msg.isError ? token.colorErrorBorder : token.colorBorderSecondary}`,
          }}>
            {isUser ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
            ) : (
              <>
                <div className="rop-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown></div>
                {tools.length > 0 && (
                  <Collapse
                    ghost
                    size="small"
                    style={{ marginTop: 6 }}
                    items={[{
                      key: 'tools',
                      label: <Text type="secondary" style={{ fontSize: 12 }}>Что агент смотрел ({tools.length})</Text>,
                      children: (
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                          {tools.map((t, i) => (
                            <li key={i}><Text type={t.isError ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>{t.label}</Text></li>
                          ))}
                        </ul>
                      ),
                    }]}
                  />
                )}
              </>
            )}
          </div>
        </div>
        {msgPlans.map((p) => (
          <div key={p.id} style={{ marginLeft: isMobile ? 0 : 42, maxWidth: isMobile ? '100%' : 760 }}>
            <RopTaskPlanCard plan={p} managers={managers} onAskReport={askReport} />
          </div>
        ))}
      </div>
    );
  };

  const activeTitle = activeChatId ? chats.find((c) => c.id === activeChatId)?.title ?? 'Разговор' : 'РОП-агент';

  return (
    <div style={{
      display: 'flex', height: 'calc(100vh - 120px)', minHeight: 480,
      background: token.colorBgContainer, borderRadius: 12, overflow: 'hidden',
      border: `1px solid ${token.colorBorderSecondary}`,
    }}>
      {isMobile ? (
        <Drawer placement="left" open={sidebarOpen} onClose={() => setSidebarOpen(false)} width={SIDEBAR_WIDTH}
          styles={{ body: { padding: 0 } }} title="Разговоры">
          {sidebar}
        </Drawer>
      ) : (
        <div style={{ width: SIDEBAR_WIDTH, flexShrink: 0, borderRight: `1px solid ${token.colorBorderSecondary}` }}>
          {sidebar}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setSidebarOpen(true)} />}
          <RobotOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
          <Text strong ellipsis style={{ fontSize: 16, flex: 1, minWidth: 0 }}>{activeTitle}</Text>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '16px 12px' : '20px 24px' }}>
          {!activeChatId ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
              <Empty
                image={<RobotOutlined style={{ fontSize: 56, color: token.colorTextQuaternary }} />}
                description={(
                  <Text type="secondary">
                    Дайте задание — агент изучит продажи, склад и цены конкурентов и вернётся с идеями.
                  </Text>
                )}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 640 }}>
                {SUGGESTIONS.map((s) => (
                  <Tag key={s} color="blue" style={{ cursor: 'pointer', padding: '4px 12px', borderRadius: 16, whiteSpace: 'normal' }}
                    onClick={() => send(s)}>
                    {s}
                  </Tag>
                ))}
              </div>
            </div>
          ) : messagesLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {messages.map(renderMessage)}
              {running && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: token.colorPrimary, border: `1px solid ${token.colorBorderSecondary}`,
                  }}>
                    <RobotOutlined />
                  </div>
                  <div style={{ padding: '10px 14px', borderRadius: 12, border: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgElevated }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Spin size="small" />
                      <Text type="secondary">Изучаю данные…</Text>
                      <Elapsed since={status?.startedAt} />
                    </div>
                    {status && status.steps.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
                        {status.steps.map((s, i) => <li key={i}><Text type="secondary" style={{ fontSize: 12 }}>{s}</Text></li>)}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div style={{ padding: 12, borderTop: `1px solid ${token.colorBorderSecondary}`, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={running ? 'Агент отвечает…' : 'Задание или вопрос агенту (Shift+Enter — новая строка)'}
            autoSize={{ minRows: 1, maxRows: 6 }}
            disabled={running}
            maxLength={8000}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => send()}
            loading={askMutation.isPending}
            disabled={running || !input.trim()}
          />
        </div>
      </div>

      <style>{`
        .rop-chat-actions { opacity: 0; transition: opacity 0.2s; }
        .rop-chat-row:hover .rop-chat-actions { opacity: 1; }
        @media (hover: none) { .rop-chat-actions { opacity: 1; } }
        .rop-markdown { font-size: 14px; line-height: 1.65; overflow-x: auto; }
        .rop-markdown p { margin: 0 0 8px; }
        .rop-markdown p:last-child { margin-bottom: 0; }
        .rop-markdown h1, .rop-markdown h2, .rop-markdown h3 { font-size: 15px; font-weight: 600; margin: 14px 0 6px; }
        .rop-markdown h4 { font-size: 14px; font-weight: 600; margin: 10px 0 4px; }
        .rop-markdown ul, .rop-markdown ol { margin: 4px 0 8px; padding-left: 20px; }
        .rop-markdown table { border-collapse: collapse; margin: 10px 0; font-size: 13px; }
        .rop-markdown th, .rop-markdown td { border: 1px solid ${token.colorBorderSecondary}; padding: 6px 10px; text-align: left; }
        .rop-markdown th { background: ${token.colorFillQuaternary}; font-weight: 600; }
        .rop-markdown code { background: ${token.colorFillTertiary}; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
        .rop-markdown blockquote { border-left: 3px solid ${token.colorBorder}; margin: 8px 0; padding: 4px 12px; color: ${token.colorTextSecondary}; }
      `}</style>
    </div>
  );
}
