import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Input, Button, Typography, Tag, Space, Spin, Empty, theme,
  List, Popconfirm, Drawer,
} from 'antd';
import {
  SendOutlined, UserOutlined, CodeOutlined, DeleteOutlined,
  PlusOutlined, EditOutlined, CheckOutlined, CloseOutlined,
  MenuOutlined, MessageOutlined, SettingOutlined, AudioOutlined,
} from '@ant-design/icons';
import Icon from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  aiAssistantApi,
  type AiAssistantResponse,
  type AiEntity,
  type AiChat,
  type AiChatMessage,
} from '../api/ai-assistant.api';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuthStore } from '../store/authStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const { Text } = Typography;

const OpenAiSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
);
const OpenAiIcon = (props: any) => <Icon component={OpenAiSvg} {...props} />;

const SUGGESTION_CHIPS = [
  'У кого самая большая задолженность?',
  'Сколько всего клиентов?',
  'Топ 5 клиентов по сумме сделок',
  'Какие сделки были за последнюю неделю?',
  'Какие товары заканчиваются на складе?',
  'Какие пользователи есть у нас?',
];

const ENTITY_LABELS: Record<string, string> = {
  client: 'Клиент', deal: 'Сделка', product: 'Товар', user: 'Пользователь',
};
const ENTITY_COLORS: Record<string, string> = {
  client: 'blue', deal: 'green', product: 'orange', user: 'purple',
};

interface LocalMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string | null;
  entities?: AiEntity[] | null;
  isError: boolean;
  loading?: boolean;
}

const SIDEBAR_WIDTH = 280;

export default function AiAssistantPage() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSql, setShowSql] = useState<Record<string, boolean>>({});
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const sendingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { token: themeToken } = theme.useToken();
  const queryClient = useQueryClient();
  const userRole = useAuthStore((s) => s.user?.role);
  const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';

  const { data: chats = [], isLoading: chatsLoading } = useQuery({
    queryKey: ['ai-chats'],
    queryFn: aiAssistantApi.listChats,
  });

  // Load messages when active chat changes
  const { data: chatMessages, isLoading: messagesLoading } = useQuery({
    queryKey: ['ai-chat-messages', activeChatId],
    queryFn: () => aiAssistantApi.getMessages(activeChatId!),
    enabled: !!activeChatId,
  });

  useEffect(() => {
    if (chatMessages && !sendingRef.current) {
      setMessages(chatMessages.map((m: AiChatMessage) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        sql: m.sql,
        entities: m.entities as AiEntity[] | null,
        isError: m.isError,
      })));
    }
  }, [chatMessages]);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => aiAssistantApi.renameChat(id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-chats'] });
      setEditingChatId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => aiAssistantApi.deleteChat(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['ai-chats'] });
      if (activeChatId === deletedId) {
        setActiveChatId(null);
        setMessages([]);
      }
    },
  });

  const abortRef = useRef<AbortController | null>(null);

  const handleSend = useCallback(async (text?: string) => {
    const question = (text || input).trim();
    if (!question || loading) return;

    let chatId = activeChatId;

    if (!chatId) {
      try {
        const newChat = await aiAssistantApi.createChat();
        chatId = newChat.id;
        setActiveChatId(chatId);
        queryClient.invalidateQueries({ queryKey: ['ai-chats'] });
      } catch {
        return;
      }
    }

    const tempUserId = `temp-user-${Date.now()}`;
    const tempAsstId = `temp-asst-${Date.now()}`;

    const userMsg: LocalMsg = { id: tempUserId, role: 'user', content: question, isError: false };
    const loadingMsg: LocalMsg = { id: tempAsstId, role: 'assistant', content: '', isError: false, loading: true };

    sendingRef.current = true;
    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput('');
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res: AiAssistantResponse = await aiAssistantApi.ask(chatId, question);
      if (controller.signal.aborted) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAsstId
            ? { ...m, content: res.answer, sql: res.sql, entities: res.entities, loading: false }
            : m,
        ),
      );
      if (res.chatTitle) {
        queryClient.invalidateQueries({ queryKey: ['ai-chats'] });
      }
    } catch (err: any) {
      if (controller.signal.aborted) return;
      const errorMsg = err?.response?.data?.message || err?.message || 'Произошла ошибка';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAsstId
            ? { ...m, content: errorMsg, loading: false, isError: true }
            : m,
        ),
      );
    } finally {
      sendingRef.current = false;
      setLoading(false);
      abortRef.current = null;
      queryClient.invalidateQueries({ queryKey: ['ai-chat-messages', chatId] });
      inputRef.current?.focus();
    }
  }, [input, loading, activeChatId, queryClient]);

  const handleEntityClick = (entity: AiEntity) => {
    switch (entity.type) {
      case 'client': navigate(`/clients/${entity.id}`); break;
      case 'deal': navigate(`/deals/${entity.id}`); break;
      case 'product': navigate(`/inventory/products/${entity.id}`); break;
      case 'user': navigate('/users'); break;
    }
  };

  const supportsVoice = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interim = transcript;
        }
      }
      setInput((prev) => {
        const base = prev.replace(/🎤.*$/, '').trim();
        const combined = (base ? base + ' ' : '') + finalTranscript + interim;
        return combined.trim();
      });
    };

    recognition.onend = () => {
      setIsListening(false);
      setInput((prev) => prev.replace(/🎤.*$/, '').trim());
      inputRef.current?.focus();
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    finalTranscript = '';
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  const handleSelectChat = (chatId: string) => {
    if (chatId === activeChatId) return;
    if (loading) {
      abortRef.current?.abort();
      sendingRef.current = false;
      setLoading(false);
    }
    setActiveChatId(chatId);
    setMessages([]);
    if (isMobile) setSidebarOpen(false);
  };

  const handleNewChat = () => {
    if (loading) {
      abortRef.current?.abort();
      sendingRef.current = false;
      setLoading(false);
    }
    setActiveChatId(null);
    setMessages([]);
    if (isMobile) setSidebarOpen(false);
  };

  const startRename = (chat: AiChat) => {
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const saveRename = () => {
    if (editingChatId && editTitle.trim()) {
      renameMutation.mutate({ id: editingChatId, title: editTitle.trim() });
    }
  };

  const sidebarContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 12px 8px' }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          onClick={handleNewChat}
          style={{ borderRadius: 10 }}
        >
          Новый чат
        </Button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 4px' }}>
        {chatsLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin size="small" /></div>
        ) : chats.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет чатов" style={{ marginTop: 40 }} />
        ) : (
          <List
            dataSource={chats}
            split={false}
            renderItem={(chat: AiChat) => (
              <div
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                style={{
                  padding: '8px 12px',
                  margin: '2px 0',
                  borderRadius: 8,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: chat.id === activeChatId
                    ? (themeToken.colorPrimaryBg)
                    : 'transparent',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (chat.id !== activeChatId) e.currentTarget.style.background = themeToken.colorBgTextHover;
                }}
                onMouseLeave={(e) => {
                  if (chat.id !== activeChatId) e.currentTarget.style.background = 'transparent';
                }}
              >
                <MessageOutlined style={{ fontSize: 14, color: themeToken.colorTextSecondary, flexShrink: 0 }} />
                {editingChatId === chat.id ? (
                  <div style={{ flex: 1, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <Input
                      size="small"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onPressEnter={saveRename}
                      autoFocus
                      style={{ borderRadius: 6 }}
                    />
                    <Button size="small" type="text" icon={<CheckOutlined />} onClick={saveRename} />
                    <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setEditingChatId(null)} />
                  </div>
                ) : (
                  <>
                    <Text
                      ellipsis
                      style={{ flex: 1, fontSize: 13, lineHeight: '20px' }}
                    >
                      {chat.title}
                    </Text>
                    <div
                      className="chat-actions"
                      style={{ display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.2s' }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined style={{ fontSize: 12 }} />}
                        onClick={() => startRename(chat)}
                      />
                      <Popconfirm
                        title="Удалить чат?"
                        onConfirm={() => deleteMutation.mutate(chat.id)}
                        okText="Да"
                        cancelText="Нет"
                      >
                        <Button size="small" type="text" danger icon={<DeleteOutlined style={{ fontSize: 12 }} />} />
                      </Popconfirm>
                    </div>
                  </>
                )}
              </div>
            )}
          />
        )}
      </div>
    </div>
  );

  const chatArea = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${themeToken.colorBorderSecondary}` }}>
        {isMobile && (
          <Button type="text" icon={<MenuOutlined />} onClick={() => setSidebarOpen(true)} />
        )}
        <OpenAiIcon style={{ fontSize: 22, color: themeToken.colorPrimary }} />
        <div style={{ flex: 1 }}>
          <Text strong style={{ fontSize: 16 }}>
            {activeChatId ? chats.find((c: AiChat) => c.id === activeChatId)?.title || 'Чат' : 'AI Ассистент'}
          </Text>
        </div>
        {isAdmin && (
          <Button
            type="text"
            icon={<SettingOutlined />}
            onClick={() => navigate('/ai-assistant/training')}
            title="Обучение AI"
          />
        )}
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} style={{ flex: 1, overflow: 'auto', padding: '20px 24px 32px' }}>
        {!activeChatId && messages.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, paddingBottom: '12%' }}>
            <Empty
              image={<OpenAiIcon style={{ fontSize: 64, color: themeToken.colorTextQuaternary }} />}
              description={<Text type="secondary">Задайте вопрос по данным CRM</Text>}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 600 }}>
              {SUGGESTION_CHIPS.map((chip) => (
                <Tag
                  key={chip}
                  style={{ cursor: 'pointer', padding: '4px 12px', fontSize: 13, borderRadius: 16 }}
                  color="blue"
                  onClick={() => handleSend(chip)}
                >
                  {chip}
                </Tag>
              ))}
            </div>
          </div>
        ) : messagesLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: msg.role === 'user' ? themeToken.colorPrimary : themeToken.colorBgElevated,
                    color: msg.role === 'user' ? '#fff' : themeToken.colorPrimary,
                    border: msg.role === 'assistant' ? `1px solid ${themeToken.colorBorderSecondary}` : 'none',
                  }}
                >
                  {msg.role === 'user' ? <UserOutlined /> : <OpenAiIcon />}
                </div>

                <div
                  style={{
                    maxWidth: '80%', padding: '10px 16px', borderRadius: 12,
                    background: msg.role === 'user'
                      ? themeToken.colorPrimary
                      : msg.isError ? themeToken.colorErrorBg : themeToken.colorBgElevated,
                    color: msg.role === 'user' ? '#fff' : undefined,
                    border: msg.role === 'assistant'
                      ? `1px solid ${msg.isError ? themeToken.colorErrorBorder : themeToken.colorBorderSecondary}`
                      : 'none',
                  }}
                >
                  {msg.loading ? (
                    <Space><Spin size="small" /><Text type="secondary">Анализирую данные...</Text></Space>
                  ) : (
                    <>
                      {msg.role === 'assistant' ? (
                        <div className="ai-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <div style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#fff' }}>
                          {msg.content}
                        </div>
                      )}
                      {msg.entities && msg.entities.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {msg.entities
                            .filter((e) => e.name && e.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(e.name))
                            .map((entity, idx) => (
                            <Tag
                              key={idx}
                              color={ENTITY_COLORS[entity.type] || 'blue'}
                              style={{ cursor: 'pointer', borderRadius: 8 }}
                              onClick={() => handleEntityClick(entity)}
                            >
                              {ENTITY_LABELS[entity.type] || entity.type}: {entity.name}
                            </Tag>
                          ))}
                        </div>
                      )}
                      {msg.sql && (
                        <div style={{ marginTop: 8 }}>
                          <Text
                            type="secondary"
                            style={{ fontSize: 12, cursor: 'pointer' }}
                            onClick={() => setShowSql((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                          >
                            <CodeOutlined /> {showSql[msg.id] ? 'Скрыть SQL' : 'Показать SQL'}
                          </Text>
                          {showSql[msg.id] && (
                            <pre style={{
                              marginTop: 6, padding: 10, borderRadius: 8, fontSize: 12,
                              background: themeToken.colorBgLayout, overflow: 'auto', maxHeight: 200,
                            }}>
                              {msg.sql}
                            </pre>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '16px 24px 20px', borderTop: `1px solid ${themeToken.colorBorderSecondary}`, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <Input.TextArea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Спросите что-нибудь о данных CRM..."
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={loading}
          style={{ borderRadius: 12, fontSize: 14 }}
        />
        {supportsVoice && (
          <Button
            type={isListening ? 'primary' : 'default'}
            danger={isListening}
            icon={<AudioOutlined />}
            onClick={toggleVoice}
            disabled={loading}
            style={{
              borderRadius: 12,
              minWidth: 40,
              minHeight: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              ...(isListening ? { animation: 'pulse-mic 1.5s infinite' } : {}),
            }}
            title={isListening ? 'Остановить запись' : 'Голосовой ввод'}
          />
        )}
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={() => { if (isListening) { recognitionRef.current?.stop(); setIsListening(false); } handleSend(); }}
          loading={loading}
          style={{ borderRadius: 12, minWidth: 40, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        />
      </div>
    </div>
  );

  return (
    <div style={{
      height: isMobile ? 'calc(100vh - 56px)' : 'calc(100vh - 56px)',
      margin: isMobile ? 0 : -24,
      display: 'flex',
      overflow: 'hidden',
    }}>
      {/* Sidebar - desktop */}
      {!isMobile && (
        <div
          style={{
            width: SIDEBAR_WIDTH, flexShrink: 0,
            borderRight: `1px solid ${themeToken.colorBorderSecondary}`,
            background: themeToken.colorBgContainer,
            display: 'flex', flexDirection: 'column',
          }}
        >
          {sidebarContent}
        </div>
      )}

      {/* Sidebar - mobile drawer */}
      {isMobile && (
        <Drawer
          placement="left"
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          width={SIDEBAR_WIDTH}
          styles={{ body: { padding: 0 } }}
          title="Чаты"
        >
          {sidebarContent}
        </Drawer>
      )}

      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {chatArea}
      </div>

      <style>{`
        .chat-actions { opacity: 0 !important; }
        *:hover > .chat-actions { opacity: 1 !important; }

        @keyframes pulse-mic {
          0% { box-shadow: 0 0 0 0 rgba(255, 77, 79, 0.5); }
          70% { box-shadow: 0 0 0 10px rgba(255, 77, 79, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 77, 79, 0); }
        }

        .ai-markdown {
          font-size: 14px; line-height: 1.7;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
        }
        .ai-markdown p { margin: 0 0 8px 0; }
        .ai-markdown p:last-child { margin-bottom: 0; }
        .ai-markdown h3 { font-size: 15px; font-weight: 600; margin: 14px 0 6px 0; }
        .ai-markdown h4 { font-size: 14px; font-weight: 600; margin: 10px 0 4px 0; }
        .ai-markdown ul, .ai-markdown ol { margin: 4px 0 8px 0; padding-left: 20px; }
        .ai-markdown li { margin-bottom: 2px; }
        .ai-markdown strong { font-weight: 600; }
        .ai-markdown hr { border: none; border-top: 1px solid rgba(0,0,0,0.06); margin: 12px 0; }
        .ai-markdown table {
          width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 13px;
          border-radius: 8px; overflow: hidden;
        }
        .ai-markdown th, .ai-markdown td {
          border: 1px solid rgba(0,0,0,0.08); padding: 8px 12px; text-align: left;
        }
        .ai-markdown th {
          background: rgba(0,0,0,0.04); font-weight: 600; font-size: 12px; text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .ai-markdown tr:nth-child(even) {
          background: rgba(0,0,0,0.015);
        }
        .ai-markdown td:last-child, .ai-markdown th:last-child {
          text-align: right;
        }
        .ai-markdown td:first-child, .ai-markdown th:first-child {
          text-align: left;
        }
        .ai-markdown code {
          background: rgba(0,0,0,0.04); padding: 1px 4px; border-radius: 3px; font-size: 12px;
        }
        .ai-markdown pre {
          background: rgba(0,0,0,0.04); padding: 10px; border-radius: 8px;
          overflow-x: auto; font-size: 12px; margin: 8px 0;
        }
        .ai-markdown blockquote {
          border-left: 3px solid rgba(0,0,0,0.15); margin: 8px 0; padding: 4px 12px;
          color: rgba(0,0,0,0.6);
        }
      `}</style>
    </div>
  );
}
