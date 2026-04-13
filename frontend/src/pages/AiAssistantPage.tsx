import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, Input, Button, Typography, Tag, Space, Spin, Empty, theme, Tooltip } from 'antd';
import { SendOutlined, RobotOutlined, UserOutlined, CodeOutlined, DeleteOutlined } from '@ant-design/icons';
import Icon from '@ant-design/icons';

const OpenAiSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
);
const OpenAiIcon = (props: any) => <Icon component={OpenAiSvg} {...props} />;
import { useNavigate } from 'react-router-dom';
import { aiAssistantApi, type AiAssistantResponse, type AiEntity } from '../api/ai-assistant.api';

const { Text, Paragraph } = Typography;

const STORAGE_KEY = 'ai-assistant-history';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  entities?: AiEntity[];
  loading?: boolean;
  error?: boolean;
}

const SUGGESTION_CHIPS = [
  'У кого самая большая задолженность?',
  'Сколько всего клиентов?',
  'Топ 5 клиентов по сумме сделок',
  'Какие сделки были за последнюю неделю?',
  'Какие товары заканчиваются на складе?',
  'Какие пользователи есть у нас?',
];

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return parsed.filter((m) => !m.loading);
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]) {
  try {
    const toSave = messages.filter((m) => !m.loading);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded — ignore */ }
}

const ENTITY_LABELS: Record<string, string> = {
  client: 'Клиент',
  deal: 'Сделка',
  product: 'Товар',
  user: 'Пользователь',
};

const ENTITY_COLORS: Record<string, string> = {
  client: 'blue',
  deal: 'green',
  product: 'orange',
  user: 'purple',
};

export default function AiAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSql, setShowSql] = useState<Record<number, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const navigate = useNavigate();
  const { token: themeToken } = theme.useToken();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  const handleSend = useCallback(async (text?: string) => {
    const question = (text || input).trim();
    if (!question || loading) return;

    const userMsg: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: question,
    };

    const assistantMsg: ChatMessage = {
      id: Date.now() + 1,
      role: 'assistant',
      content: '',
      loading: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);

    try {
      const res: AiAssistantResponse = await aiAssistantApi.ask(question);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: res.answer, sql: res.sql, entities: res.entities, loading: false }
            : m,
        ),
      );
    } catch (err: any) {
      const errorMsg = err?.response?.data?.message || err?.message || 'Произошла ошибка';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: errorMsg, loading: false, error: true }
            : m,
        ),
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading]);

  const handleEntityClick = (entity: AiEntity) => {
    switch (entity.type) {
      case 'client':
        navigate(`/clients/${entity.id}`);
        break;
      case 'deal':
        navigate(`/deals/${entity.id}`);
        break;
      case 'product':
        navigate(`/inventory/products/${entity.id}`);
        break;
      case 'user':
        navigate(`/users`);
        break;
    }
  };

  const handleClearHistory = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const toggleSql = (msgId: number) => {
    setShowSql((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <OpenAiIcon style={{ fontSize: 28, color: themeToken.colorPrimary }} />
        <div style={{ flex: 1 }}>
          <Text strong style={{ fontSize: 20 }}>AI Ассистент</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 13 }}>Задавайте вопросы по данным CRM на естественном языке</Text>
        </div>
        {messages.length > 0 && (
          <Tooltip title="Очистить историю">
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
              onClick={handleClearHistory}
            />
          </Tooltip>
        )}
      </div>

      <Card
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        styles={{ body: { flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column' } }}
      >
        {messages.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
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
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    background: msg.role === 'user' ? themeToken.colorPrimary : themeToken.colorBgElevated,
                    color: msg.role === 'user' ? '#fff' : themeToken.colorPrimary,
                    border: msg.role === 'assistant' ? `1px solid ${themeToken.colorBorderSecondary}` : 'none',
                  }}
                >
                  {msg.role === 'user' ? <UserOutlined /> : <OpenAiIcon />}
                </div>

                <div
                  style={{
                    maxWidth: '80%',
                    padding: '10px 16px',
                    borderRadius: 12,
                    background: msg.role === 'user'
                      ? themeToken.colorPrimary
                      : msg.error
                        ? themeToken.colorErrorBg
                        : themeToken.colorBgElevated,
                    color: msg.role === 'user' ? '#fff' : undefined,
                    border: msg.role === 'assistant' ? `1px solid ${msg.error ? themeToken.colorErrorBorder : themeToken.colorBorderSecondary}` : 'none',
                  }}
                >
                  {msg.loading ? (
                    <Space>
                      <Spin size="small" />
                      <Text type="secondary">Анализирую данные...</Text>
                    </Space>
                  ) : (
                    <>
                      <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', color: msg.role === 'user' ? '#fff' : undefined }}>
                        {msg.content}
                      </Paragraph>

                      {msg.entities && msg.entities.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {msg.entities.map((entity, idx) => (
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
                            onClick={() => toggleSql(msg.id)}
                          >
                            <CodeOutlined /> {showSql[msg.id] ? 'Скрыть SQL' : 'Показать SQL'}
                          </Text>
                          {showSql[msg.id] && (
                            <pre
                              style={{
                                marginTop: 6,
                                padding: 10,
                                borderRadius: 8,
                                fontSize: 12,
                                background: themeToken.colorBgLayout,
                                overflow: 'auto',
                                maxHeight: 200,
                              }}
                            >
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
            <div ref={bottomRef} />
          </div>
        )}
      </Card>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <Input.TextArea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Спросите что-нибудь о данных CRM..."
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={loading}
          style={{ borderRadius: 12 }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={() => handleSend()}
          loading={loading}
          style={{ height: 'auto', borderRadius: 12, minWidth: 48 }}
        />
      </div>
    </div>
  );
}
