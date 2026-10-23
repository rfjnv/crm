import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Table, Tag, Tooltip, Button, Modal, Input, Space, Typography, message } from 'antd';
import { PhoneOutlined, CheckOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { clientsApi } from '../api/clients.api';
import type { HistoryCohortClient } from '../types';
import { getFirstName } from '../lib/name-utils';

/** Связывались не раньше стольких дней назад — считаем, что клиента уже обзвонили. */
const RECENT_CONTACT_DAYS = 14;

const CALL_RESULTS = [
  'Не дозвонился',
  'Перезвонить позже',
  'Обещал заказать',
  'Пока не нужно',
  'Ушёл к конкуренту',
  'Недоволен ценой',
  'Недоволен качеством',
];

const MONTH_LABELS: Record<number, string> = {
  1: 'Янв', 2: 'Фев', 3: 'Мар', 4: 'Апр', 5: 'Май', 6: 'Июн',
  7: 'Июл', 8: 'Авг', 9: 'Сен', 10: 'Окт', 11: 'Ноя', 12: 'Дек',
};

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

function daysAgo(iso: string): number {
  return dayjs().startOf('day').diff(dayjs(iso).startOf('day'), 'day');
}

function agoLabel(days: number): string {
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days} дн. назад`;
}

/** Последний контакт — свежее из заметки и звонка. */
function lastContact(c: HistoryCohortClient): { at: string; by: string | null; text: string } | null {
  const noteAt = c.lastNoteAt ? Date.parse(c.lastNoteAt) : 0;
  const callAt = c.lastCallAt ? Date.parse(c.lastCallAt) : 0;
  if (!noteAt && !callAt) return null;
  if (callAt > noteAt) {
    const dir = c.lastCallDirection === 'INBOUND' ? 'Входящий звонок' : 'Звонок';
    return { at: c.lastCallAt!, by: c.lastCallBy ?? null, text: c.lastCallAnswered ? dir : `${dir} — не дозвонились` };
  }
  return { at: c.lastNoteAt!, by: c.lastNoteBy ?? null, text: c.lastNote || 'Заметка' };
}

/**
 * Список клиентов из ячейки когорты: с телефоном, чтобы сразу позвонить, и меткой,
 * связывался ли кто-то с клиентом. «Отметить звонок» пишет заметку в карточку клиента —
 * она же видна в «Последнем контакте» матрицы активности и в реанимации.
 */
export default function CohortClientsList({ clients, lost, queryKey }: {
  clients: HistoryCohortClient[];
  lost: boolean;
  queryKey: unknown[];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [callTarget, setCallTarget] = useState<HistoryCohortClient | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const closeModal = () => {
    setCallTarget(null);
    setResult(null);
    setComment('');
  };

  const noteMut = useMutation({
    mutationFn: ({ clientId, content }: { clientId: string; content: string }) => clientsApi.notes.create(clientId, { content }),
    onSuccess: (_, { clientId }) => {
      message.success('Звонок отмечен в карточке клиента');
      closeModal();
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['client-notes', clientId] });
    },
    onError: () => message.error('Не удалось сохранить отметку'),
  });

  const saveCall = () => {
    if (!callTarget) return;
    const parts = [result, comment.trim()].filter(Boolean);
    noteMut.mutate({ clientId: callTarget.clientId, content: `Звонок: ${parts.join(' — ') || 'связался с клиентом'}` });
  };

  const openClient = (clientId: string) =>
    navigate(`/clients/${clientId}`, { state: { from: `${location.pathname}${location.search}` } });

  return (
    <>
      <Table
        dataSource={clients}
        rowKey="clientId"
        size="small"
        pagination={false}
        scroll={{ x: 1100 }}
        columns={[
          { title: '#', key: 'idx', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
          {
            title: 'Компания', dataIndex: 'companyName', key: 'companyName', width: 220,
            render: (v: string, r) => (
              <Space direction="vertical" size={0}>
                <a onClick={() => openClient(r.clientId)}>{v}</a>
                {r.managerName && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.managerName}</Typography.Text>}
              </Space>
            ),
          },
          {
            title: 'Контакт', key: 'contact', width: 190,
            render: (_: unknown, r) => (
              <Space direction="vertical" size={0}>
                {r.contactName && <span>{r.contactName}</span>}
                {r.phone
                  ? <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}><PhoneOutlined /> {r.phone}</a>
                  : <Typography.Text type="secondary">нет телефона</Typography.Text>}
              </Space>
            ),
          },
          {
            title: 'Последняя покупка', key: 'lastPurchase', width: 140,
            sorter: (a, b) => (a.lastPurchaseAt ?? '').localeCompare(b.lastPurchaseAt ?? ''),
            render: (_: unknown, r) => {
              if (!r.lastPurchaseAt) return lost && r.lastMonth ? MONTH_LABELS[r.lastMonth] : '—';
              return (
                <Space direction="vertical" size={0}>
                  <span>{dayjs(r.lastPurchaseAt).format('DD.MM.YYYY')}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{agoLabel(daysAgo(r.lastPurchaseAt))}</Typography.Text>
                </Space>
              );
            },
          },
          {
            title: 'Последний контакт', key: 'lastContact', width: 260,
            sorter: (a, b) => (lastContact(a)?.at ?? '').localeCompare(lastContact(b)?.at ?? ''),
            render: (_: unknown, r) => {
              const lc = lastContact(r);
              if (!lc) return <Tag color="orange">Не связывались</Tag>;
              const days = daysAgo(lc.at);
              const recent = days <= RECENT_CONTACT_DAYS;
              return (
                <Tooltip title={`${dayjs(lc.at).format('DD.MM.YYYY HH:mm')}${lc.by ? ` — ${lc.by}` : ''}: ${lc.text}`}>
                  <Space direction="vertical" size={0}>
                    <Tag color={recent ? 'green' : 'default'}>
                      {recent ? 'Связались' : 'Давно'} {agoLabel(days)}{lc.by ? ` · ${getFirstName(lc.by)}` : ''}
                    </Tag>
                    <Typography.Text type="secondary" ellipsis style={{ fontSize: 12, maxWidth: 240 }}>{lc.text}</Typography.Text>
                  </Space>
                </Tooltip>
              );
            },
          },
          { title: lost ? 'Сделок за год' : 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 90 },
          {
            title: lost ? 'Выручка за год' : 'Выручка', dataIndex: 'revenue', key: 'revenue', width: 130,
            render: (v: number) => fmtNum(v),
          },
          {
            title: '', key: 'call', width: 150, fixed: 'right' as const,
            render: (_: unknown, r) => (
              <Button size="small" icon={<CheckOutlined />} onClick={() => setCallTarget(r)}>Отметить звонок</Button>
            ),
          },
        ]}
      />

      <Modal
        title={callTarget ? `Звонок: ${callTarget.companyName}` : ''}
        open={!!callTarget}
        onCancel={closeModal}
        onOk={saveCall}
        okText="Сохранить"
        cancelText="Отмена"
        confirmLoading={noteMut.isPending}
        okButtonProps={{ disabled: !result && !comment.trim() }}
        destroyOnHidden
      >
        {callTarget?.phone && (
          <Typography.Paragraph>
            <a href={`tel:${callTarget.phone.replace(/[^\d+]/g, '')}`}><PhoneOutlined /> {callTarget.phone}</a>
            {callTarget.contactName ? ` — ${callTarget.contactName}` : ''}
          </Typography.Paragraph>
        )}
        <Typography.Text type="secondary">Итог звонка</Typography.Text>
        <div style={{ margin: '6px 0 12px' }}>
          {CALL_RESULTS.map((r) => (
            <Tag.CheckableTag key={r} checked={result === r} onChange={(on) => setResult(on ? r : null)} style={{ marginBottom: 6 }}>
              {r}
            </Tag.CheckableTag>
          ))}
        </div>
        <Input.TextArea
          rows={3}
          placeholder="Что сказал клиент (необязательно)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
          Сохранится заметкой в карточке клиента.
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
