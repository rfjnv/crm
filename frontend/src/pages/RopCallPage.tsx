import { useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { Alert, Button, Typography, theme } from 'antd';
import { AudioMutedOutlined, AudioOutlined, PhoneOutlined } from '@ant-design/icons';
import { ropAgentApi, type RopCallSession } from '../api/ropAgent.api';
import { getTelegramInitData, initTelegramWebApp } from '../lib/telegramWebApp';
import { useAuthStore } from '../store/authStore';

const { Text, Title } = Typography;

type Line = { id: number; who: 'user' | 'agent'; text: string };

const errText = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message
  || (err as Error)?.message || 'Не удалось начать звонок';

/**
 * Звонок РОП-агенту голосом: открывается мини-приложением из бота (initData) или из CRM.
 * Разговор идёт через ElevenLabs Agents (WebRTC), данные CRM агент берёт сам.
 */
function CallScreen() {
  const { token } = theme.useToken();
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [userName, setUserName] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const initData = getTelegramInitData();
  const loggedIn = !!useAuthStore((s) => s.user);

  const conversation = useConversation({
    onMessage: (m) => {
      const who = m.source === 'user' ? 'user' : 'agent';
      setLines((prev) => [...prev.slice(-40), { id: m.event_id ?? Date.now(), who, text: m.message }]);
    },
    onError: (message) => setError(String(message)),
  });
  const { status, isSpeaking, isMuted } = conversation;
  const connected = status === 'connected';

  useEffect(() => { initTelegramWebApp(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines.length]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      // Сначала микрофон: без него звонок всё равно не пойдёт, а запрос понятнее до соединения.
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const s: RopCallSession = initData ? await ropAgentApi.callSessionTelegram(initData) : await ropAgentApi.callSession();
      setUserName(s.userName);
      setLines([]);
      conversation.startSession({ conversationToken: s.conversationToken, connectionType: 'webrtc', dynamicVariables: s.dynamicVariables });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      setError(name === 'NotAllowedError' ? 'Нет доступа к микрофону — разрешите его в настройках Telegram или браузера.' : errText(err));
    } finally {
      setStarting(false);
    }
  };

  if (!initData && !loggedIn) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="info" showIcon message="Откройте звонок из бота РОП-агента в Telegram (кнопка «📞 Позвонить») или войдите в CRM." />
      </div>
    );
  }

  const statusText = connected
    ? (isSpeaking ? 'Агент говорит…' : isMuted ? 'Микрофон выключен' : 'Слушаю вас…')
    : status === 'connecting' || starting ? 'Соединяю…' : 'Готов к звонку';

  return (
    <div style={{
      minHeight: 'var(--app-vh, 100vh)', display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '24px 16px', background: token.colorBgLayout, boxSizing: 'border-box',
    }}>
      <Title level={4} style={{ margin: 0 }}>РОП-агент</Title>
      <Text type="secondary" style={{ textAlign: 'center', marginTop: 4 }}>
        Говорите по-русски или по-узбекски — агент ответит на том же языке.
      </Text>

      <div style={{
        marginTop: 32, width: 140, height: 140, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: connected ? token.colorSuccessBg : token.colorFillSecondary,
        border: `3px solid ${connected ? (isSpeaking ? token.colorPrimary : token.colorSuccess) : token.colorBorder}`,
        transition: 'transform .3s, border-color .3s',
        transform: isSpeaking ? 'scale(1.06)' : 'scale(1)',
        fontSize: 52, color: connected ? token.colorSuccess : token.colorTextSecondary,
      }}>
        <PhoneOutlined />
      </div>
      <Text strong style={{ marginTop: 16 }}>{statusText}</Text>
      {connected && userName && <Text type="secondary" style={{ fontSize: 12 }}>{userName}</Text>}

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        {connected ? (
          <>
            <Button size="large" shape="circle" icon={isMuted ? <AudioMutedOutlined /> : <AudioOutlined />}
              onClick={() => conversation.setMuted(!isMuted)} aria-label={isMuted ? 'Включить микрофон' : 'Выключить микрофон'} />
            <Button size="large" danger type="primary" icon={<PhoneOutlined rotate={135} />} onClick={() => conversation.endSession()}>
              Завершить
            </Button>
          </>
        ) : (
          <Button size="large" type="primary" icon={<PhoneOutlined />} loading={starting || status === 'connecting'} onClick={start}>
            Позвонить
          </Button>
        )}
      </div>

      {error && <Alert style={{ marginTop: 16, maxWidth: 520, width: '100%' }} type="error" showIcon message={error} />}

      {lines.length > 0 && (
        <div style={{
          marginTop: 24, width: '100%', maxWidth: 560, flex: 1, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {lines.map((l) => (
            <div key={l.id} style={{
              alignSelf: l.who === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%',
              padding: '8px 12px', borderRadius: 12,
              background: l.who === 'user' ? token.colorPrimary : token.colorBgContainer,
              color: l.who === 'user' ? '#fff' : token.colorText,
              border: l.who === 'user' ? 'none' : `1px solid ${token.colorBorderSecondary}`,
              whiteSpace: 'pre-wrap',
            }}>
              {l.text}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

export default function RopCallPage() {
  return (
    <ConversationProvider>
      <CallScreen />
    </ConversationProvider>
  );
}
