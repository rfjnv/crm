import { useMemo, useState } from 'react';
import { Card, Input, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import BackButton from '../components/BackButton';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  OUR_ONLY_ROWS,
  THEIR_ONLY_ROWS,
  type Competitor,
  type OurOnlyRow,
  type TheirOnlyRow,
} from './uniqueProductsComparisonData';

function formatCompetitorPrice(value: number | null): string {
  if (value === null) return '— (договорная)';
  return `${value.toLocaleString('ru-RU')} сум`;
}

const competitorColor: Record<Competitor, string> = {
  Yann: 'blue',
  'Bit Trade': 'cyan',
  'Avanta Trade': 'gold',
  'Foil Trading': 'magenta',
};

export default function UniqueProductsComparisonPage() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'them' | 'us'>('them');
  const [search, setSearch] = useState('');
  const [competitor, setCompetitor] = useState<'all' | Competitor>('all');
  const [category, setCategory] = useState('all');

  const competitors = useMemo(
    () => ['all', ...Array.from(new Set(THEIR_ONLY_ROWS.map((row) => row.competitor)))],
    [],
  );
  const categoriesForThem = useMemo(
    () => ['all', ...Array.from(new Set(THEIR_ONLY_ROWS.map((row) => row.category)))],
    [],
  );
  const categoriesForUs = useMemo(
    () => ['all', ...Array.from(new Set(OUR_ONLY_ROWS.map((row) => row.category)))],
    [],
  );

  const filteredThem = useMemo(() => {
    const q = search.trim().toLowerCase();
    return THEIR_ONLY_ROWS.filter((row) => {
      if (competitor !== 'all' && row.competitor !== competitor) return false;
      if (category !== 'all' && row.category !== category) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.category.toLowerCase().includes(q);
    });
  }, [category, competitor, search]);

  const filteredUs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return OUR_ONLY_ROWS.filter((row) => {
      if (category !== 'all' && row.category !== category) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.category.toLowerCase().includes(q);
    });
  }, [category, search]);

  const stats = useMemo(() => {
    if (tab === 'them') {
      return {
        total: filteredThem.length,
        competitorsCount: new Set(filteredThem.map((r) => r.competitor)).size,
        categoriesCount: new Set(filteredThem.map((r) => r.category)).size,
      };
    }
    return {
      total: filteredUs.length,
      competitorsCount: 1,
      categoriesCount: new Set(filteredUs.map((r) => r.category)).size,
    };
  }, [filteredThem, filteredUs, tab]);

  const themColumns: ColumnsType<TheirOnlyRow> = [
    { title: 'Название товара', dataIndex: 'name' },
    {
      title: 'Компания',
      dataIndex: 'competitor',
      width: 170,
      render: (value: Competitor) => <Tag color={competitorColor[value]}>{value}</Tag>,
    },
    { title: 'Категория', dataIndex: 'category', width: 240 },
    {
      title: 'Цена у них',
      dataIndex: 'price',
      width: 180,
      align: 'right',
      render: (value: number | null) => formatCompetitorPrice(value),
    },
  ];

  const usColumns: ColumnsType<OurOnlyRow> = [
    { title: 'Название товара', dataIndex: 'name' },
    { title: 'Категория', dataIndex: 'category', width: 230 },
    { title: 'Наша цена', dataIndex: 'price', width: 170, align: 'right' },
    { title: 'Примечание', dataIndex: 'note', width: 260, render: (value?: string) => value || '—' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <BackButton fallback="/analytics" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Уникальные товары
        </Typography.Title>
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key as 'them' | 'us');
          setCompetitor('all');
          setCategory('all');
          setSearch('');
        }}
        items={[
          { key: 'them', label: 'У них есть, у нас нет' },
          { key: 'us', label: 'У нас есть, у них нет' },
        ]}
      />

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: 16 }}>
        <Card size="small">
          <Typography.Text type="secondary">{tab === 'them' ? 'Товаров у них, нет у нас' : 'Товаров только у нас'}</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">{tab === 'them' ? 'Компаний' : 'Наше преимущество'}</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>
            {tab === 'them' ? stats.competitorsCount : 'ассортимент'}
          </div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">Категорий</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.categoriesCount}</div>
        </Card>
      </div>

      <Space wrap style={{ marginBottom: 16, width: '100%' }}>
        <Input.Search
          placeholder="Поиск по названию или категории..."
          allowClear
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ width: isMobile ? '100%' : 360 }}
        />
        {tab === 'them' && (
          <Select
            value={competitor}
            onChange={(value) => setCompetitor(value)}
            style={{ width: isMobile ? '100%' : 220 }}
            options={competitors.map((value) => ({
              value,
              label: value === 'all' ? 'Компания: все' : value,
            }))}
          />
        )}
        <Select
          value={category}
          onChange={(value) => setCategory(value)}
          style={{ width: isMobile ? '100%' : 280 }}
          options={(tab === 'them' ? categoriesForThem : categoriesForUs).map((value) => ({
            value,
            label: value === 'all' ? 'Категория: все' : value,
          }))}
        />
      </Space>

      <Table
        rowKey="key"
        columns={tab === 'them' ? themColumns : usColumns}
        dataSource={tab === 'them' ? filteredThem : filteredUs}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        scroll={{ x: 1200 }}
        locale={{ emptyText: 'Нет товаров по фильтру' }}
        size="small"
      />
    </div>
  );
}

