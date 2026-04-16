import { useMemo, useState } from 'react';
import { Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import BackButton from '../components/BackButton';
import { useIsMobile } from '../hooks/useIsMobile';

type MatchType = 'Точное' | 'Потенциальное';

type PriceRow = {
  key: string;
  category: string;
  ourProduct: string;
  competitorProduct: string;
  competitor: 'Yann' | 'Bit Trade' | 'Avanta Trade' | 'Foil Trading';
  ourPrice: number;
  competitorPrice: number | null;
  matchType: MatchType;
};

const PRICE_ROWS: PriceRow[] = [
  { key: '1', category: 'Самоклеящаяся бумага', ourProduct: 'с насечкой (Китай), глянец, 50×35', competitorProduct: 'Самоклеящаяся бумага 35×50, 195 г', competitor: 'Yann', ourPrice: 1000, competitorPrice: 1000, matchType: 'Точное' },
  { key: '2', category: 'Самоклеящаяся бумага', ourProduct: 'без насечки (Китай), 50×35', competitorProduct: 'Самоклеящаяся бумага 35×50, 195 г', competitor: 'Yann', ourPrice: 1000, competitorPrice: 1000, matchType: 'Точное' },
  { key: '3', category: 'Самоклеящаяся бумага', ourProduct: 'с насечкой (Китай), глянец, 50×70', competitorProduct: 'Самоклеящаяся бумага 50×70, 195 г', competitor: 'Yann', ourPrice: 2000, competitorPrice: 2000, matchType: 'Точное' },
  { key: '4', category: 'Самоклеящаяся бумага', ourProduct: 'без насечки (Китай), 50×70', competitorProduct: 'Самоклеящаяся бумага 50×70, 195 г', competitor: 'Yann', ourPrice: 2000, competitorPrice: 2000, matchType: 'Точное' },
  { key: '5', category: 'Самоклеящаяся бумага', ourProduct: 'с насечкой (Китай), глянец, 70×100', competitorProduct: 'Самоклеящаяся бумага 70×100, 195 г', competitor: 'Yann', ourPrice: 4000, competitorPrice: 4000, matchType: 'Точное' },
  { key: '6', category: 'Самоклеящаяся бумага', ourProduct: 'с насечкой (Китай), глянец, 50×70', competitorProduct: 'Самоклеящаяся в листах (глянцевая) 50×70 (slit/non-slit)', competitor: 'Avanta Trade', ourPrice: 2000, competitorPrice: 1800, matchType: 'Потенциальное' },
  { key: '7', category: 'Самоклеящаяся бумага', ourProduct: 'с насечкой (Китай), глянец, 70×100', competitorProduct: 'Самоклеящаяся в листах (глянцевая) 70×100 (slit/non-slit)', competitor: 'Avanta Trade', ourPrice: 4000, competitorPrice: 3600, matchType: 'Потенциальное' },
  { key: '8', category: 'Самоклеящаяся бумага', ourProduct: 'с насечкой (ТУРЦИЯ), полуглянец, 50×70', competitorProduct: 'Турция ADCOAT (полуглянцевая) 45×64 slit/non-slit', competitor: 'Avanta Trade', ourPrice: 2700, competitorPrice: 2500, matchType: 'Потенциальное' },
  { key: '9', category: 'Самоклеящаяся бумага', ourProduct: 'с насечкой (ТУРЦИЯ), полуглянец, 70×100', competitorProduct: 'Турция ADCOAT (полуглянцевая) 70×100 slit/non-slit', competitor: 'Avanta Trade', ourPrice: 5400, competitorPrice: 6000, matchType: 'Точное' },
  { key: '10', category: 'Мелованная бумага', ourProduct: 'HI-KOTE 70×100 (глянец), 170 г/м²', competitorProduct: 'HiKote C2S Art Paper глянцевая, 150 г, 70×100', competitor: 'Yann', ourPrice: 1790, competitorPrice: 1628, matchType: 'Потенциальное' },
  { key: '11', category: 'Мелованная бумага', ourProduct: 'HI-KOTE 70×100 (глянец), 250 г/м²', competitorProduct: 'HiKote C2S Art Paper глянцевая, 250 г, 70×100', competitor: 'Yann', ourPrice: 2630, competitorPrice: 2190, matchType: 'Точное' },
  { key: '12', category: 'Мелованная бумага', ourProduct: 'HI-KOTE 70×100 (глянец), 250 г/м²', competitorProduct: 'HiKote C2S Art Paper глянцевая, 300 г, 70×100', competitor: 'Yann', ourPrice: 2630, competitorPrice: 2625, matchType: 'Потенциальное' },
  { key: '13', category: 'Фольга для горячего тиснения', ourProduct: 'ЗОЛОТАЯ (64×120 м)', competitorProduct: 'Фольга горячего тиснения Золотая, 64×120 м', competitor: 'Avanta Trade', ourPrice: 150000, competitorPrice: 150000, matchType: 'Точное' },
  { key: '14', category: 'Фольга для горячего тиснения', ourProduct: 'СЕРЕБРЯНАЯ (64×120 м)', competitorProduct: 'Фольга горячего тиснения Серебряная, 64×120 м', competitor: 'Avanta Trade', ourPrice: 150000, competitorPrice: 150000, matchType: 'Точное' },
  { key: '15', category: 'Фольга для горячего тиснения', ourProduct: 'ЗЕЛЕНАЯ (64×120 м)', competitorProduct: 'Фольга горячего тиснения Зелёная, 64×120 м', competitor: 'Avanta Trade', ourPrice: 230000, competitorPrice: 230000, matchType: 'Точное' },
  { key: '16', category: 'Фольга для горячего тиснения', ourProduct: 'КРАСНАЯ / СИНЯЯ / ТЕМНО-СИНЯЯ / ФИОЛЕТОВАЯ / ЧЁРНАЯ', competitorProduct: 'Фольга горячего тиснения Красная, 64×120 м', competitor: 'Avanta Trade', ourPrice: 230000, competitorPrice: 230000, matchType: 'Точное' },
  { key: '17', category: 'Фольга для горячего тиснения', ourProduct: 'КРАСНАЯ / СИНЯЯ / ТЕМНО-СИНЯЯ / ФИОЛЕТОВАЯ / ЧЁРНАЯ', competitorProduct: 'Фольга горячего тиснения Фиолетовая, 64×120 м', competitor: 'Avanta Trade', ourPrice: 230000, competitorPrice: 230000, matchType: 'Точное' },
  { key: '18', category: 'Фольга для горячего тиснения', ourProduct: 'БЕЛАЯ (64×120 м)', competitorProduct: 'Фольга горячего тиснения Белая, 64×120 м', competitor: 'Avanta Trade', ourPrice: 280000, competitorPrice: 230000, matchType: 'Точное' },
  { key: '19', category: 'Фольга для горячего тиснения', ourProduct: 'ГОЛОГРАММА (64×120 м)', competitorProduct: 'Фольга горячего тиснения Голограмма Золотистая, 64×120 м', competitor: 'Avanta Trade', ourPrice: 250000, competitorPrice: 250000, matchType: 'Точное' },
  { key: '20', category: 'Фольга для горячего тиснения', ourProduct: 'ЗОЛОТАЯ, 64×240 м', competitorProduct: 'Фольга горячего тиснения Золотая, 64×240 м', competitor: 'Avanta Trade', ourPrice: 300000, competitorPrice: 300000, matchType: 'Точное' },
  { key: '21', category: 'Фольга для горячего тиснения', ourProduct: 'СЕРЕБРЯНАЯ, 64×240 м', competitorProduct: 'Фольга горячего тиснения Серебряная, 64×240 м', competitor: 'Avanta Trade', ourPrice: 300000, competitorPrice: 300000, matchType: 'Точное' },
  { key: '22', category: 'Фольга для горячего тиснения', ourProduct: 'ЗОЛОТАЯ, 64×360 м', competitorProduct: 'Фольга горячего тиснения Золотая, 64×360 м', competitor: 'Avanta Trade', ourPrice: 450000, competitorPrice: 450000, matchType: 'Точное' },
  { key: '23', category: 'Фольга для горячего тиснения', ourProduct: 'СЕРЕБРЯНАЯ, 64×360 м', competitorProduct: 'Фольга горячего тиснения Серебряная, 64×360 м', competitor: 'Avanta Trade', ourPrice: 450000, competitorPrice: 450000, matchType: 'Точное' },
];

const competitorColor: Record<PriceRow['competitor'], string> = {
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
  const [competitor, setCompetitor] = useState<'all' | PriceRow['competitor']>('all');
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
      render: (value: PriceRow['competitor']) => (
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
