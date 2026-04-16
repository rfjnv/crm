import { useMemo, useState, type CSSProperties } from 'react';
import { Button, Card, Input, Select, Space, Table, Tag, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import BackButton from '../components/BackButton';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  PRICE_ROWS,
  type Competitor,
  type MatchType,
  type PriceRow,
} from './priceComparisonData';

/** Зелёный = у нас дешевле (их цена выше), красный = у них дешевле (их цена ниже). */
const COLOR_WE_CHEAPER = '#389e0d';
const COLOR_THEY_CHEAPER = '#cf1322';

type RelationFilter = 'all' | 'they_cheaper' | 'we_cheaper' | 'same';

/** null = не фильтруем; 'missing' = только строки без цены конкурента */
type TheirPricePick = number | 'missing' | null;

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

export default function PriceComparisonPage() {
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [competitor, setCompetitor] = useState<'all' | Competitor>('all');
  const [category, setCategory] = useState<string>('all');
  const [matchType, setMatchType] = useState<'all' | MatchType>('all');

  const [relationFilter, setRelationFilter] = useState<RelationFilter>('all');
  const [pickedOurPrice, setPickedOurPrice] = useState<number | null>(null);
  const [pickedTheirPrice, setPickedTheirPrice] = useState<TheirPricePick>(null);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(PRICE_ROWS.map((row) => row.category)))],
    [],
  );

  const competitors = useMemo(
    () => ['all', ...Array.from(new Set(PRICE_ROWS.map((row) => row.competitor)))],
    [],
  );

  /** База: поиск + три селекта (без быстрых кликов по карточке/цене). */
  const rowsAfterDropdown = useMemo(() => {
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
    const comparable = rowsAfterDropdown.filter((row) => row.competitorPrice !== null);
    const theyAreCheaper = comparable.filter((row) => (row.competitorPrice as number) < row.ourPrice).length;
    const weAreCheaper = comparable.filter((row) => (row.competitorPrice as number) > row.ourPrice).length;
    const samePrice = comparable.filter((row) => row.competitorPrice === row.ourPrice).length;
    return {
      total: rowsAfterDropdown.length,
      theyAreCheaper,
      weAreCheaper,
      samePrice,
    };
  }, [rowsAfterDropdown]);

  const filteredRows = useMemo(() => {
    return rowsAfterDropdown.filter((row) => {
      const cp = row.competitorPrice;
      if (relationFilter === 'they_cheaper') {
        if (cp === null || cp >= row.ourPrice) return false;
      } else if (relationFilter === 'we_cheaper') {
        if (cp === null || cp <= row.ourPrice) return false;
      } else if (relationFilter === 'same') {
        if (cp === null || cp !== row.ourPrice) return false;
      }

      if (pickedOurPrice !== null && row.ourPrice !== pickedOurPrice) return false;

      if (pickedTheirPrice !== null) {
        if (pickedTheirPrice === 'missing') {
          if (row.competitorPrice !== null) return false;
        } else if (row.competitorPrice !== pickedTheirPrice) {
          return false;
        }
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
      width: 300,
      render: (value: string, row) => (
        <div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, ...clickableStyle(category === row.category) }}
            role="button"
            tabIndex={0}
            onClick={() => setCategory((c) => (c === row.category ? 'all' : row.category))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setCategory((c) => (c === row.category ? 'all' : row.category));
              }
            }}
            title="Фильтр по категории"
          >
            {row.category}
          </Typography.Text>
          <div
            role="button"
            tabIndex={0}
            style={{ ...clickableStyle(category === row.category), marginTop: 2 }}
            onClick={() => setCategory((c) => (c === row.category ? 'all' : row.category))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setCategory((c) => (c === row.category ? 'all' : row.category));
              }
            }}
            title="Фильтр по категории"
          >
            {value}
          </div>
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
        <span
          role="button"
          tabIndex={0}
          style={{ display: 'inline-block', ...clickableStyle(competitor === value) }}
          onClick={() => setCompetitor((c) => (c === value ? 'all' : value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCompetitor((c) => (c === value ? 'all' : value));
            }
          }}
          title="Фильтр по компании"
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
          style={{ ...clickableStyle(pickedOurPrice === value) }}
          onClick={() => {
            setPickedTheirPrice(null);
            setPickedOurPrice((prev) => (prev === value ? null : value));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setPickedTheirPrice(null);
              setPickedOurPrice((prev) => (prev === value ? null : value));
            }
          }}
          title="Показать строки с такой же нашей ценой (повторный клик — снять)"
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
        const active = value === null
          ? pickedTheirPrice === 'missing'
          : pickedTheirPrice === value;
        return (
          <span
            role="button"
            tabIndex={0}
            style={{ ...clickableStyle(!!active) }}
            onClick={() => {
              setPickedOurPrice(null);
              if (value === null) {
                setPickedTheirPrice((prev) => (prev === 'missing' ? null : 'missing'));
              } else {
                setPickedTheirPrice((prev) => (prev === value ? null : value));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setPickedOurPrice(null);
                if (value === null) {
                  setPickedTheirPrice((prev) => (prev === 'missing' ? null : 'missing'));
                } else {
                  setPickedTheirPrice((prev) => (prev === value ? null : value));
                }
              }
            }}
            title={
              value === null
                ? 'Только позиции без цены конкурента'
                : 'Показать строки с такой же их ценой; если цены равны нашей — удобно смотреть «одинаковые»'
            }
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
        const prefix = delta.diff > 0 ? '+' : '';
        return (
          <span
            role="button"
            tabIndex={0}
            style={{ color, ...clickableStyle(false) }}
            title="Фильтр: у них дешевле / у нас дешевле / одинаково"
            onClick={() => {
              setPickedOurPrice(null);
              setPickedTheirPrice(null);
              if (delta.diff < 0) toggleRelation('they_cheaper');
              else if (delta.diff > 0) toggleRelation('we_cheaper');
              else toggleRelation('same');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setPickedOurPrice(null);
                setPickedTheirPrice(null);
                if (delta.diff < 0) toggleRelation('they_cheaper');
                else if (delta.diff > 0) toggleRelation('we_cheaper');
                else toggleRelation('same');
              }
            }}
          >
            {prefix}
            {formatMoney(delta.diff)}
          </span>
        );
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
        const color = delta.percent > 0 ? COLOR_WE_CHEAPER : delta.percent < 0 ? COLOR_THEY_CHEAPER : undefined;
        const prefix = delta.percent > 0 ? '+' : '';
        return (
          <span
            role="button"
            tabIndex={0}
            style={{ color, fontWeight: 600, ...clickableStyle(false) }}
            title="Фильтр: у них дешевле / у нас дешевле / одинаково"
            onClick={() => {
              setPickedOurPrice(null);
              setPickedTheirPrice(null);
              if (delta.percent < 0) toggleRelation('they_cheaper');
              else if (delta.percent > 0) toggleRelation('we_cheaper');
              else toggleRelation('same');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setPickedOurPrice(null);
                setPickedTheirPrice(null);
                if (delta.percent < 0) toggleRelation('they_cheaper');
                else if (delta.percent > 0) toggleRelation('we_cheaper');
                else toggleRelation('same');
              }
            }}
          >
            {prefix}
            {delta.percent}
            %
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <BackButton fallback="/analytics" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Сравнение цен
        </Typography.Title>
        {hasQuickFilter && (
          <Button type="link" size="small" onClick={clearQuickFilters} style={{ padding: 0 }}>
            Сбросить быстрый фильтр
          </Button>
        )}
      </div>

      <Typography.Paragraph type="secondary" style={{ marginTop: -8, marginBottom: 12, fontSize: 12 }}>
        Карточки сверху и колонки «Разница» задают фильтр по отношению цен. Категория и название нашего товара — по категории.
        Компания — по конкуренту. Наша / их цена — по совпадению суммы (у «—» только строки без их цены).
      </Typography.Paragraph>

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
        <Card
          size="small"
          style={statCardStyle(false)}
          tabIndex={0}
          role="button"
          onClick={() => clearQuickFilters()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              clearQuickFilters();
            }
          }}
          title="Сбросить быстрый фильтр (карточки и клики по ценам)"
        >
          <Typography.Text type="secondary">Всего совпадений</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total}</div>
        </Card>
        <Card
          size="small"
          style={statCardStyle(relationFilter === 'they_cheaper')}
          tabIndex={0}
          role="button"
          onClick={() => toggleRelation('they_cheaper')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleRelation('they_cheaper');
            }
          }}
          title="Показать только строки, где у них дешевле"
        >
          <Typography.Text type="secondary">У них дешевле</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: COLOR_THEY_CHEAPER }}>{stats.theyAreCheaper}</div>
        </Card>
        <Card
          size="small"
          style={statCardStyle(relationFilter === 'we_cheaper')}
          tabIndex={0}
          role="button"
          onClick={() => toggleRelation('we_cheaper')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleRelation('we_cheaper');
            }
          }}
          title="Показать только строки, где у нас дешевле"
        >
          <Typography.Text type="secondary">У нас дешевле</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: COLOR_WE_CHEAPER }}>{stats.weAreCheaper}</div>
        </Card>
        <Card
          size="small"
          style={statCardStyle(relationFilter === 'same')}
          tabIndex={0}
          role="button"
          onClick={() => toggleRelation('same')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleRelation('same');
            }
          }}
          title="Показать только строки с одинаковой ценой"
        >
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
