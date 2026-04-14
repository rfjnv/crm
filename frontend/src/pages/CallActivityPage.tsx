import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Card,
  Col,
  Row,
  Table,
  Typography,
  Spin,
  Segmented,
  Select,
  Input,
  List,
  theme,
  Button,
  Empty,
} from 'antd';
import { PhoneOutlined, UserOutlined } from '@ant-design/icons';
import { Line, Bar } from '@ant-design/charts';
import dayjs from 'dayjs';
import { analyticsApi, type CallActivityRange } from '../api/analytics.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import type { UserRole } from '../types';

const { Title, Text } = Typography;

export default function CallActivityPage() {
  const { token } = theme.useToken();
  const role = useAuthStore((s) => s.user?.role) as UserRole | undefined;
  const isManager = role === 'MANAGER';
  const [range, setRange] = useState<CallActivityRange>('today');
  const [managerId, setManagerId] = useState<string | undefined>();
  const [clientSearchInput, setClientSearchInput] = useState('');
  const [debouncedClientSearch, setDebouncedClientSearch] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedClientSearch(clientSearchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [clientSearchInput]);

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-call-activity', range, managerId, debouncedClientSearch],
    queryFn: () =>
      analyticsApi.getCallActivity({
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
        <Col>
          <Segmented
            value={range}
            onChange={(v) => setRange(v as CallActivityRange)}
            options={[
              { label: 'Сегодня', value: 'today' },
              { label: 'Неделя', value: 'week' },
              { label: 'Месяц', value: 'month' },
            ]}
          />
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
