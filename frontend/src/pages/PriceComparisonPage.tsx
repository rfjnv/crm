import { useMemo, useState } from 'react';
import { Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import BackButton from '../components/BackButton';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  PRICE_ROWS,
  type Competitor,
  type MatchType,
  type PriceRow,
} from './priceComparisonData';

const competitorColor: Record<Competitor, string> = {
  Yann: 'blue',
  'Bit Trade': 'green',
  'Avanta Trade': 'gold',
  'Foil Trading': 'magenta',
};

function formatMoney(value: number | null): string {
  if (value === null) return '—';
  return `${value.toLocaleString('ru-RU')} сум`;
}

function priceDelta(ourPrice: number, competitorPrice: number | null): { diff: number; percent: number } | null {
  if (competitorPrice === null || ourPrice <= 0) return null;
  const diff = competitorPrice - ourPrice;
  const percent = Math.round((diff / ourPrice) * 100);
  return { diff, percent };
}

export default function PriceComparisonPage() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [competitor, setCompetitor] = useState<'all' | Competitor>('all');
  const [category, setCategory] = useState<string>('all');
  const [matchType, setMatchType] = useState<'all' | MatchType>('all');

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(PRICE_ROWS.map((row) => row.category)))],
    [],
  );

  const competitors = useMemo(
    () => ['all', ...Array.from(new Set(PRICE_ROWS.map((row) => row.competitor)))],
    [],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PRICE_ROWS.filter((row) => {
      if (competitor !== 'all' && row.competitor !== competitor) return false;
      if (category !== 'all' && row.category !== category) return false;
      if (matchType !== 'all' && row.matchType !== matchType) return false;
      if (!q) return true;
      return (
        row.ourProduct.toLowerCase().includes(q)
        || row.competitorProduct.toLowerCase().includes(q)
        || row.category.toLowerCase().includes(q)
      );
    });
  }, [category, competitor, matchType, search]);

  const stats = useMemo(() => {
    const comparable = filteredRows.filter((row) => row.competitorPrice !== null);
    const theyAreCheaper = comparable.filter((row) => (row.competitorPrice as number) < row.ourPrice).length;
    const weAreCheaper = comparable.filter((row) => (row.competitorPrice as number) > row.ourPrice).length;
    const samePrice = comparable.filter((row) => row.competitorPrice === row.ourPrice).length;
    return {
      total: filteredRows.length,
      theyAreCheaper,
      weAreCheaper,
      samePrice,
    };
  }, [filteredRows]);

  const columns: ColumnsType<PriceRow> = [
    {
      title: 'Наш товар (Polygraph Business)',
      dataIndex: 'ourProduct',
      width: 300,
      render: (value: string, row) => (
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.category}
          </Typography.Text>
          <div>{value}</div>
        </div>
      ),
    },
    {
      title: 'Товар конкурента',
      dataIndex: 'competitorProduct',
      width: 320,
      render: (value: string, row) => (
        <div>
          <div>{value}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.matchType} совпадение
          </Typography.Text>
        </div>
      ),
    },
    {
      title: 'Компания',
      dataIndex: 'competitor',
      width: 140,
      render: (value: Competitor) => (
        <Tag color={competitorColor[value]}>{value}</Tag>
      ),
    },
    {
      title: 'Наша цена',
      dataIndex: 'ourPrice',
      width: 130,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Их цена',
      dataIndex: 'competitorPrice',
      width: 130,
      align: 'right',
      render: (value: number | null) => formatMoney(value),
    },
    {
      title: 'Разница',
      key: 'diff',
      width: 130,
      align: 'right',
      render: (_, row) => {
        const delta = priceDelta(row.ourPrice, row.competitorPrice);
        if (!delta) return '—';
        const color = delta.diff > 0 ? '#cf1322' : delta.diff < 0 ? '#08979c' : undefined;
        const prefix = delta.diff > 0 ? '+' : '';
        return <span style={{ color }}>{prefix}{formatMoney(delta.diff)}</span>;
      },
    },
    {
      title: 'Разница %',
      key: 'percent',
      width: 110,
      align: 'right',
      render: (_, row) => {
        const delta = priceDelta(row.ourPrice, row.competitorPrice);
        if (!delta) return '—';
        const color = delta.percent > 0 ? '#cf1322' : delta.percent < 0 ? '#08979c' : undefined;
        const prefix = delta.percent > 0 ? '+' : '';
        return <span style={{ color, fontWeight: 600 }}>{prefix}{delta.percent}%</span>;
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 8 }}>
        <BackButton fallback="/analytics" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Сравнение цен
        </Typography.Title>
      </div>

      <Space wrap style={{ marginBottom: 16, width: '100%' }}>
        <Input.Search
          placeholder="Поиск по товару или категории..."
          allowClear
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ width: isMobile ? '100%' : 300 }}
        />
        <Select
          value={competitor}
          onChange={(value) => setCompetitor(value)}
          style={{ width: isMobile ? '100%' : 200 }}
          options={competitors.map((value) => ({
            value,
            label: value === 'all' ? 'Компания: все' : value,
          }))}
        />
        <Select
          value={category}
          onChange={(value) => setCategory(value)}
          style={{ width: isMobile ? '100%' : 240 }}
          options={categories.map((value) => ({
            value,
            label: value === 'all' ? 'Категория: все' : value,
          }))}
        />
        <Select
          value={matchType}
          onChange={(value) => setMatchType(value)}
          style={{ width: isMobile ? '100%' : 200 }}
          options={[
            { value: 'all', label: 'Совпадение: все' },
            { value: 'Точное', label: 'Точное' },
            { value: 'Потенциальное', label: 'Потенциальное' },
          ]}
        />
      </Space>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: 16 }}>
        <Card size="small">
          <Typography.Text type="secondary">Всего совпадений</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">У них дешевле</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#08979c' }}>{stats.theyAreCheaper}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">У нас дешевле</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#cf1322' }}>{stats.weAreCheaper}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">Одинаково</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.samePrice}</div>
        </Card>
      </div>

      <Table
        rowKey="key"
        columns={columns}
        dataSource={filteredRows}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        scroll={{ x: 1400 }}
        locale={{ emptyText: 'Нет совпадений по фильтру' }}
        size="small"
      />
    </div>
  );
}
