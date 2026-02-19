import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography, Input, Button, Badge, Spin, Empty, theme, Dropdown, Modal, Tag,
} from 'antd';
import {
  SendOutlined, PaperClipOutlined, CloseOutlined, CheckOutlined, MoreOutlined,
} from '@ant-design/icons';
import { conversationsApi } from '../api/conversations.api';
import { API_URL } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { ConversationType, Conversation, ChatMessage, MessageAttachmentInfo } from '../types';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';

dayjs.locale('ru');

const CONVERSATION_LABELS: Record<ConversationType, string> = {
  SALES: 'Продажи',
  WAREHOUSE: 'Склад',
  ACCOUNTING: 'Бухгалтерия',
  SHIPMENT: 'Отгрузка',
};

const EDIT_WINDOW_MS = 10 * 60 * 1000;

function getDateLabel(dateStr: string): string {
  const d = dayjs(dateStr);
  const today = dayjs().startOf('day');
  const yesterday = today.subtract(1, 'day');
  if (d.isSame(today, 'day')) return 'Сегодня';
  if (d.isSame(yesterday, 'day')) return 'Вчера';
  return d.format('D MMMM YYYY');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export default function MessagesPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [activeType, setActiveType] = useState<ConversationType | null>(null);
  const [text, setText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { token: tk } = theme.useToken();

  // ── Queries ──
  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: conversationsApi.getConversations,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!activeType && conversations && conversations.length > 0) {
      setActiveType(conversations[0].type);
    }
  }, [activeType, conversations]);

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', activeType],
    queryFn: () => conversationsApi.getMessages(activeType!, undefined, 100),
    enabled: !!activeType && !searchQuery,
    refetchInterval: 3_000,
  });

  const { data: onlineUsers } = useQuery({
    queryKey: ['online-users'],
    queryFn: conversationsApi.getOnlineUsers,
    refetchInterval: 30_000,
  });

  const { data: readStatus } = useQuery({
    queryKey: ['read-status', activeType],
    queryFn: () => conversationsApi.getReadStatus(activeType!),
    enabled: !!activeType,
    refetchInterval: 5_000,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['search-messages', searchQuery],
    queryFn: () => conversationsApi.searchMessages(searchQuery),
    enabled: searchQuery.length >= 2,
  });

  // ── Mutations ──
  const sendMut = useMutation({
    mutationFn: (params: { text: string; replyToId?: string; files?: File[] }) =>
      conversationsApi.sendMessage(activeType!, { text: params.text, replyToId: params.replyToId }, params.files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', activeType] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setText('');
      setReplyingTo(null);
      setSelectedFiles([]);
    },
  });

  const editMut = useMutation({
    mutationFn: (params: { messageId: string; text: string }) =>
      conversationsApi.editMessage(params.messageId, params.text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', activeType] });
      setEditingMessage(null);
      setText('');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (messageId: string) => conversationsApi.deleteMessage(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', activeType] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const markReadMut = useMutation({
    mutationFn: (type: ConversationType) => conversationsApi.markRead(type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  useEffect(() => {
    if (activeType) markReadMut.mutate(activeType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messagesData, scrollToBottom]);

  // Presence ping
  useEffect(() => {
    conversationsApi.ping();
    const interval = setInterval(() => conversationsApi.ping(), 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── Derived ──
  const messages = messagesData?.messages ?? [];
  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const onlineSet = new Set((onlineUsers ?? []).map((u) => u.id));
  const latestRead = readStatus?.latestReadAt ? new Date(readStatus.latestReadAt).getTime() : 0;

  // ── Handlers ──
  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !activeType) return;
    if (editingMessage) {
      editMut.mutate({ messageId: editingMessage.id, text: trimmed });
    } else {
      sendMut.mutate({ text: trimmed, replyToId: replyingTo?.id, files: selectedFiles.length > 0 ? selectedFiles : undefined });
    }
  };

  const startEdit = (msg: ChatMessage) => {
    setEditingMessage(msg);
    setReplyingTo(null);
    setText(msg.text);
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setText('');
  };

  const startReply = (msg: ChatMessage) => {
    setReplyingTo(msg);
    setEditingMessage(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
    setSelectedFiles((prev) => [...prev, ...files].slice(0, 5));
    e.target.value = '';
  };

  const removeFile = (idx: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSearchSelect = (msg: ChatMessage) => {
    setSearchQuery('');
    setActiveType(msg.conversationType);
  };

  const canEditOrDelete = (msg: ChatMessage) =>
    msg.senderId === user?.id && !msg.isDeleted && (Date.now() - new Date(msg.createdAt).getTime()) < EDIT_WINDOW_MS;

  // ── Date-grouped messages ──
  const dateGroups: { date: string; label: string; msgs: ChatMessage[] }[] = [];
  for (const msg of sorted) {
    const dateKey = dayjs(msg.createdAt).format('YYYY-MM-DD');
    const last = dateGroups[dateGroups.length - 1];
    if (last && last.date === dateKey) {
      last.msgs.push(msg);
    } else {
      dateGroups.push({ date: dateKey, label: getDateLabel(msg.createdAt), msgs: [msg] });
    }
  }

  // ── Attachment renderer ──
  function renderAttachments(attachments: MessageAttachmentInfo[], isOwn: boolean) {
    return (
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {attachments.map((att) => {
          const url = `${API_URL}/conversations/attachments/${att.id}`;
          if (isImageMime(att.mimeType)) {
            return (
              <a key={att.id} href={url} target="_blank" rel="noopener noreferrer">
                <img
                  src={url}
                  alt={att.filename}
                  style={{ maxWidth: 200, maxHeight: 200, borderRadius: 6, display: 'block' }}
                />
              </a>
            );
          }
          return (
            <a
              key={att.id}
              href={url}
              download={att.filename}
              style={{ color: isOwn ? '#fff' : tk.colorPrimary, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <PaperClipOutlined /> {att.filename} ({formatFileSize(att.size)})
            </a>
          );
        })}
      </div>
    );
  }

  // ── Message bubble ──
  function renderMessage(msg: ChatMessage) {
    const isOwn = msg.senderId === user?.id;
    const showActions = canEditOrDelete(msg);
    const msgTime = new Date(msg.createdAt).getTime();
    const isRead = isOwn && latestRead > 0 && msgTime <= latestRead;

    const actionItems = [];
    actionItems.push({ key: 'reply', label: 'Ответить' });
    if (showActions) {
      actionItems.push({ key: 'edit', label: 'Редактировать' });
      actionItems.push({ key: 'delete', label: 'Удалить', danger: true });
    }

    return (
      <div
        key={msg.id}
        style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start', position: 'relative' }}
      >
        <div style={{ maxWidth: '65%', position: 'relative' }}>
          {/* Action dropdown */}
          <div style={{ position: 'absolute', top: 2, ...(isOwn ? { left: -28 } : { right: -28 }) }}>
            <Dropdown
              menu={{
                items: actionItems,
                onClick: ({ key }) => {
                  if (key === 'reply') startReply(msg);
                  else if (key === 'edit') startEdit(msg);
                  else if (key === 'delete') {
                    Modal.confirm({
                      title: 'Удалить сообщение?',
                      okText: 'Да',
                      cancelText: 'Нет',
                      onOk: () => deleteMut.mutate(msg.id),
                    });
                  }
                },
              }}
              trigger={['click']}
            >
              <Button type="text" size="small" icon={<MoreOutlined />} style={{ opacity: 0.4 }} />
            </Dropdown>
          </div>

          <div
            style={{
              padding: '8px 12px',
              borderRadius: isOwn ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: isOwn ? tk.colorPrimary : tk.colorFillSecondary,
              color: isOwn ? '#fff' : tk.colorText,
            }}
          >
            {/* Sender name */}
            {!isOwn && !msg.isDeleted && (
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2, opacity: 0.8 }}>
                {msg.sender?.fullName}
                {onlineSet.has(msg.senderId) && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}
              </div>
            )}

            {/* Reply quote */}
            {msg.replyTo && !msg.isDeleted && (
              <div
                style={{
                  borderLeft: `2px solid ${isOwn ? 'rgba(255,255,255,0.6)' : tk.colorPrimary}`,
                  padding: '2px 8px',
                  marginBottom: 4,
                  fontSize: 12,
                  opacity: 0.8,
                  borderRadius: 2,
                  background: isOwn ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ fontWeight: 600 }}>{msg.replyTo.sender?.fullName}</div>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                  {msg.replyTo.isDeleted ? 'Сообщение удалено' : msg.replyTo.text}
                </div>
              </div>
            )}

            {/* Message body */}
            {msg.isDeleted ? (
              <div style={{ fontStyle: 'italic', opacity: 0.6 }}>Сообщение удалено</div>
            ) : (
              <div style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{msg.text}</div>
            )}

            {/* Attachments */}
            {!msg.isDeleted && msg.attachments && msg.attachments.length > 0 && renderAttachments(msg.attachments, isOwn)}

            {/* Deal link */}
            {!msg.isDeleted && msg.deal && (
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
                <Link
                  to={`/deals/${msg.deal.id}`}
                  style={{ color: isOwn ? '#fff' : tk.colorPrimary, textDecoration: 'underline' }}
                >
                  {msg.deal.title}
                </Link>
              </div>
            )}

            {/* Footer: time + edited + read status */}
            <div style={{ fontSize: 10, textAlign: 'right', marginTop: 4, opacity: 0.6, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
              {msg.editedAt && <span>(ред.)</span>}
              <span>{dayjs(msg.createdAt).format('HH:mm')}</span>
              {isOwn && !msg.isDeleted && (
                <span style={{ display: 'inline-flex', marginLeft: 2 }}>
                  <CheckOutlined style={{ fontSize: 10, color: isRead ? '#52c41a' : 'inherit' }} />
                  {isRead && <CheckOutlined style={{ fontSize: 10, marginLeft: -4, color: '#52c41a' }} />}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ──
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 130px)', gap: 0 }}>
      {/* Left Panel */}
      <div
        style={{
          width: 280, minWidth: 280,
          borderRight: `1px solid ${tk.colorBorderSecondary}`,
          display: 'flex', flexDirection: 'column',
          background: tk.colorBgContainer,
          borderRadius: '8px 0 0 8px',
        }}
      >
        <div style={{ padding: 12, borderBottom: `1px solid ${tk.colorBorderSecondary}` }}>
          <Typography.Title level={5} style={{ margin: '0 0 8px' }}>Сообщения</Typography.Title>
          <Input.Search
            placeholder="Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            allowClear
            size="small"
          />
          {onlineUsers && (
            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
              Онлайн: {onlineUsers.length}
            </Typography.Text>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {(conversations ?? []).map((conv: Conversation) => (
            <div
              key={conv.type}
              onClick={() => { setActiveType(conv.type); setSearchQuery(''); }}
              style={{
                padding: '12px 16px', cursor: 'pointer',
                borderBottom: `1px solid ${tk.colorBorderSecondary}`,
                background: activeType === conv.type ? tk.colorPrimaryBg : 'transparent',
                transition: 'background 0.2s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography.Text strong>{CONVERSATION_LABELS[conv.type] || conv.label}</Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {conv.lastMessage && (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {dayjs(conv.lastMessage.createdAt).format('HH:mm')}
                    </Typography.Text>
                  )}
                  {conv.unreadCount > 0 && <Badge count={conv.unreadCount} size="small" />}
                </div>
              </div>
              {conv.lastMessage && (
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, display: 'block', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {conv.lastMessage.isDeleted
                    ? 'Сообщение удалено'
                    : `${conv.lastMessage.sender?.fullName}: ${conv.lastMessage.text}`}
                </Typography.Text>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel */}
      <div
        style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          background: tk.colorBgContainer, borderRadius: '0 8px 8px 0',
        }}
      >
        {/* Header */}
        {activeType && (
          <div
            style={{
              padding: '12px 20px',
              borderBottom: `1px solid ${tk.colorBorderSecondary}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <Typography.Text strong style={{ fontSize: 16 }}>{CONVERSATION_LABELS[activeType]}</Typography.Text>
            {onlineUsers && onlineUsers.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {onlineUsers.map((u) => u.fullName).slice(0, 5).join(', ')}
                {onlineUsers.length > 5 && ` +${onlineUsers.length - 5}`}
              </Typography.Text>
            )}
          </div>
        )}

        {/* Messages / Search Area */}
        <div
          style={{
            flex: 1, overflow: 'auto', padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}
        >
          {/* Search results mode */}
          {searchQuery.length >= 2 ? (
            searchResults && searchResults.length > 0 ? (
              searchResults.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => handleSearchSelect(msg)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer', borderRadius: 8,
                    background: tk.colorFillSecondary, marginBottom: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Typography.Text strong style={{ fontSize: 12 }}>{msg.sender?.fullName}</Typography.Text>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Tag style={{ fontSize: 10, margin: 0 }}>{CONVERSATION_LABELS[msg.conversationType]}</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{dayjs(msg.createdAt).format('DD.MM HH:mm')}</Typography.Text>
                    </div>
                  </div>
                  <Typography.Text style={{ fontSize: 13 }}>{msg.text}</Typography.Text>
                </div>
              ))
            ) : (
              <Empty description="Ничего не найдено" style={{ margin: 'auto' }} />
            )
          ) : (
            <>
              {!activeType && <Empty description="Выберите чат" style={{ margin: 'auto' }} />}
              {activeType && messagesLoading && <Spin style={{ margin: 'auto' }} />}
              {activeType && !messagesLoading && sorted.length === 0 && <Empty description="Нет сообщений" style={{ margin: 'auto' }} />}

              {dateGroups.map((group) => (
                <div key={group.date}>
                  {/* Date separator */}
                  <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0', gap: 12 }}>
                    <div style={{ flex: 1, height: 1, background: tk.colorBorderSecondary }} />
                    <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{group.label}</Typography.Text>
                    <div style={{ flex: 1, height: 1, background: tk.colorBorderSecondary }} />
                  </div>
                  {group.msgs.map(renderMessage)}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input area */}
        {activeType && !searchQuery && (
          <div style={{ borderTop: `1px solid ${tk.colorBorderSecondary}` }}>
            {/* Reply preview */}
            {replyingTo && (
              <div
                style={{
                  padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 8,
                  borderLeft: `3px solid ${tk.colorPrimary}`, margin: '0 12px',
                  background: tk.colorFillSecondary, borderRadius: '0 4px 4px 0',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: tk.colorPrimary }}>{replyingTo.sender?.fullName}</div>
                  <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replyingTo.text}</div>
                </div>
                <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setReplyingTo(null)} />
              </div>
            )}

            {/* Edit preview */}
            {editingMessage && (
              <div
                style={{
                  padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 8,
                  background: tk.colorWarningBg || '#fff8e1', margin: '0 12px', borderRadius: 4,
                }}
              >
                <div style={{ flex: 1, fontSize: 12 }}>
                  <Typography.Text strong>Редактирование</Typography.Text>
                </div>
                <Button type="text" size="small" icon={<CloseOutlined />} onClick={cancelEdit} />
              </div>
            )}

            {/* Selected files */}
            {selectedFiles.length > 0 && (
              <div style={{ padding: '4px 20px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {selectedFiles.map((f, i) => (
                  <Tag key={i} closable onClose={() => removeFile(i)} style={{ fontSize: 11 }}>
                    {f.name} ({formatFileSize(f.size)})
                  </Tag>
                ))}
              </div>
            )}

            <div style={{ padding: '12px 20px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              {!editingMessage && (
                <>
                  <Button
                    type="text"
                    icon={<PaperClipOutlined />}
                    onClick={() => fileInputRef.current?.click()}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                  />
                </>
              )}
              <Input.TextArea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPressEnter={(e) => {
                  if (!e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder="Написать сообщение..."
                autoSize={{ minRows: 1, maxRows: 4 }}
                style={{ flex: 1 }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={sendMut.isPending || editMut.isPending}
                onClick={handleSend}
                disabled={!text.trim()}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
