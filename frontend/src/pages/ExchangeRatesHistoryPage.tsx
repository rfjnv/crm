import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card, DatePicker, Select, Space, Table, Typography, Tag, Button, Tooltip,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { cbuApi, type StoredExchangeRate } from '../api/cbu.api';
import CbuRatesWidget from '../components/CbuRatesWidget';

const ALL_CURRENCIES = ['USD', 'EUR', 'CNY', 'RUB', 'GBP'];

export default function ExchangeRatesHistoryPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs().subtract(30, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [currency, setCurrency] = useState<string | undefined>(undefined);

  const params = useMemo(
    () => ({
      from: range[0].format('YYYY-MM-DD'),
      to: range[1].format('YYYY-MM-DD'),
      currency,
      limit: 1000,
    }),
    [range, currency],
  );

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['exchange-rates', params],
    queryFn: () => cbuApi.listStored(params),
  });

  const rows = data ?? [];

  // Группируем по валюте и вычисляем дельту к предыдущей дате
  const withDeltas = useMemo<(StoredExchangeRate & { delta?: number })[]>(() => {
    const byCcy: Record<string, StoredExchangeRate[]> = {};
    for (const r of rows) {
      if (!byCcy[r.currency]) byCcy[r.currency] = [];
      byCcy[r.currency].push(r);
    }
    // в каждой валюте rows идут по date DESC; дельта = current - next (более старый)
    const out: (StoredExchangeRate & { delta?: number })[] = [];
    for (const r of rows) {
      const list = byCcy[r.currency];
      const idx = list.indexOf(r);
      const older = list[idx + 1];
      const delta = older ? Number((r.rate - older.rate).toFixed(4)) : undefined;
      out.push({ ...r, delta });
    }
    return out;
  }, [rows]);

  return (
    <div>
      <CbuRatesWidget />

      <Card
        size="small"
        title={<span style={{ fontWeight: 500 }}>История курсов ЦБ РУз</span>}
        extra={
          <Tooltip title="Обновить">
            <Button
              type="text"
              icon={<ReloadOutlined spin={isFetching} />}
              onClick={() => refetch()}
            />
          </Tooltip>
        }
      >
        <Space wrap style={{ marginBottom: 12 }} size={8}>
          <DatePicker.RangePicker
            value={range}
            onChange={(v) => {
              if (v && v[0] && v[1]) setRange([v[0], v[1]]);
            }}
            format="DD.MM.YYYY"
            allowClear={false}
          />
          <Select
            value={currency}
            placeholder="Все валюты"
            allowClear
            style={{ width: 160 }}
            onChange={(v) => setCurrency(v || undefined)}
            options={ALL_CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
          <Typography.Text type="secondary">
            Всего записей: {rows.length}
          </Typography.Text>
        </Space>

        <Table
          size="small"
          rowKey={(r) => `${r.date}_${r.currency}`}
          loading={isLoading}
          dataSource={withDeltas}
          pagination={{ pageSize: 50, showSizeChanger: true }}
          columns={[
            {
              title: 'Дата',
              dataIndex: 'date',
              width: 120,
              sorter: (a, b) => a.date.localeCompare(b.date),
              defaultSortOrder: 'descend',
              render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
            },
            {
              title: 'Валюта',
              dataIndex: 'currency',
              width: 100,
              render: (v: string) => <Tag color="blue">{v}</Tag>,
              filters: ALL_CURRENCIES.map((c) => ({ text: c, value: c })),
              onFilter: (v, r) => r.currency === v,
            },
            {
              title: 'Курс, UZS',
              dataIndex: 'rate',
              align: 'right',
              sorter: (a, b) => a.rate - b.rate,
              render: (v: number) =>
                v.toLocaleString('ru-RU', { maximumFractionDigits: 4, minimumFractionDigits: 2 }),
            },
            {
              title: 'Номинал',
              dataIndex: 'nominal',
              width: 90,
              align: 'right',
            },
            {
              title: 'Δ к пред.',
              dataIndex: 'delta',
              width: 120,
              align: 'right',
              render: (v: number | undefined) => {
                if (v === undefined) return <span style={{ color: 'rgba(0,0,0,0.35)' }}>—</span>;
                const up = v > 0;
                const down = v < 0;
                const color = up ? '#cf1322' : down ? '#3f8600' : 'rgba(0,0,0,0.45)';
                return (
                  <span style={{ color }}>
                    {v > 0 ? '+' : ''}
                    {v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                  </span>
                );
              },
            },
            {
              title: 'Источник',
              dataIndex: 'source',
              width: 100,
              render: (v: string) => <Tag>{v}</Tag>,
            },
          ]}
        />
      </Card>
    </div>
  );
}
