import { useMemo, useState, type CSSProperties } from 'react';
import { Badge, Button, Card, Input, Select, Space, Table, Tabs, Tag, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import BackButton from '../components/BackButton';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  PRICE_ROWS,
  type Competitor,
  type MatchType,
  type PriceRow,
} from './priceComparisonData';
import {
  OUR_ONLY_ROWS,
  THEIR_ONLY_ROWS,
  type OurOnlyRow,
  type TheirOnlyRow,
} from './uniqueProductsComparisonData';

// ─── Shared ─────────────────────────────────────────────────────────────────

const competitorColor: Record<Competitor, string> = {
  Yann: 'blue',
  'Bit Trade': 'cyan',
  'Avanta Trade': 'gold',
  'Foil Trading': 'magenta',
};

function formatMoney(value: number | null): string {
  if (value === null) return '—';
  return `${value.toLocaleString('ru-RU')} сум`;
}

// ─── Tab 1: All Competitor Products ─────────────────────────────────────────

type CompetitorRow = {
  key: string;
  competitor: Competitor;
  category: string;
  productName: string;
  price: number | null;
  hasMatch: boolean;
  ourAnalog?: string;
  ourPrice?: number;
  matchType?: MatchType;
};

const ALL_COMPETITOR_ROWS: CompetitorRow[] = [
  ...PRICE_ROWS.map((r) => ({
    key: `m-${r.key}`,
    competitor: r.competitor,
    category: r.category,
    productName: r.competitorProduct,
    price: r.competitorPrice,
    hasMatch: true,
    ourAnalog: r.ourProduct,
    ourPrice: r.ourPrice,
    matchType: r.matchType,
  })),
  ...THEIR_ONLY_ROWS.map((r) => ({
    key: `u-${r.key}`,
    competitor: r.competitor,
    category: r.category,
    productName: r.name,
    price: r.price,
    hasMatch: false,
  })),
];

function CompetitorProductsTab() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [competitor, setCompetitor] = useState<'all' | Competitor>('all');
  const [category, setCategory] = useState('all');
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unique'>('all');

  const competitors = useMemo(
    () => ['all', ...Array.from(new Set(ALL_COMPETITOR_ROWS.map((r) => r.competitor)))],
    [],
  );
  const categories = useMemo(
    () => ['all', ...Array.from(new Set(ALL_COMPETITOR_ROWS.map((r) => r.category))).sort()],
    [],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ALL_COMPETITOR_ROWS.filter((r) => {
      if (competitor !== 'all' && r.competitor !== competitor) return false;
      if (category !== 'all' && r.category !== category) return false;
      if (matchFilter === 'matched' && !r.hasMatch) return false;
      if (matchFilter === 'unique' && r.hasMatch) return false;
      if (!q) return true;
      return (
        r.productName.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        (r.ourAnalog?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [search, competitor, category, matchFilter]);

  const stats = useMemo(() => ({
    total: filtered.length,
    matched: filtered.filter((r) => r.hasMatch).length,
    unique: filtered.filter((r) => !r.hasMatch).length,
  }), [filtered]);

  const columns: ColumnsType<CompetitorRow> = [
    {
      title: 'Товар конкурента',
      dataIndex: 'productName',
      render: (value: string, row) => (
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{row.category}</Typography.Text>
          <div>{value}</div>
        </div>
      ),
    },
    {
      title: 'Компания',
      dataIndex: 'competitor',
      width: 150,
      render: (value: Competitor) => <Tag color={competitorColor[value]}>{value}</Tag>,
    },
    {
      title: 'Цена конкурента',
      dataIndex: 'price',
      width: 160,
      align: 'right',
      render: (value: number | null) => formatMoney(value),
    },
    {
      title: 'Наш аналог',
      dataIndex: 'ourAnalog',
      width: 280,
      render: (value?: string, row?: CompetitorRow) =>
        value ? (
          <div>
            <div style={{ fontSize: 12 }}>{value}</div>
            {row?.matchType && (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {row.matchType} совпадение
              </Typography.Text>
            )}
          </div>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Наша цена',
      dataIndex: 'ourPrice',
      width: 140,
      align: 'right',
      render: (value?: number) => (value !== undefined ? formatMoney(value) : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: 'Статус',
      key: 'status',
      width: 140,
      render: (_: unknown, row: CompetitorRow) =>
        row.hasMatch ? (
          <Badge status="success" text="Сопоставлен" />
        ) : (
          <Badge status="warning" text="Только у них" />
        ),
    },
  ];

  return (
    <>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 16 }}>
        <Card size="small">
          <Typography.Text type="secondary">Всего товаров</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">Есть аналог у нас</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#389e0d' }}>{stats.matched}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">Только у конкурентов</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#d48806' }}>{stats.unique}</div>
        </Card>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Поиск по товару, категории, аналогу..."
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: isMobile ? '100%' : 320 }}
        />
        <Select
          value={competitor}
          onChange={setCompetitor}
          style={{ width: isMobile ? '100%' : 200 }}
          options={competitors.map((v) => ({ value: v, label: v === 'all' ? 'Компания: все' : v }))}
        />
        <Select
          value={category}
          onChange={setCategory}
          style={{ width: isMobile ? '100%' : 260 }}
          options={categories.map((v) => ({ value: v, label: v === 'all' ? 'Категория: все' : v }))}
        />
        <Select
          value={matchFilter}
          onChange={setMatchFilter}
          style={{ width: isMobile ? '100%' : 200 }}
          options={[
            { value: 'all', label: 'Статус: все' },
            { value: 'matched', label: 'Есть аналог' },
            { value: 'unique', label: 'Только у них' },
          ]}
        />
      </Space>

      <Table<CompetitorRow>
        rowKey="key"
        columns={columns}
        dataSource={filtered}
        pagination={{ pageSize: 25, showSizeChanger: true }}
        scroll={{ x: 1200 }}
        locale={{ emptyText: 'Нет товаров по фильтру' }}
        size="small"
      />
    </>
  );
}

// ─── Tab 2: Unique Products ──────────────────────────────────────────────────

function UniqueProductsTab() {
  const isMobile = useIsMobile();
  const [subTab, setSubTab] = useState<'them' | 'us'>('them');
  const [search, setSearch] = useState('');
  const [competitor, setCompetitor] = useState<'all' | Competitor>('all');
  const [category, setCategory] = useState('all');

  const competitors = useMemo(
    () => ['all', ...Array.from(new Set(THEIR_ONLY_ROWS.map((r) => r.competitor)))],
    [],
  );
  const categoriesForThem = useMemo(
    () => ['all', ...Array.from(new Set(THEIR_ONLY_ROWS.map((r) => r.category))).sort()],
    [],
  );
  const categoriesForUs = useMemo(
    () => ['all', ...Array.from(new Set(OUR_ONLY_ROWS.map((r) => r.category))).sort()],
    [],
  );

  const filteredThem = useMemo(() => {
    const q = search.trim().toLowerCase();
    return THEIR_ONLY_ROWS.filter((r) => {
      if (competitor !== 'all' && r.competitor !== competitor) return false;
      if (category !== 'all' && r.category !== category) return false;
      return !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
    });
  }, [search, competitor, category]);

  const filteredUs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return OUR_ONLY_ROWS.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      return !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
    });
  }, [search, category]);

  const themColumns: ColumnsType<TheirOnlyRow> = [
    {
      title: 'Товар конкурента',
      dataIndex: 'name',
      render: (value: string, row) => (
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{row.category}</Typography.Text>
          <div>{value}</div>
        </div>
      ),
    },
    {
      title: 'Компания',
      dataIndex: 'competitor',
      width: 150,
      render: (value: Competitor) => <Tag color={competitorColor[value]}>{value}</Tag>,
    },
    {
      title: 'Их цена',
      dataIndex: 'price',
      width: 180,
      align: 'right',
      render: (value: number | null) =>
        value === null ? (
          <Typography.Text type="secondary">— (договорная)</Typography.Text>
        ) : (
          formatMoney(value)
        ),
    },
  ];

  const usColumns: ColumnsType<OurOnlyRow> = [
    {
      title: 'Наш товар',
      dataIndex: 'name',
      render: (value: string, row) => (
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{row.category}</Typography.Text>
          <div>{value}</div>
        </div>
      ),
    },
    { title: 'Наша цена', dataIndex: 'price', width: 200, align: 'right' },
    {
      title: 'Примечание',
      dataIndex: 'note',
      width: 280,
      render: (value?: string) => value ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
  ];

  const total = subTab === 'them' ? filteredThem.length : filteredUs.length;

  return (
    <>
      <Tabs
        activeKey={subTab}
        size="small"
        onChange={(key) => {
          setSubTab(key as 'them' | 'us');
          setSearch('');
          setCompetitor('all');
          setCategory('all');
        }}
        items={[
          { key: 'them', label: `У них есть, у нас нет (${THEIR_ONLY_ROWS.length})` },
          { key: 'us', label: `У нас есть, у них нет (${OUR_ONLY_ROWS.length})` },
        ]}
        style={{ marginBottom: 8 }}
      />

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 16 }}>
        <Card size="small">
          <Typography.Text type="secondary">
            {subTab === 'them' ? 'Товаров только у них' : 'Товаров только у нас'}
          </Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{total}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">Категорий</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>
            {subTab === 'them'
              ? new Set(filteredThem.map((r) => r.category)).size
              : new Set(filteredUs.map((r) => r.category)).size}
          </div>
        </Card>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Поиск по названию или категории..."
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: isMobile ? '100%' : 340 }}
        />
        {subTab === 'them' && (
          <Select
            value={competitor}
            onChange={setCompetitor}
            style={{ width: isMobile ? '100%' : 200 }}
            options={competitors.map((v) => ({ value: v, label: v === 'all' ? 'Компания: все' : v }))}
          />
        )}
        <Select
          value={category}
          onChange={setCategory}
          style={{ width: isMobile ? '100%' : 260 }}
          options={(subTab === 'them' ? categoriesForThem : categoriesForUs).map((v) => ({
            value: v,
            label: v === 'all' ? 'Категория: все' : v,
          }))}
        />
      </Space>

      {subTab === 'them' ? (
        <Table<TheirOnlyRow>
          rowKey="key"
          columns={themColumns}
          dataSource={filteredThem}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 800 }}
          locale={{ emptyText: 'Нет товаров по фильтру' }}
          size="small"
        />
      ) : (
        <Table<OurOnlyRow>
          rowKey="key"
          columns={usColumns}
          dataSource={filteredUs}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 800 }}
          locale={{ emptyText: 'Нет товаров по фильтру' }}
          size="small"
        />
      )}
    </>
  );
}

// ─── Tab 3: Price Comparison ─────────────────────────────────────────────────

const COLOR_WE_CHEAPER = '#389e0d';
const COLOR_THEY_CHEAPER = '#cf1322';

type RelationFilter = 'all' | 'they_cheaper' | 'we_cheaper' | 'same';
type TheirPricePick = number | 'missing' | null;

function priceDelta(ourPrice: number, competitorPrice: number | null) {
  if (competitorPrice === null || ourPrice <= 0) return null;
  const diff = competitorPrice - ourPrice;
  const percent = Math.round((diff / ourPrice) * 100);
  return { diff, percent };
}

function clickableStyle(active?: boolean): CSSProperties {
  return { cursor: 'pointer', borderRadius: 4, textDecoration: active ? 'underline' : undefined, outline: 'none' };
}

function PriceComparisonTab() {
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [competitor, setCompetitor] = useState<'all' | Competitor>('all');
  const [category, setCategory] = useState<string>('all');
  const [matchType, setMatchType] = useState<'all' | MatchType>('all');
  const [relationFilter, setRelationFilter] = useState<RelationFilter>('all');
  const [pickedOurPrice, setPickedOurPrice] = useState<number | null>(null);
  const [pickedTheirPrice, setPickedTheirPrice] = useState<TheirPricePick>(null);

  const categories = useMemo(() => ['all', ...Array.from(new Set(PRICE_ROWS.map((r) => r.category)))], []);
  const competitors = useMemo(() => ['all', ...Array.from(new Set(PRICE_ROWS.map((r) => r.competitor)))], []);

  const rowsAfterDropdown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PRICE_ROWS.filter((r) => {
      if (competitor !== 'all' && r.competitor !== competitor) return false;
      if (category !== 'all' && r.category !== category) return false;
      if (matchType !== 'all' && r.matchType !== matchType) return false;
      return !q || r.ourProduct.toLowerCase().includes(q) || r.competitorProduct.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
    });
  }, [category, competitor, matchType, search]);

  const stats = useMemo(() => {
    const comparable = rowsAfterDropdown.filter((r) => r.competitorPrice !== null);
    return {
      total: rowsAfterDropdown.length,
      theyAreCheaper: comparable.filter((r) => (r.competitorPrice as number) < r.ourPrice).length,
      weAreCheaper: comparable.filter((r) => (r.competitorPrice as number) > r.ourPrice).length,
      samePrice: comparable.filter((r) => r.competitorPrice === r.ourPrice).length,
    };
  }, [rowsAfterDropdown]);

  const filteredRows = useMemo(() => {
    return rowsAfterDropdown.filter((r) => {
      const cp = r.competitorPrice;
      if (relationFilter === 'they_cheaper' && (cp === null || cp >= r.ourPrice)) return false;
      if (relationFilter === 'we_cheaper' && (cp === null || cp <= r.ourPrice)) return false;
      if (relationFilter === 'same' && (cp === null || cp !== r.ourPrice)) return false;
      if (pickedOurPrice !== null && r.ourPrice !== pickedOurPrice) return false;
      if (pickedTheirPrice !== null) {
        if (pickedTheirPrice === 'missing' && r.competitorPrice !== null) return false;
        if (pickedTheirPrice !== 'missing' && r.competitorPrice !== pickedTheirPrice) return false;
      }
      return true;
    });
  }, [pickedOurPrice, pickedTheirPrice, relationFilter, rowsAfterDropdown]);

  const hasQuickFilter = relationFilter !== 'all' || pickedOurPrice !== null || pickedTheirPrice !== null;

  const clearQuickFilters = () => {
    setRelationFilter('all');
    setPickedOurPrice(null);
    setPickedTheirPrice(null);
  };

  const toggleRelation = (next: RelationFilter) => {
    setPickedOurPrice(null);
    setPickedTheirPrice(null);
    setRelationFilter((prev) => (prev === next ? 'all' : next));
  };

  const statCardStyle = (active: boolean): CSSProperties => ({
    cursor: 'pointer',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    borderColor: active ? token.colorPrimary : undefined,
    boxShadow: active ? `0 0 0 1px ${token.colorPrimary}` : undefined,
  });

  const columns: ColumnsType<PriceRow> = [
    {
      title: 'Наш товар (Polygraph Business)',
      dataIndex: 'ourProduct',
      width: 280,
      render: (value: string, row) => (
        <div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 11, cursor: 'pointer' }}
            onClick={() => setCategory((c) => (c === row.category ? 'all' : row.category))}
          >
            {row.category}
          </Typography.Text>
          <div
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer', marginTop: 2 }}
            onClick={() => setCategory((c) => (c === row.category ? 'all' : row.category))}
            onKeyDown={(e) => { if (e.key === 'Enter') setCategory((c) => (c === row.category ? 'all' : row.category)); }}
          >
            {value}
          </div>
        </div>
      ),
    },
    {
      title: 'Товар конкурента',
      dataIndex: 'competitorProduct',
      width: 300,
      render: (value: string, row) => (
        <div>
          <div>{value}</div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{row.matchType} совпадение</Typography.Text>
        </div>
      ),
    },
    {
      title: 'Компания',
      dataIndex: 'competitor',
      width: 140,
      render: (value: Competitor) => (
        <span
          role="button"
          tabIndex={0}
          style={{ display: 'inline-block', cursor: 'pointer' }}
          onClick={() => setCompetitor((c) => (c === value ? 'all' : value))}
          onKeyDown={(e) => { if (e.key === 'Enter') setCompetitor((c) => (c === value ? 'all' : value)); }}
        >
          <Tag color={competitorColor[value]}>{value}</Tag>
        </span>
      ),
    },
    {
      title: 'Наша цена',
      dataIndex: 'ourPrice',
      width: 130,
      align: 'right',
      render: (value: number) => (
        <span
          role="button"
          tabIndex={0}
          style={clickableStyle(pickedOurPrice === value)}
          onClick={() => { setPickedTheirPrice(null); setPickedOurPrice((p) => (p === value ? null : value)); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPickedTheirPrice(null); setPickedOurPrice((p) => (p === value ? null : value)); } }}
        >
          {formatMoney(value)}
        </span>
      ),
    },
    {
      title: 'Их цена',
      dataIndex: 'competitorPrice',
      width: 130,
      align: 'right',
      render: (value: number | null) => {
        const active = value === null ? pickedTheirPrice === 'missing' : pickedTheirPrice === value;
        return (
          <span
            role="button"
            tabIndex={0}
            style={clickableStyle(!!active)}
            onClick={() => {
              setPickedOurPrice(null);
              if (value === null) setPickedTheirPrice((p) => (p === 'missing' ? null : 'missing'));
              else setPickedTheirPrice((p) => (p === value ? null : value));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPickedOurPrice(null);
                if (value === null) setPickedTheirPrice((p) => (p === 'missing' ? null : 'missing'));
                else setPickedTheirPrice((p) => (p === value ? null : value));
              }
            }}
          >
            {formatMoney(value)}
          </span>
        );
      },
    },
    {
      title: 'Разница',
      key: 'diff',
      width: 130,
      align: 'right',
      render: (_, row) => {
        const delta = priceDelta(row.ourPrice, row.competitorPrice);
        if (!delta) return '—';
        const color = delta.diff > 0 ? COLOR_WE_CHEAPER : delta.diff < 0 ? COLOR_THEY_CHEAPER : undefined;
        return (
          <span
            role="button"
            tabIndex={0}
            style={{ color, ...clickableStyle(false) }}
            onClick={() => { setPickedOurPrice(null); setPickedTheirPrice(null); if (delta.diff < 0) toggleRelation('they_cheaper'); else if (delta.diff > 0) toggleRelation('we_cheaper'); else toggleRelation('same'); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPickedOurPrice(null); setPickedTheirPrice(null); if (delta.diff < 0) toggleRelation('they_cheaper'); else if (delta.diff > 0) toggleRelation('we_cheaper'); else toggleRelation('same'); } }}
          >
            {delta.diff > 0 ? '+' : ''}{formatMoney(delta.diff)}
          </span>
        );
      },
    },
    {
      title: '%',
      key: 'percent',
      width: 90,
      align: 'right',
      render: (_, row) => {
        const delta = priceDelta(row.ourPrice, row.competitorPrice);
        if (!delta) return '—';
        const color = delta.percent > 0 ? COLOR_WE_CHEAPER : delta.percent < 0 ? COLOR_THEY_CHEAPER : undefined;
        return (
          <span style={{ color, fontWeight: 600 }}>
            {delta.percent > 0 ? '+' : ''}{delta.percent}%
          </span>
        );
      },
    },
  ];

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
        Карточки и колонка «Разница» фильтруют по соотношению цен. Клик по категории, компании или цене — быстрый фильтр.
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Поиск по товару или категории..."
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: isMobile ? '100%' : 300 }}
        />
        <Select
          value={competitor}
          onChange={setCompetitor}
          style={{ width: isMobile ? '100%' : 200 }}
          options={competitors.map((v) => ({ value: v, label: v === 'all' ? 'Компания: все' : v }))}
        />
        <Select
          value={category}
          onChange={setCategory}
          style={{ width: isMobile ? '100%' : 240 }}
          options={categories.map((v) => ({ value: v, label: v === 'all' ? 'Категория: все' : v }))}
        />
        <Select
          value={matchType}
          onChange={setMatchType}
          style={{ width: isMobile ? '100%' : 200 }}
          options={[
            { value: 'all', label: 'Совпадение: все' },
            { value: 'Точное', label: 'Точное' },
            { value: 'Потенциальное', label: 'Потенциальное' },
          ]}
        />
        {hasQuickFilter && (
          <Button type="link" size="small" onClick={clearQuickFilters} style={{ padding: 0 }}>
            Сбросить быстрый фильтр
          </Button>
        )}
      </Space>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 16 }}>
        <Card size="small" style={statCardStyle(false)} role="button" tabIndex={0} onClick={clearQuickFilters} onKeyDown={(e) => { if (e.key === 'Enter') clearQuickFilters(); }}>
          <Typography.Text type="secondary">Совпадений</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total}</div>
        </Card>
        <Card size="small" style={statCardStyle(relationFilter === 'they_cheaper')} role="button" tabIndex={0} onClick={() => toggleRelation('they_cheaper')} onKeyDown={(e) => { if (e.key === 'Enter') toggleRelation('they_cheaper'); }}>
          <Typography.Text type="secondary">У них дешевле</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: COLOR_THEY_CHEAPER }}>{stats.theyAreCheaper}</div>
        </Card>
        <Card size="small" style={statCardStyle(relationFilter === 'we_cheaper')} role="button" tabIndex={0} onClick={() => toggleRelation('we_cheaper')} onKeyDown={(e) => { if (e.key === 'Enter') toggleRelation('we_cheaper'); }}>
          <Typography.Text type="secondary">У нас дешевле</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: COLOR_WE_CHEAPER }}>{stats.weAreCheaper}</div>
        </Card>
        <Card size="small" style={statCardStyle(relationFilter === 'same')} role="button" tabIndex={0} onClick={() => toggleRelation('same')} onKeyDown={(e) => { if (e.key === 'Enter') toggleRelation('same'); }}>
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
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MarketAnalysisPage() {
  const [activeTab, setActiveTab] = useState('competitors');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <BackButton fallback="/analytics" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Анализ рынка
        </Typography.Title>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'competitors',
            label: `Товары конкурентов (${ALL_COMPETITOR_ROWS.length})`,
            children: <CompetitorProductsTab />,
          },
          {
            key: 'unique',
            label: `Уникальные товары (${THEIR_ONLY_ROWS.length + OUR_ONLY_ROWS.length})`,
            children: <UniqueProductsTab />,
          },
          {
            key: 'prices',
            label: `Сравнение цен (${PRICE_ROWS.length})`,
            children: <PriceComparisonTab />,
          },
        ]}
      />
    </div>
  );
}
