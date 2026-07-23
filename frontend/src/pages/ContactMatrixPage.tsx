import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Input,
  List,
  Pagination,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
  theme,
} from 'antd';
import { NodeIndexOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { analyticsApi, type CallActivityRange, type CallActivityNote } from '../api/analytics.api';
import { usersApi } from '../api/users.api';
import { getFirstName } from '../lib/name-utils';

const { Title, Text } = Typography;

const MANAGER_COLORS = [
  '#1677ff', '#52c41a', '#fa8c16', '#f5222d',
  '#722ed1', '#13c2c2', '#eb2f96', '#a0d911',
  '#d48806', '#0958d9', '#389e0d', '#cf1322',
];

const SHORT_MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

const PAGE_SIZE = 50;

export default function ContactMatrixPage() {
  const { token } = theme.useToken();

  const [range, setRange] = useState<CallActivityRange>('week');
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [managerId, setManagerId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [noteDrawer, setNoteDrawer] = useState<{
    clientId: string;
    companyName: string;
    day: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: [
      'contact-matrix',
      customRange ? 'custom' : range,
      customRange?.[0]?.format('YYYY-MM-DD'),
      customRange?.[1]?.format('YYYY-MM-DD'),
      managerId,
    ],
    queryFn: () =>
      customRange
        ? analyticsApi.getCallActivity({
            from: customRange[0].format('YYYY-MM-DD'),
            to: customRange[1].format('YYYY-MM-DD'),
            managerId,
          })
        : analyticsApi.getCallActivity({ range, managerId }),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  });

  const { data: notesData, isLoading: notesLoading } = useQuery({
    queryKey: ['call-activity-client-day-notes', noteDrawer?.clientId, noteDrawer?.day],
    queryFn: () =>
      analyticsApi.getCallActivityClientDayNotes(noteDrawer!.clientId, noteDrawer!.day),
    enabled: !!noteDrawer,
  });

  const managerOptions = useMemo(
    () =>
      [...users]
        .filter((u) => u.isActive)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
        .map((u) => ({ label: getFirstName(u.fullName), value: u.id })),
    [users],
  );

  const managerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    (data?.summary ?? []).forEach((s, i) => {
      map.set(s.userId, MANAGER_COLORS[i % MANAGER_COLORS.length]);
    });
    return map;
  }, [data?.summary]);

  const filteredRows = useMemo(() => {
    const rows = data?.clientMatrix?.rows ?? [];
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.companyName.toLowerCase().includes(q)) : rows;
  }, [data?.clientMatrix?.rows, search]);

  useEffect(() => { setPage(1); }, [filteredRows]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

  const days = data?.clientMatrix?.days ?? [];
  const activeCount = filteredRows.filter((r) => r.total > 0).length;

  return (
    <div>
      {/* ── Заголовок ── */}
      <Row justify="space-between" align="middle" gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Title level={4} style={{ margin: 0 }}>
            <NodeIndexOutlined style={{ marginRight: 8 }} />
            Матрица контактов с клиентами
          </Title>
          <Text type="secondary">
            Кто из менеджеров общается с клиентами, как часто и когда — кликни на ячейку, чтобы прочитать заметки
          </Text>
        </Col>
        <Col xs={24} style={{ textAlign: 'right' }}>
          <Space direction="vertical" align="end" size={8} style={{ width: '100%' }}>
            {customRange ? (
              <Space wrap align="center">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Произвольный период (до 93 дней)
                </Text>
                <Button type="link" size="small" onClick={() => setCustomRange(null)}>
                  К пресетам
                </Button>
              </Space>
            ) : (
              <Segmented
                value={range}
                onChange={(v) => setRange(v as CallActivityRange)}
                options={[
                  { label: 'Сегодня', value: 'today' },
                  { label: 'Неделя', value: 'week' },
                  { label: 'Месяц', value: 'month' },
                ]}
              />
            )}
            <DatePicker.RangePicker
              allowClear
              format="DD.MM.YYYY"
              value={customRange ?? undefined}
              onChange={(v) => {
                if (v?.[0] && v[1]) {
                  if (v[1].diff(v[0], 'day') + 1 > 93) {
                    message.warning('Интервал не более 93 дней');
                    return;
                  }
                  setCustomRange([v[0], v[1]]);
                  return;
                }
                setCustomRange(null);
              }}
              disabledDate={(c) => !!c && c.isAfter(dayjs().endOf('day'))}
            />
          </Space>
        </Col>
      </Row>

      {/* ── Фильтры ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} md={7}>
          <Select
            allowClear
            placeholder="Все менеджеры"
            style={{ width: '100%' }}
            options={managerOptions}
            value={managerId}
            onChange={(v) => setManagerId(v)}
            suffixIcon={<UserOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} md={9}>
          <Input.Search
            allowClear
            placeholder="Поиск по клиенту"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Col>
      </Row>

      {/* ── Период ── */}
      {data && (
        <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: '8px 12px' } }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Период (Ташкент):&nbsp;
            {dayjs(data.range.start).format('DD.MM.YYYY')} — {dayjs(data.range.end).format('DD.MM.YYYY')}
          </Text>
        </Card>
      )}

      {/* ── Матрица ── */}
      {isLoading ? (
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      ) : !data ? (
        <Empty description="Нет данных" />
      ) : (
        <Card
          size="small"
          title={
            <Space wrap size={8}>
              <span>Матрица</span>
              <Tag color="blue">{activeCount} с контактами</Tag>
              <Tag>{filteredRows.length} клиентов</Tag>
              <Tag>{days.length} дней</Tag>
            </Space>
          }
        >
          {/* Легенда менеджеров */}
          {data.summary.length > 0 && (
            <Space wrap style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Менеджеры:</Text>
              {data.summary.map((s, i) => (
                <Space key={s.userId} size={4}>
                  <span style={{
                    display: 'inline-block', width: 12, height: 12, borderRadius: 3,
                    background: MANAGER_COLORS[i % MANAGER_COLORS.length],
                    verticalAlign: 'middle',
                  }} />
                  <Text style={{ fontSize: 12 }}>{getFirstName(s.fullName)}</Text>
                </Space>
              ))}
            </Space>
          )}

          {days.length === 0 ? (
            <Empty description="Нет данных за период" />
          ) : (
            <>
              <div style={{ overflowX: 'auto', maxHeight: 620, overflowY: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: 240 }} />
                    {days.map((d) => <col key={d} style={{ width: 44 }} />)}
                    <col style={{ width: 60 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{
                        position: 'sticky', left: 0, top: 0, zIndex: 3,
                        background: token.colorBgContainer,
                        padding: '5px 10px', textAlign: 'left',
                        borderBottom: `1px solid ${token.colorBorder}`,
                        borderRight: `1px solid ${token.colorBorder}`,
                        fontWeight: 600,
                      }}>
                        Клиент
                      </th>
                      {days.map((day) => (
                        <th key={day} style={{
                          position: 'sticky', top: 0, zIndex: 2,
                          background: token.colorBgContainer,
                          padding: '2px 2px', textAlign: 'center',
                          borderBottom: `1px solid ${token.colorBorder}`,
                          lineHeight: 1.2, whiteSpace: 'nowrap', fontWeight: 400,
                        }}>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{day.slice(8, 10)}</div>
                          <div style={{ color: token.colorTextSecondary, fontSize: 10 }}>
                            {SHORT_MONTHS[Number(day.slice(5, 7)) - 1]}
                          </div>
                        </th>
                      ))}
                      <th style={{
                        position: 'sticky', top: 0, right: 0, zIndex: 3,
                        background: token.colorBgContainer,
                        padding: '5px 4px', textAlign: 'center',
                        borderBottom: `1px solid ${token.colorBorder}`,
                        borderLeft: `1px solid ${token.colorBorder}`,
                        fontWeight: 600,
                      }}>
                        Итого
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row) => (
                      <tr key={row.clientId}>
                        <td style={{
                          position: 'sticky', left: 0, zIndex: 1,
                          background: token.colorBgContainer,
                          padding: '3px 10px',
                          borderBottom: `1px solid ${token.colorBorderSecondary}`,
                          borderRight: `1px solid ${token.colorBorderSecondary}`,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          maxWidth: 240,
                        }}>
                          <Link to={`/clients/${row.clientId}`} style={{ fontSize: 12 }}>
                            {row.companyName}
                          </Link>
                        </td>

                        {days.map((day) => {
                          const managers = row.days[day] ?? [];
                          return (
                            <td
                              key={day}
                              onClick={() =>
                                managers.length > 0 &&
                                setNoteDrawer({ clientId: row.clientId, companyName: row.companyName, day })
                              }
                              style={{
                                textAlign: 'center', verticalAlign: 'middle',
                                padding: '3px 2px', height: 34,
                                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                                background: managers.length > 0 ? token.colorPrimaryBg : undefined,
                                cursor: managers.length > 0 ? 'pointer' : 'default',
                                transition: 'background 0.15s',
                              }}
                            >
                              {managers.length > 0 ? (
                                <Tooltip
                                  title={
                                    <div>
                                      {managers.map((m) => (
                                        <div
                                          key={m.userId}
                                          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}
                                        >
                                          <span style={{
                                            display: 'inline-block', width: 8, height: 8,
                                            borderRadius: 2, flexShrink: 0,
                                            background: managerColorMap.get(m.userId) ?? '#888',
                                          }} />
                                          {getFirstName(m.fullName)}: {m.count}
                                        </div>
                                      ))}
                                    </div>
                                  }
                                >
                                  <div style={{
                                    display: 'flex', justifyContent: 'center',
                                    alignItems: 'center', gap: 2, flexWrap: 'wrap',
                                  }}>
                                    {managers.map((m) => (
                                      <div
                                        key={m.userId}
                                        style={{
                                          minWidth: 14, height: 14, borderRadius: 3,
                                          background: managerColorMap.get(m.userId) ?? '#888',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          color: '#fff', fontSize: 9, fontWeight: 700,
                                          padding: m.count > 1 ? '0 3px' : undefined,
                                        }}
                                      >
                                        {m.count > 1 ? m.count : ''}
                                      </div>
                                    ))}
                                  </div>
                                </Tooltip>
                              ) : null}
                            </td>
                          );
                        })}

                        <td style={{
                          position: 'sticky', right: 0, zIndex: 1,
                          background: token.colorBgContainer,
                          textAlign: 'center', fontWeight: 700, fontSize: 13,
                          borderBottom: `1px solid ${token.colorBorderSecondary}`,
                          borderLeft: `1px solid ${token.colorBorderSecondary}`,
                          padding: '3px 6px',
                          color: row.total > 0 ? token.colorPrimary : token.colorTextQuaternary,
                        }}>
                          {row.total > 0 ? row.total : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredRows.length === 0 && (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="Нет клиентов"
                    style={{ margin: '24px 0' }}
                  />
                )}
              </div>

              {filteredRows.length > PAGE_SIZE && (
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <Pagination
                    size="small"
                    current={page}
                    pageSize={PAGE_SIZE}
                    total={filteredRows.length}
                    onChange={(p) => setPage(p)}
                    showSizeChanger={false}
                    showTotal={(total, r) => `${r[0]}–${r[1]} из ${total} клиентов`}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* ── Дровер с заметками ── */}
      <Drawer
        open={!!noteDrawer}
        onClose={() => setNoteDrawer(null)}
        title={
          noteDrawer ? (
            <Space>
              <Link to={`/clients/${noteDrawer.clientId}`} onClick={() => setNoteDrawer(null)}>
                {noteDrawer.companyName}
              </Link>
              <Text type="secondary">—</Text>
              <Text>{dayjs(noteDrawer.day).format('DD.MM.YYYY')}</Text>
            </Space>
          ) : null
        }
        width={520}
      >
        {notesLoading ? (
          <Spin style={{ display: 'block', margin: '40px auto' }} />
        ) : !notesData?.notes.length ? (
          <Empty description="Нет заметок" />
        ) : (
          <List
            dataSource={notesData.notes}
            renderItem={(note: CallActivityNote) => (
              <List.Item style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Space size={6}>
                    <span style={{
                      display: 'inline-block', width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                      background: managerColorMap.get(note.userId) ?? token.colorTextSecondary,
                      verticalAlign: 'middle',
                    }} />
                    <Text strong>{note.managerName}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(note.createdAt).format('HH:mm')}
                    </Text>
                  </Space>
                  <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {note.content}
                  </div>
                </div>
              </List.Item>
            )}
          />
        )}
      </Drawer>
    </div>
  );
}
