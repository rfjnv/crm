import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, DatePicker, Space, Statistic, Table, Typography, Button, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import BackButton from '../components/BackButton';
import { analyticsApi } from '../api/analytics.api';
import { useIsMobile } from '../hooks/useIsMobile';
import type { LaminationKgUsageManagerRow } from '../types';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Супер-админ',
  ADMIN: 'Админ',
  MANAGER: 'Менеджер',
  WAREHOUSE_MANAGER: 'Зав. склада',
  WAREHOUSE: 'Склад',
  LOADER: 'Грузчик',
  ACCOUNTANT: 'Бухгалтер',
  HR: 'HR',
};

/** Роли, которым «доверяют» ручной ввод кг (обычно видят и взвешивают рулон вживую) — зелёный тег.
 * Все остальные роли (в первую очередь обычный менеджер, который вводит вес со слов клиента) — красный. */
const TRUSTED_KG_ROLES = new Set(['SUPER_ADMIN', 'LOADER', 'WAREHOUSE', 'WAREHOUSE_MANAGER']);

function formatKg(v: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(v);
}

export default function LaminationKgUsagePage() {
  const isMobile = useIsMobile();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('day'), dayjs().endOf('day')]);

  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['lamination-kg-usage', from, to],
    queryFn: () => analyticsApi.getLaminationKgUsage({ from, to }),
  });

  const rows = useMemo(() => data?.byManager ?? [], [data]);

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Space align="center" style={{ marginBottom: 16 }}>
        <BackButton fallback="/dashboard" />
        <Title level={4} style={{ margin: 0 }}>Кто вводит кг для ламинации</Title>
      </Space>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Показывает, какие менеджеры вручную указывают вес (кг) на позициях «Ламинационная плёнка» при создании сделки.
      </Text>

      <Card
        bordered={false}
        style={{ marginBottom: 16 }}
        styles={{ body: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' } }}
      >
        <RangePicker
          value={range}
          allowClear={false}
          onChange={(v) => {
            if (v && v[0] && v[1]) setRange([v[0], v[1]]);
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>
          Обновить
        </Button>
      </Card>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
        <Card bordered={false} style={{ minWidth: 180, flex: 1 }}>
          <Statistic title="Позиций с кг" value={data?.totals.itemsCount ?? 0} loading={isLoading} />
        </Card>
        <Card bordered={false} style={{ minWidth: 180, flex: 1 }}>
          <Statistic title="Сделок" value={data?.totals.dealsCount ?? 0} loading={isLoading} />
        </Card>
        <Card bordered={false} style={{ minWidth: 180, flex: 1 }}>
          <Statistic
            title="Всего кг введено"
            value={data ? formatKg(data.totals.totalKg) : 0}
            loading={isLoading}
            suffix="кг"
          />
        </Card>
      </div>

      <Card bordered={false}>
        <Table<LaminationKgUsageManagerRow>
          rowKey="managerId"
          loading={isLoading}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: 'За выбранный период никто не вводил кг вручную' }}
          columns={[
            {
              title: '#',
              key: 'rank',
              width: 48,
              render: (_v, _r, i) => i + 1,
            },
            {
              title: 'Менеджер',
              dataIndex: 'managerName',
              key: 'managerName',
              render: (name: string, row) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{name}</Text>
                  <Tag color={TRUSTED_KG_ROLES.has(row.managerRole) ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>
                    {ROLE_LABELS[row.managerRole] ?? row.managerRole}
                  </Tag>
                </Space>
              ),
            },
            {
              title: 'Позиций с кг',
              dataIndex: 'itemsCount',
              key: 'itemsCount',
              align: 'right',
              sorter: (a, b) => a.itemsCount - b.itemsCount,
              defaultSortOrder: 'descend',
            },
            {
              title: 'Сделок',
              dataIndex: 'dealsCount',
              key: 'dealsCount',
              align: 'right',
            },
            {
              title: 'Всего кг',
              dataIndex: 'totalKg',
              key: 'totalKg',
              align: 'right',
              render: (v: number) => `${formatKg(v)} кг`,
            },
          ]}
        />
      </Card>
    </div>
  );
}
