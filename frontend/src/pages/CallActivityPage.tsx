import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Card,
  Col,
  Row,
  Table,
  Tag,
  Typography,
  Spin,
  Segmented,
  Select,
  Input,
  List,
  theme,
  Button,
  Empty,
  DatePicker,
  Space,
  Tooltip,
  message,
} from 'antd';
import { PhoneOutlined, UserOutlined } from '@ant-design/icons';
import { Line, Bar } from '@ant-design/charts';
import dayjs from 'dayjs';
import { analyticsApi, type CallActivityRange } from '../api/analytics.api';
import type { Dayjs } from 'dayjs';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import type { UserRole } from '../types';

const { Title, Text } = Typography;

const MANAGER_COLORS = [
  '#1677ff', '#52c41a', '#fa8c16', '#f5222d',
  '#722ed1', '#13c2c2', '#eb2f96', '#a0d911',
  '#d48806', '#0958d9', '#389e0d', '#cf1322',
];

const SHORT_MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

export default function CallActivityPage() {
  const { token } = theme.useToken();
  const role = useAuthStore((s) => s.user?.role) as UserRole | undefined;
  const isManager = role === 'MANAGER';
  const [range, setRange] = useState<CallActivityRange>('today');
  /** Если задано — запрос идёт с `from`/`to` (календарь Ташкента на сервере). */
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [managerId, setManagerId] = useState<string | undefined>();
  const [clientSearchInput, setClientSearchInput] = useState('');
  const [debouncedClientSearch, setDebouncedClientSearch] = useState('');
  const [matrixSearch, setMatrixSearch] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedClientSearch(clientSearchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [clientSearchInput]);

  const { data, isLoading } = useQuery({
    queryKey: [
      'analytics-call-activity',
      customRange ? 'custom' : range,
      customRange?.[0]?.format('YYYY-MM-DD'),
      customRange?.[1]?.format('YYYY-MM-DD'),
      managerId,
      debouncedClientSearch,
    ],
    queryFn: () =>
      customRange
        ? analyticsApi.getCallActivity({
            from: customRange[0].format('YYYY-MM-DD'),
            to: customRange[1].format('YYYY-MM-DD'),
            managerId,
            clientSearch: debouncedClientSearch || undefined,
          })
        : analyticsApi.getCallActivity({
            range,
            managerId,
            clientSearch: debouncedClientSearch || undefined,
          }),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    enabled: !isManager,
  });

  const managerOptions = useMemo(
    () =>
      [...users]
        .filter((u) => u.isActive)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
        .map((u) => ({ label: u.fullName, value: u.id })),
    [users],
  );

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

  const lineConfig = useMemo(() => {
    if (!data?.lineChart?.length) return null;
    return {
      data: data.lineChart,
      xField: 'day',
      yField: 'count',
      seriesField: 'manager',
      height: 320,
      shapeField: 'smooth' as const,
      style: { lineWidth: 2 },
      theme: chartTheme,
      axis: {
        x: { labelFill: token.colorTextSecondary },
        y: { labelFill: token.colorTextSecondary, title: false },
      },
      legend: { color: { maxRows: 2, itemLabelFill: token.colorText } },
      tooltip: {
        items: [{ field: 'count', channel: 'y', name: 'Контактов' }],
      },
    };
  }, [data?.lineChart, chartTheme, token.colorText, token.colorTextSecondary]);

  const barConfig = useMemo(() => {
    if (!data?.barChart?.length) return null;
    return {
      data: data.barChart,
      xField: 'manager',
      yField: 'total',
      height: 300,
      theme: chartTheme,
      axis: {
        x: {
          labelFill: token.colorTextSecondary,
          labelAutoRotate: true,
          labelAutoHide: true,
        },
        y: { labelFill: token.colorTextSecondary, title: false },
      },
      tooltip: {
        items: [{ field: 'total', channel: 'y', name: 'Контактов' }],
      },
    };
  }, [data?.barChart, chartTheme, token.colorTextSecondary]);

  const managerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    (data?.summary ?? []).forEach((s, i) => {
      map.set(s.userId, MANAGER_COLORS[i % MANAGER_COLORS.length]);
    });
    return map;
  }, [data?.summary]);

  const filteredMatrixRows = useMemo(() => {
    const rows = data?.clientMatrix?.rows ?? [];
    const q = matrixSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.companyName.toLowerCase().includes(q));
  }, [data?.clientMatrix?.rows, matrixSearch]);

  const summaryColumns = [
    {
      title: 'Менеджер',
      dataIndex: 'fullName',
      key: 'fullName',
      render: (v: string, r: { userId: string }) => (
        <Button
          type="link"
          style={{ padding: 0, height: 'auto', fontWeight: managerId === r.userId ? 600 : 400 }}
          onClick={(e) => {
            e.stopPropagation();
            setManagerId((prev) => (prev === r.userId ? undefined : r.userId));
          }}
        >
          {v}
        </Button>
      ),
    },
    {
      title: 'Контактов',
      dataIndex: 'contactCount',
      key: 'contactCount',
      width: 110,
      align: 'right' as const,
    },
    {
      title: 'Последняя активность',
      dataIndex: 'lastActivityAt',
      key: 'lastActivityAt',
      width: 180,
      render: (iso: string) => dayjs(iso).format('DD.MM.YYYY HH:mm'),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Title level={4} style={{ margin: 0 }}>
            <PhoneOutlined style={{ marginRight: 8 }} />
            Обзвоны
          </Title>
          <Text type="secondary">
            {isManager
              ? 'Только ваши заметки по клиентам (без сводок и графиков по отделу)'
              : 'Активность по заметкам к клиентам (одна заметка = один контакт)'}
          </Text>
        </Col>
        <Col xs={24} style={{ textAlign: 'right' }}>
          <Space direction="vertical" align="end" size={8} style={{ width: '100%' }}>
            {customRange ? (
              <Space wrap align="center">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Выбраны даты (календарь на сервере — Asia/Tashkent, до 93 дней)
                </Text>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setCustomRange(null);
                  }}
                >
                  Вернуться к пресетам
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
                  const days = v[1].diff(v[0], 'day') + 1;
                  if (days > 93) {
                    message.warning('Интервал не более 93 дней');
                    return;
                  }
                  setCustomRange([v[0], v[1]]);
                  return;
                }
                setCustomRange(null);
              }}
              disabledDate={(current) => {
                if (!current) return false;
                const today = dayjs().endOf('day');
                if (current.isAfter(today)) return true;
                return false;
              }}
            />
          </Space>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {!isManager ? (
          <Col xs={24} sm={12} md={8}>
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
        ) : null}
        <Col xs={24} sm={12} md={isManager ? 24 : 10}>
          <Input.Search
            allowClear
            placeholder="Поиск по названию клиента"
            value={clientSearchInput}
            onChange={(e) => setClientSearchInput(e.target.value)}
            onSearch={(v) => setDebouncedClientSearch(v.trim())}
          />
        </Col>
        {!isManager && managerId ? (
          <Col xs={24} md={6}>
            <Button type="link" onClick={() => setManagerId(undefined)}>
              Сбросить фильтр менеджера
            </Button>
          </Col>
        ) : null}
      </Row>

      {isLoading ? (
        <Spin style={{ display: 'block', margin: '48px auto' }} />
      ) : !data ? (
        <Empty description="Нет данных" />
      ) : (
        <>
          <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Период (Ташкент): {dayjs(data.range.start).format('DD.MM.YYYY HH:mm')} —{' '}
              {dayjs(data.range.end).format('DD.MM.YYYY HH:mm')}
            </Text>
          </Card>

          {!isManager ? (
            <Card size="small" title="Сводка по менеджерам" style={{ marginBottom: 12 }}>
              <Table
                size="small"
                rowKey="userId"
                pagination={false}
                dataSource={data.summary}
                columns={summaryColumns}
                locale={{ emptyText: 'Нет заметок за период' }}
                onRow={(record) => ({
                  onClick: () => setManagerId((prev) => (prev === record.userId ? undefined : record.userId)),
                  style: {
                    cursor: 'pointer',
                    background: managerId === record.userId ? token.colorPrimaryBg : undefined,
                  },
                })}
              />
            </Card>
          ) : null}

          {!isManager ? (
            <Row gutter={[12, 12]}>
              <Col xs={24} lg={14}>
                <Card size="small" title="Контакты по дням" style={{ marginBottom: 12 }}>
                  {lineConfig && data.summary.length > 0 ? (
                    <Line {...lineConfig} />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных для графика" />
                  )}
                </Card>
              </Col>
              <Col xs={24} lg={10}>
                <Card size="small" title="Сравнение менеджеров" style={{ marginBottom: 12 }}>
                  {barConfig && data.barChart.length > 0 ? (
                    <Bar {...barConfig} />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных" />
                  )}
                </Card>
              </Col>
            </Row>
          ) : null}

          {!isManager && data.clientMatrix && data.clientMatrix.rows.length > 0 ? (
            <Card
              size="small"
              title={
                <Space align="center" size={8}>
                  <span>Матрица контактов по клиентам</span>
                  <Tag color="blue">{data.clientMatrix.rows.length} клиентов</Tag>
                  <Tag>{data.clientMatrix.days.length} дней</Tag>
                </Space>
              }
              style={{ marginBottom: 12 }}
            >
              <Space wrap style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Менеджеры:</Text>
                {data.summary.map((s, i) => (
                  <Space key={s.userId} size={4}>
                    <span style={{
                      display: 'inline-block', width: 12, height: 12, borderRadius: 3,
                      background: MANAGER_COLORS[i % MANAGER_COLORS.length],
                      verticalAlign: 'middle',
                    }} />
                    <Text style={{ fontSize: 12 }}>{s.fullName}</Text>
                  </Space>
                ))}
              </Space>

              <Input
                size="small"
                allowClear
                placeholder="Поиск клиента..."
                value={matrixSearch}
                onChange={(e) => setMatrixSearch(e.target.value)}
                style={{ maxWidth: 240, marginBottom: 8, display: 'block' }}
              />

              <div style={{ overflowX: 'auto', maxHeight: 540, overflowY: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: 220 }} />
                    {data.clientMatrix.days.map((d) => <col key={d} style={{ width: 42 }} />)}
                    <col style={{ width: 58 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{
                        position: 'sticky', left: 0, top: 0, zIndex: 3,
                        background: token.colorBgContainer,
                        padding: '4px 8px', textAlign: 'left',
                        borderBottom: `1px solid ${token.colorBorder}`,
                        borderRight: `1px solid ${token.colorBorder}`,
                        fontWeight: 600,
                      }}>
                        Клиент
                      </th>
                      {data.clientMatrix.days.map((day) => (
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
                        padding: '4px 4px', textAlign: 'center',
                        borderBottom: `1px solid ${token.colorBorder}`,
                        borderLeft: `1px solid ${token.colorBorder}`,
                        fontWeight: 600, fontSize: 12,
                      }}>
                        Итого
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatrixRows.map((row) => (
                      <tr key={row.clientId}>
                        <td style={{
                          position: 'sticky', left: 0, zIndex: 1,
                          background: token.colorBgContainer,
                          padding: '3px 8px',
                          borderBottom: `1px solid ${token.colorBorderSecondary}`,
                          borderRight: `1px solid ${token.colorBorderSecondary}`,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          maxWidth: 220,
                        }}>
                          <Link to={`/clients/${row.clientId}`} style={{ fontSize: 12 }}>
                            {row.companyName}
                          </Link>
                        </td>
                        {data.clientMatrix!.days.map((day) => {
                          const managers = row.days[day] ?? [];
                          return (
                            <td key={day} style={{
                              textAlign: 'center', verticalAlign: 'middle',
                              padding: '3px 2px', height: 32,
                              borderBottom: `1px solid ${token.colorBorderSecondary}`,
                              background: managers.length > 0 ? `${token.colorPrimaryBg}` : undefined,
                            }}>
                              {managers.length > 0 ? (
                                <Tooltip
                                  title={
                                    <div>
                                      {managers.map((m) => (
                                        <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                          <span style={{
                                            display: 'inline-block', width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                                            background: managerColorMap.get(m.userId) ?? '#888',
                                          }} />
                                          {m.fullName}: {m.count}
                                        </div>
                                      ))}
                                    </div>
                                  }
                                >
                                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, flexWrap: 'wrap', cursor: 'default' }}>
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
                          color: token.colorPrimary,
                        }}>
                          {row.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredMatrixRows.length === 0 && (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет клиентов" style={{ margin: '16px 0' }} />
                )}
              </div>
            </Card>
          ) : null}

          <Card size="small" title="Лента заметок">
            <List
              size="small"
              dataSource={data.feed}
              locale={{ emptyText: 'Нет заметок' }}
              renderItem={(item) => (
                <List.Item style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>
                      <Text strong>{item.managerName}</Text>
                      <Text type="secondary"> → </Text>
                      <Link to={`/clients/${item.clientId}`}>{item.companyName}</Link>
                    </div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                      {dayjs(item.createdAt).format('DD.MM.YYYY HH:mm')}
                    </Text>
                    <Text style={{ display: 'block', marginTop: 6, whiteSpace: 'pre-wrap' }}>{item.preview}</Text>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </>
      )}
    </div>
  );
}
