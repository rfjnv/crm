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

const COLOR_WE_CHEAPER = '#389e0d';
const COLOR_THEY_CHEAPER = '#cf1322';

type RelationFilter = 'all' | 'they_cheaper' | 'we_cheaper' | 'same';
type TheirPricePick = number | 'missing' | null;

function priceDelta(ourPrice: number, competitorPrice: number | null): { diff: number; percent: number } | null {
  if (competitorPrice === null || ourPrice <= 0) return null;
  const diff = competitorPrice - ourPrice;
  const percent = Math.round((diff / ourPrice) * 100);
  return { diff, percent };
}

function clickableStyle(active?: boolean): CSSProperties {
  return {
    cursor: 'pointer',
    borderRadius: 4,
    textDecoration: active ? 'underline' : undefined,
    outline: 'none',
  };
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
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [competitor, setCompetitor] = useState<'all' | Competitor>('all');
  const [category, setCategory] = useState('all');
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unique'>('all');
  const [relationFilter, setRelationFilter] = useState<RelationFilter>('all');
  const [pickedOurPrice, setPickedOurPrice] = useState<number | null>(null);
  const [pickedTheirPrice, setPickedTheirPrice] = useState<TheirPricePick>(null);

  const competitors = useMemo(
    () => ['all', ...Array.from(new Set(ALL_COMPETITOR_ROWS.map((r) => r.competitor)))],
    [],
  );
  const categories = useMemo(
    () => ['all', ...Array.from(new Set(ALL_COMPETITOR_ROWS.map((r) => r.category))).sort()],
    [],
  );

  const rowsAfterSelectors = useMemo(() => {
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

  const compareStats = useMemo(() => {
    const comparable = rowsAfterSelectors.filter(
      (r) => r.hasMatch && r.price !== null && r.ourPrice !== undefined,
    );
    return {
      total: rowsAfterSelectors.length,
      theyAreCheaper: comparable.filter((r) => (r.price as number) < (r.ourPrice as number)).length,
      weAreCheaper: comparable.filter((r) => (r.price as number) > (r.ourPrice as number)).length,
      samePrice: comparable.filter((r) => r.price === r.ourPrice).length,
    };
  }, [rowsAfterSelectors]);

  const filteredRows = useMemo(
    () => rowsAfterSelectors.filter((r) => {
      const comparable = Boolean(r.hasMatch && r.price !== null && r.ourPrice !== undefined);
      const cp = r.price;
      const op = r.ourPrice;

      if (relationFilter !== 'all') {
        if (!comparable) return false;
        if (relationFilter === 'they_cheaper' && (cp === null || cp >= op!)) return false;
        if (relationFilter === 'we_cheaper' && (cp === null || cp <= op!)) return false;
        if (relationFilter === 'same' && (cp === null || cp !== op)) return false;
      }

      if (pickedOurPrice !== null && (!comparable || op !== pickedOurPrice)) return false;

      if (pickedTheirPrice !== null) {
        if (pickedTheirPrice === 'missing') {
          if (cp !== null) return false;
        } else if (cp !== pickedTheirPrice) return false;
      }

      return true;
    }),
    [pickedOurPrice, pickedTheirPrice, relationFilter, rowsAfterSelectors],
  );

  const stats = useMemo(
    () => ({
      total: filteredRows.length,
      matched: filteredRows.filter((r) => r.hasMatch).length,
      unique: filteredRows.filter((r) => !r.hasMatch).length,
    }),
    [filteredRows],
  );

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

  const columns: ColumnsType<CompetitorRow> = [
    {
      title: 'Товар конкурента',
      dataIndex: 'productName',
      render: (value: string, row) => (
        <div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 11, cursor: 'pointer' }}
            onClick={() => setCategory((c) => (c === row.category ? 'all' : row.category))}
          >
            {row.category}
          </Typography.Text>
          <div>{value}</div>
        </div>
      ),
    },
    {
      title: 'Компания',
      dataIndex: 'competitor',
      width: 150,
      render: (value: Competitor) => (
        <span
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer', display: 'inline-block' }}
          onClick={() => setCompetitor((c) => (c === value ? 'all' : value))}
          onKeyDown={(e) => { if (e.key === 'Enter') setCompetitor((c) => (c === value ? 'all' : value)); }}
        >
          <Tag color={competitorColor[value]}>{value}</Tag>
        </span>
      ),
    },
    {
      title: 'Цена конкурента',
      dataIndex: 'price',
      width: 140,
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
              if (e.key !== 'Enter') return;
              setPickedOurPrice(null);
              if (value === null) setPickedTheirPrice((p) => (p === 'missing' ? null : 'missing'));
              else setPickedTheirPrice((p) => (p === value ? null : value));
            }}
          >
            {formatMoney(value)}
          </span>
        );
      },
    },
    {
      title: 'Наш аналог',
      dataIndex: 'ourAnalog',
      width: 240,
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
      width: 130,
      align: 'right',
      render: (value?: number) => (
        <span
          role="button"
          tabIndex={0}
          style={clickableStyle(value !== undefined && pickedOurPrice === value)}
          onClick={() => {
            if (value === undefined) return;
            setPickedTheirPrice(null);
            setPickedOurPrice((p) => (p === value ? null : value));
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || value === undefined) return;
            setPickedTheirPrice(null);
            setPickedOurPrice((p) => (p === value ? null : value));
          }}
        >
          {value !== undefined ? formatMoney(value) : <Typography.Text type="secondary">—</Typography.Text>}
        </span>
      ),
    },
    {
      title: 'Разница',
      key: 'diff',
      width: 120,
      align: 'right',
      render: (_: unknown, row: CompetitorRow) => {
        const delta = row.ourPrice !== undefined ? priceDelta(row.ourPrice, row.price) : null;
        if (!delta || row.price === null) return <Typography.Text type="secondary">—</Typography.Text>;
        const color = delta.diff > 0 ? COLOR_WE_CHEAPER : delta.diff < 0 ? COLOR_THEY_CHEAPER : undefined;
        return (
          <span
            role="button"
            tabIndex={0}
            style={{ color, ...clickableStyle(false), cursor: 'pointer' }}
            onClick={() => {
              setPickedOurPrice(null);
              setPickedTheirPrice(null);
              if (delta.diff < 0) toggleRelation('they_cheaper');
              else if (delta.diff > 0) toggleRelation('we_cheaper');
              else toggleRelation('same');
            }}
          >
            {delta.diff > 0 ? '+' : ''}{formatMoney(delta.diff)}
          </span>
        );
      },
    },
    {
      title: '%',
      key: 'pct',
      width: 76,
      align: 'right',
      render: (_: unknown, row: CompetitorRow) => {
        const delta = row.ourPrice !== undefined ? priceDelta(row.ourPrice, row.price) : null;
        if (!delta || row.price === null) return '—';
        const color = delta.percent > 0 ? COLOR_WE_CHEAPER : delta.percent < 0 ? COLOR_THEY_CHEAPER : undefined;
        return (
          <span style={{ color, fontWeight: 600 }}>
            {delta.percent > 0 ? '+' : ''}{delta.percent}%
          </span>
        );
      },
    },
    {
      title: 'Статус',
      key: 'status',
      width: 134,
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
          <Typography.Text type="secondary">Всего в списке</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">Есть аналог у нас</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: COLOR_WE_CHEAPER }}>{stats.matched}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">Только у конкурентов</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#d48806' }}>{stats.unique}</div>
        </Card>
      </div>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
        Как на «Сравнение цен»: карточки ниже и колонка «Разница» задают фильтр по соотношению цен. Клик по категории, компании
        или сумме в колонках цен — быстрый фильтр.
      </Typography.Paragraph>

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
        {hasQuickFilter && (
          <Button type="link" size="small" onClick={clearQuickFilters} style={{ padding: 0 }}>
            Сбросить быстрый фильтр
          </Button>
        )}
      </Space>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 16 }}>
        <Card
          size="small"
          style={statCardStyle(false)}
          role="button"
          tabIndex={0}
          onClick={clearQuickFilters}
          onKeyDown={(e) => { if (e.key === 'Enter') clearQuickFilters(); }}
        >
          <Typography.Text type="secondary">Все позиции (сброс)</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{compareStats.total}</div>
        </Card>
        <Card
          size="small"
          style={statCardStyle(relationFilter === 'they_cheaper')}
          role="button"
          tabIndex={0}
          onClick={() => toggleRelation('they_cheaper')}
          onKeyDown={(e) => { if (e.key === 'Enter') toggleRelation('they_cheaper'); }}
        >
          <Typography.Text type="secondary">У них дешевле</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: COLOR_THEY_CHEAPER }}>{compareStats.theyAreCheaper}</div>
        </Card>
        <Card
          size="small"
          style={statCardStyle(relationFilter === 'we_cheaper')}
          role="button"
          tabIndex={0}
          onClick={() => toggleRelation('we_cheaper')}
          onKeyDown={(e) => { if (e.key === 'Enter') toggleRelation('we_cheaper'); }}
        >
          <Typography.Text type="secondary">У нас дешевле</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: COLOR_WE_CHEAPER }}>{compareStats.weAreCheaper}</div>
        </Card>
        <Card
          size="small"
          style={statCardStyle(relationFilter === 'same')}
          role="button"
          tabIndex={0}
          onClick={() => toggleRelation('same')}
          onKeyDown={(e) => { if (e.key === 'Enter') toggleRelation('same'); }}
        >
          <Typography.Text type="secondary">Одинаково</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{compareStats.samePrice}</div>
        </Card>
      </div>

      <Table<CompetitorRow>
        rowKey="key"
        columns={columns}
        dataSource={filteredRows}
        pagination={{ pageSize: 25, showSizeChanger: true }}
        scroll={{ x: 1500 }}
        locale={{ emptyText: 'Нет товаров по фильтру' }}
        size="small"
      />
    </>
  );
}

// ─── Tab 2: Unique Products ──────────────────────────────────────────────────

function UniqueProductsTab() {
  const isMobile = useIsMobile();
  const { token } = theme.useToken();
  const [subTab, setSubTab] = useState<'them' | 'us'>('them');
  const [search, setSearch] = useState('');
  const [competitor, setCompetitor] = useState<'all' | Competitor>('all');
  const [category, setCategory] = useState('all');
  /** Быстрый отбор по типу цены (только «у них»). */
  const [themLineFilter, setThemLineFilter] = useState<'all' | 'priced' | 'unpriced'>('all');
  /** Клик по конкретной сумме в таблице (только «у них»). */
  const [pickedTheirPriceExact, setPickedTheirPriceExact] = useState<number | null>(null);
  /** Клик по тексту цены «только у нас». */
  const [pickedOurPriceText, setPickedOurPriceText] = useState<string | null>(null);

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

  const rowsThemBase = useMemo(() => {
    const q = search.trim().toLowerCase();
    return THEIR_ONLY_ROWS.filter((r) => {
      if (competitor !== 'all' && r.competitor !== competitor) return false;
      if (category !== 'all' && r.category !== category) return false;
      return !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
    });
  }, [search, competitor, category]);

  const rowsUsBase = useMemo(() => {
    const q = search.trim().toLowerCase();
    return OUR_ONLY_ROWS.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      return !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
    });
  }, [search, category]);

  const themStats = useMemo(
    () => ({
      total: rowsThemBase.length,
      priced: rowsThemBase.filter((r) => r.price !== null).length,
      unpriced: rowsThemBase.filter((r) => r.price === null).length,
    }),
    [rowsThemBase],
  );

  const filteredThem = useMemo(
    () => rowsThemBase.filter((r) => {
      if (themLineFilter === 'priced' && r.price === null) return false;
      if (themLineFilter === 'unpriced' && r.price !== null) return false;
      if (pickedTheirPriceExact !== null && r.price !== pickedTheirPriceExact) return false;
      return true;
    }),
    [pickedTheirPriceExact, rowsThemBase, themLineFilter],
  );

  const filteredUs = useMemo(
    () => rowsUsBase.filter((r) => {
      if (pickedOurPriceText !== null && r.price !== pickedOurPriceText) return false;
      return true;
    }),
    [pickedOurPriceText, rowsUsBase],
  );

  const hasQuickFilterThem = themLineFilter !== 'all' || pickedTheirPriceExact !== null;
  const hasQuickFilterUs = pickedOurPriceText !== null;

  const clearQuickThem = () => {
    setThemLineFilter('all');
    setPickedTheirPriceExact(null);
  };
  const clearQuickUs = () => setPickedOurPriceText(null);

  const statCardStyleU = (active: boolean): CSSProperties => ({
    cursor: 'pointer',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    borderColor: active ? token.colorPrimary : undefined,
    boxShadow: active ? `0 0 0 1px ${token.colorPrimary}` : undefined,
  });

  const themColumns: ColumnsType<TheirOnlyRow> = useMemo(
    () => [
      {
        title: 'Товар конкурента',
        dataIndex: 'name',
        render: (value: string, row) => (
          <div>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 11, cursor: 'pointer' }}
              onClick={() => setCategory((c) => (c === row.category ? 'all' : row.category))}
            >
              {row.category}
            </Typography.Text>
            <div>{value}</div>
          </div>
        ),
      },
      {
        title: 'Компания',
        dataIndex: 'competitor',
        width: 150,
        render: (value: Competitor) => (
          <span
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer', display: 'inline-block' }}
            onClick={() => setCompetitor((c) => (c === value ? 'all' : value))}
            onKeyDown={(e) => { if (e.key === 'Enter') setCompetitor((c) => (c === value ? 'all' : value)); }}
          >
            <Tag color={competitorColor[value]}>{value}</Tag>
          </span>
        ),
      },
      {
        title: 'Их цена',
        dataIndex: 'price',
        width: 200,
        align: 'right',
        render: (value: number | null) => {
          if (value === null) {
            const active = themLineFilter === 'unpriced' && pickedTheirPriceExact === null;
            return (
              <span
                role="button"
                tabIndex={0}
                style={clickableStyle(active)}
                onClick={() => {
                  setPickedTheirPriceExact(null);
                  setThemLineFilter((f) => (f === 'unpriced' ? 'all' : 'unpriced'));
                }}
              >
                <Typography.Text type="secondary">— (договорная)</Typography.Text>
              </span>
            );
          }
          const activeExact = pickedTheirPriceExact === value;
          return (
            <span
              role="button"
              tabIndex={0}
              style={clickableStyle(activeExact)}
              onClick={() => {
                setThemLineFilter('all');
                setPickedTheirPriceExact((p) => (p === value ? null : value));
              }}
            >
              {formatMoney(value)}
            </span>
          );
        },
      },
    ],
    [pickedTheirPriceExact, themLineFilter],
  );

  const usColumns: ColumnsType<OurOnlyRow> = useMemo(
    () => [
      {
        title: 'Наш товар',
        dataIndex: 'name',
        render: (value: string, row) => (
          <div>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 11, cursor: 'pointer' }}
              onClick={() => setCategory((c) => (c === row.category ? 'all' : row.category))}
            >
              {row.category}
            </Typography.Text>
            <div>{value}</div>
          </div>
        ),
      },
      {
        title: 'Наша цена',
        dataIndex: 'price',
        width: 220,
        align: 'right',
        render: (value: string) => (
          <span
            role="button"
            tabIndex={0}
            style={clickableStyle(pickedOurPriceText === value)}
            onClick={() => setPickedOurPriceText((p) => (p === value ? null : value))}
          >
            {value}
          </span>
        ),
      },
      {
        title: 'Примечание',
        dataIndex: 'note',
        width: 280,
        render: (value?: string) => value ?? <Typography.Text type="secondary">—</Typography.Text>,
      },
    ],
    [pickedOurPriceText],
  );

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
          clearQuickThem();
          clearQuickUs();
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

      {subTab === 'them' ? (
        <>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
            Как на «Сравнение цен»: карточки ниже — быстрый отбор по типу цены; клик по сумме — только строки с этой ценой;
            клик по категории или компании — фильтр по полю.
          </Typography.Paragraph>
          <Space wrap style={{ marginBottom: 16 }}>
            <Input.Search
              placeholder="Поиск по названию или категории..."
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: isMobile ? '100%' : 340 }}
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
              options={categoriesForThem.map((v) => ({
                value: v,
                label: v === 'all' ? 'Категория: все' : v,
              }))}
            />
            {hasQuickFilterThem && (
              <Button type="link" size="small" onClick={clearQuickThem} style={{ padding: 0 }}>
                Сбросить быстрый фильтр
              </Button>
            )}
          </Space>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 16 }}>
            <Card size="small" role="button" tabIndex={0} style={statCardStyleU(false)} onClick={clearQuickThem} onKeyDown={(e) => { if (e.key === 'Enter') clearQuickThem(); }}>
              <Typography.Text type="secondary">Все позиции</Typography.Text>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{themStats.total}</div>
            </Card>
            <Card
              size="small"
              role="button"
              tabIndex={0}
              style={statCardStyleU(themLineFilter === 'priced' && pickedTheirPriceExact === null)}
              onClick={() => {
                setPickedTheirPriceExact(null);
                setThemLineFilter((f) => (f === 'priced' ? 'all' : 'priced'));
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                setPickedTheirPriceExact(null);
                setThemLineFilter((f) => (f === 'priced' ? 'all' : 'priced'));
              }}
            >
              <Typography.Text type="secondary">С указанной ценой</Typography.Text>
              <div style={{ fontSize: 24, fontWeight: 600, color: token.colorPrimary }}>{themStats.priced}</div>
            </Card>
            <Card
              size="small"
              role="button"
              tabIndex={0}
              style={statCardStyleU(themLineFilter === 'unpriced')}
              onClick={() => {
                setPickedTheirPriceExact(null);
                setThemLineFilter((f) => (f === 'unpriced' ? 'all' : 'unpriced'));
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                setPickedTheirPriceExact(null);
                setThemLineFilter((f) => (f === 'unpriced' ? 'all' : 'unpriced'));
              }}
            >
              <Typography.Text type="secondary">Договорная / без суммы</Typography.Text>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#d48806' }}>{themStats.unpriced}</div>
            </Card>
          </div>
          <Table<TheirOnlyRow>
            rowKey="key"
            columns={themColumns}
            dataSource={filteredThem}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 820 }}
            locale={{ emptyText: 'Нет товаров по фильтру' }}
            size="small"
          />
        </>
      ) : (
        <>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
            Клик по тексту цены оставляет только строки с таким же значением; клик по категории — по категории.
          </Typography.Paragraph>
          <Space wrap style={{ marginBottom: 16 }}>
            <Input.Search
              placeholder="Поиск по названию или категории..."
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: isMobile ? '100%' : 340 }}
            />
            <Select
              value={category}
              onChange={setCategory}
              style={{ width: isMobile ? '100%' : 260 }}
              options={categoriesForUs.map((v) => ({
                value: v,
                label: v === 'all' ? 'Категория: все' : v,
              }))}
            />
            {hasQuickFilterUs && (
              <Button type="link" size="small" onClick={clearQuickUs} style={{ padding: 0 }}>
                Сбросить быстрый фильтр
              </Button>
            )}
          </Space>
          <Table<OurOnlyRow>
            rowKey="key"
            columns={usColumns}
            dataSource={filteredUs}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 900 }}
            locale={{ emptyText: 'Нет товаров по фильтру' }}
            size="small"
          />
        </>
      )}
    </>
  );
}

// ─── Tab 3: Price Comparison ─────────────────────────────────────────────────

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
