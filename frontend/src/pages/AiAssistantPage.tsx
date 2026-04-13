import { useState, useRef, useEffect } from 'react';
import { Card, Input, Button, Typography, Tag, Space, Spin, Empty, theme } from 'antd';
import { SendOutlined, RobotOutlined, UserOutlined, CodeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { aiAssistantApi, type AiAssistantResponse, type AiEntity } from '../api/ai-assistant.api';

const { Text, Paragraph } = Typography;

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
  'Сколько выручка за этот месяц?',
];

export default function AiAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  const handleSend = async (text?: string) => {
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
  };

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
    }
  };

  const toggleSql = (msgId: number) => {
    setShowSql((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <RobotOutlined style={{ fontSize: 28, color: themeToken.colorPrimary }} />
        <div>
          <Text strong style={{ fontSize: 20 }}>AI Ассистент</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 13 }}>Задавайте вопросы по данным CRM на естественном языке</Text>
        </div>
      </div>

      <Card
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        styles={{ body: { flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column' } }}
      >
        {messages.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <Empty
              image={<RobotOutlined style={{ fontSize: 64, color: themeToken.colorTextQuaternary }} />}
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
                  {msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
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
                              color="blue"
                              style={{ cursor: 'pointer', borderRadius: 8 }}
                              onClick={() => handleEntityClick(entity)}
                            >
                              {entity.type === 'client' ? 'Клиент' : entity.type === 'deal' ? 'Сделка' : 'Товар'}: {entity.name}
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
