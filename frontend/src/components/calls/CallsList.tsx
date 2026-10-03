import { Button, Card, Dropdown, Empty, Pagination, Space, Spin, Table, Tag, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MoreOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import type { CallListItem } from '../../api/calls.api';
import { formatUzPhone } from '../../utils/phone';
import { useIsMobile } from '../../hooks/useIsMobile';
import CallAudioPlayer from './CallAudioPlayer';
import { AudioStatusTag, CallTypeIcon, callTypeLabel, formatDuration, isFailedCall } from './callsUi';

export interface CallRowActions {
  onOpen: (call: CallListItem) => void;
  onLinkClient: (call: CallListItem) => void;
  onCreateClient: (call: CallListItem) => void;
  onCallbackTask: (call: CallListItem) => void;
}

interface Props extends CallRowActions {
  items: CallListItem[];
  loading?: boolean;
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  showManager?: boolean;
  showClient?: boolean;
}

function ClientCell({ call }: { call: CallListItem }) {
  if (call.client) return <Link to={`/clients/${call.client.id}`} onClick={(e) => e.stopPropagation()}>{call.client.companyName}</Link>;
  return <Tag style={{ marginInlineEnd: 0 }}>Неизвестный контакт</Tag>;
}

function rowMenu(call: CallListItem, a: CallRowActions) {
  return {
    items: [
      { key: 'open', label: 'Подробнее' },
      ...(!call.client ? [{ key: 'link', label: 'Привязать к клиенту' }, { key: 'create', label: 'Создать клиента' }] : []),
      ...(call.counterpart ? [{ key: 'callback', label: 'Задача «перезвонить»' }] : []),
      ...(call.auditId ? [{ key: 'audit', label: <Link to={`/ai-assistant/call-audits?audit=${call.auditId}`}>Открыть аудит</Link> }] : []),
    ],
    onClick: ({ key, domEvent }: { key: string; domEvent: { stopPropagation: () => void } }) => {
      domEvent.stopPropagation();
      if (key === 'open') a.onOpen(call);
      if (key === 'link') a.onLinkClient(call);
      if (key === 'create') a.onCreateClient(call);
      if (key === 'callback') a.onCallbackTask(call);
    },
  };
}

export default function CallsList(props: Props) {
  const { items, loading, totalCount, page, pageSize, onPageChange, showManager = true, showClient = true } = props;
  const isMobile = useIsMobile();
  const { token } = theme.useToken();

  const typeCell = (call: CallListItem) => (
    <Space size={6} style={{ color: isFailedCall(call) ? token.colorError : undefined }}>
      <CallTypeIcon call={call} />
      <span>{callTypeLabel(call)}</span>
    </Space>
  );

  if (isMobile) {
    if (loading) return <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>;
    if (items.length === 0) return <Empty description="Звонков нет" />;
    return (
      <div>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {items.map((call) => (
            <Card key={call.id} size="small" onClick={() => props.onOpen(call)} styles={{ body: { padding: 12 } }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div>{showClient ? <ClientCell call={call} /> : null}</div>
                  <Typography.Text>{formatUzPhone(call.counterpart) || 'скрытый номер'}</Typography.Text>
                </div>
                <Dropdown menu={rowMenu(call, props)} trigger={['click']}>
                  <Button size="small" type="text" icon={<MoreOutlined />} onClick={(e) => e.stopPropagation()} />
                </Dropdown>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, alignItems: 'center' }}>
                {typeCell(call)}
                <Typography.Text type="secondary">{dayjs(call.startedAt).format('DD.MM HH:mm')} · {formatDuration(call.durationSec)}</Typography.Text>
                {showManager && call.manager && <Typography.Text type="secondary">{call.manager.fullName}</Typography.Text>}
              </div>
              {call.hasRecording && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <CallAudioPlayer callId={call.id} block />
                  <AudioStatusTag call={call} />
                </div>
              )}
            </Card>
          ))}
        </Space>
        {totalCount > pageSize && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Pagination simple current={page} pageSize={pageSize} total={totalCount} onChange={onPageChange} />
          </div>
        )}
      </div>
    );
  }

  const columns: ColumnsType<CallListItem> = [
    { title: 'Время', dataIndex: 'startedAt', width: 120, render: (v: string) => dayjs(v).format('DD.MM.YY HH:mm') },
    ...(showManager ? [{ title: 'Менеджер', key: 'manager', render: (_: unknown, c: CallListItem) => c.manager?.fullName ?? '—' }] : []),
    ...(showClient ? [{ title: 'Клиент', key: 'client', render: (_: unknown, c: CallListItem) => <ClientCell call={c} /> }] : []),
    { title: 'Номер', key: 'phone', width: 160, render: (_, c) => formatUzPhone(c.counterpart) || 'скрыт' },
    { title: 'Направление', key: 'type', render: (_, c) => typeCell(c) },
    { title: 'Длит.', dataIndex: 'durationSec', width: 70, render: (v: number | null) => formatDuration(v) },
    { title: 'Запись', key: 'rec', render: (_, c) => (c.hasRecording ? <CallAudioPlayer callId={c.id} /> : <Typography.Text type="secondary">—</Typography.Text>) },
    { title: 'Анализ', key: 'audio', width: 150, render: (_, c) => (c.hasRecording ? <AudioStatusTag call={c} /> : null) },
    {
      key: 'actions',
      width: 48,
      render: (_, c) => (
        <Dropdown menu={rowMenu(c, props)} trigger={['click']}>
          <Button size="small" type="text" icon={<MoreOutlined />} onClick={(e) => e.stopPropagation()} />
        </Dropdown>
      ),
    },
  ];

  return (
    <Table<CallListItem>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={items}
      loading={loading}
      onRow={(c) => ({ onClick: () => props.onOpen(c), style: { cursor: 'pointer' } })}
      pagination={{ current: page, pageSize, total: totalCount, onChange: onPageChange, showSizeChanger: true, pageSizeOptions: [20, 30, 50, 100] }}
      scroll={{ x: 900 }}
      locale={{ emptyText: 'Звонков нет' }}
    />
  );
}
