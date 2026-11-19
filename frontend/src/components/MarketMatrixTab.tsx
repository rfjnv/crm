import { useMemo, useState } from 'react';
import { Input, Select, Space, Table, Tag, Tooltip, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Competitor, MarketComparison } from '../api/market.api';
import { useStickyTable } from '../hooks/useStickyTable';

const COLOR_WE_CHEAPER = '#389e0d';
const COLOR_THEY_CHEAPER = '#cf1322';
const US = 'Мы';

type Offer = {
  /** Цена за единицу; null — в прайсе нет цены. Для «у нас только» — текст из справочника. */
  price: number | null;
  priceText?: string;
  /** Как товар называется у этой компании. */
  names: string[];
  /** Аналог не точный. */
  approximate: boolean;
};

type MatrixRow = {
  key: string;
  category: string;
  product: string;
  offers: Partial<Record<string, Offer>>;
};

function money(v: number): string {
  return v.toLocaleString('ru-RU');
}

/**
 * Матрица «товар × компания»: в строке — товар, в колонках — мы и каждый конкурент,
 * в ячейке «+» и цена, если у компании этот товар есть.
 * Строится из тех же данных, что и остальные вкладки: сравнения (наш товар и его аналоги),
 * «только у них» и «только у нас».
 */
function buildMatrix(market: MarketComparison): { rows: MatrixRow[]; companies: string[] } {
  const byKey = new Map<string, MatrixRow>();
  const get = (category: string, product: string) => {
    const key = `${category}|${product}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, category, product, offers: {} };
      byKey.set(key, row);
    }
    return row;
  };
  const add = (row: MatrixRow, company: string, price: number | null, name: string, approximate: boolean, priceText?: string) => {
    const cur = row.offers[company];
    if (!cur) {
      row.offers[company] = { price, priceText, names: [name], approximate };
      return;
    }
    if (!cur.names.includes(name)) cur.names.push(name);
    if (price != null && (cur.price == null || price < cur.price)) cur.price = price;
    cur.approximate = cur.approximate && approximate;
  };

  for (const r of market.priceRows) {
    const row = get(r.category, r.ourProduct);
    add(row, US, r.ourPrice, r.ourProduct, false);
    add(row, r.competitor, r.competitorPrice, r.competitorProduct, r.matchType !== 'Точное');
  }
  for (const r of market.theirOnly) {
    add(get(r.category, r.name), r.competitor, r.price, r.name, false);
  }
  for (const r of market.ourOnly) {
    add(get(r.category, r.name), US, null, r.name, false, r.price);
  }

  // Колонки конкурентов — по числу товаров, у кого больше, тот левее.
  const counts = new Map<string, number>();
  for (const row of byKey.values()) {
    for (const c of Object.keys(row.offers)) if (c !== US) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const companies = [US, ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)];
  // Сначала наши товары (больше всего конкурентов — выше), потом то, чего у нас нет.
  const others = (r: MatrixRow) => Object.keys(r.offers).filter((c) => c !== US).length;
  const rows = [...byKey.values()].sort((a, b) =>
    Number(Boolean(b.offers[US])) - Number(Boolean(a.offers[US]))
    || a.category.localeCompare(b.category, 'ru')
    || others(b) - others(a)
    || a.product.localeCompare(b.product, 'ru'));
  return { rows, companies };
}

type Presence = 'all' | 'ours' | 'not_ours' | 'shared';

export default function MarketMatrixTab({ market, competitorColor }: {
  market: MarketComparison;
  competitorColor: Record<Competitor, string>;
}) {
  const { token } = theme.useToken();
  const sticky = useStickyTable();
  const { rows, companies } = useMemo(() => buildMatrix(market), [market]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [presence, setPresence] = useState<Presence>('all');
  const [shown, setShown] = useState<string[]>([]);

  const categories = useMemo(() => ['all', ...new Set(rows.map((r) => r.category))], [rows]);
  const visibleCompanies = shown.length ? companies.filter((c) => c === US || shown.includes(c)) : companies;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      const ours = Boolean(r.offers[US]);
      const theirs = Object.keys(r.offers).some((c) => c !== US);
      if (presence === 'ours' && !ours) return false;
      if (presence === 'not_ours' && ours) return false;
      if (presence === 'shared' && !(ours && theirs)) return false;
      if (shown.length && !ours && !shown.some((c) => r.offers[c])) return false;
      if (!q) return true;
      return r.product.toLowerCase().includes(q)
        || Object.values(r.offers).some((o) => o?.names.some((n) => n.toLowerCase().includes(q)));
    });
  }, [rows, search, category, presence, shown]);

  const renderCell = (row: MatrixRow, company: string) => {
    const offer = row.offers[company];
    if (!offer) return <span style={{ color: token.colorTextQuaternary }}>—</span>;
    const our = row.offers[US]?.price ?? null;
    let color: string | undefined;
    if (company !== US && offer.price != null && our != null && offer.price !== our) {
      color = offer.price > our ? COLOR_WE_CHEAPER : COLOR_THEY_CHEAPER;
    }
    const priceLabel = offer.price != null ? money(offer.price) : offer.priceText;
    const mark = (
      <div style={{ lineHeight: 1.2 }}>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, borderRadius: 10, fontWeight: 700,
            background: offer.approximate ? token.colorWarningBg : token.colorSuccessBg,
            color: offer.approximate ? token.colorWarning : token.colorSuccess,
          }}
        >
          {offer.approximate ? '≈' : '+'}
        </span>
        {priceLabel && <div style={{ fontSize: 12, color, fontWeight: color || company === US ? 600 : undefined, whiteSpace: 'nowrap' }}>{priceLabel}</div>}
      </div>
    );
    const tip = offer.names.filter((n) => n !== row.product);
    return tip.length || offer.approximate ? (
      <Tooltip title={<>{offer.approximate && <div>Похожий товар, не точный аналог</div>}{tip.map((n) => <div key={n}>{n}</div>)}</>}>
        {mark}
      </Tooltip>
    ) : mark;
  };

  const columns: ColumnsType<MatrixRow> = [
    {
      title: 'Товар',
      key: 'product',
      fixed: 'left',
      width: 280,
      sorter: (a, b) => a.product.localeCompare(b.product, 'ru'),
      render: (_, r) => (
        <div>
          <div>{r.product}</div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{r.category}</Typography.Text>
        </div>
      ),
    },
    ...visibleCompanies.map((c) => {
      const total = filtered.filter((r) => r.offers[c]).length;
      return {
        title: (
          <div style={{ textAlign: 'center', lineHeight: 1.2 }}>
            {c === US ? <b>Мы</b> : <Tag color={competitorColor[c as Competitor]} style={{ marginInlineEnd: 0 }}>{c}</Tag>}
            <div style={{ fontSize: 11, fontWeight: 400, color: token.colorTextSecondary }}>{total} поз.</div>
          </div>
        ),
        key: c,
        width: 112,
        align: 'center' as const,
        fixed: c === US ? ('left' as const) : undefined,
        sorter: (a: MatrixRow, b: MatrixRow) => Number(Boolean(a.offers[c])) - Number(Boolean(b.offers[c])),
        render: (_: unknown, r: MatrixRow) => renderCell(r, c),
      };
    }),
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Поиск товара" allowClear style={{ width: 240 }} onChange={(e) => setSearch(e.target.value)} />
        <Select
          style={{ width: 220 }}
          value={category}
          onChange={setCategory}
          options={categories.map((v) => ({ value: v, label: v === 'all' ? 'Категория: все' : v }))}
        />
        <Select
          style={{ width: 210 }}
          value={presence}
          onChange={setPresence}
          options={[
            { value: 'all', label: 'Все товары' },
            { value: 'shared', label: 'Есть у нас и у них' },
            { value: 'ours', label: 'Есть у нас' },
            { value: 'not_ours', label: 'Нет у нас' },
          ]}
        />
        <Select
          mode="multiple"
          allowClear
          style={{ minWidth: 240 }}
          placeholder="Компании: все"
          value={shown}
          onChange={setShown}
          maxTagCount="responsive"
          options={companies.filter((c) => c !== US).map((c) => ({ value: c, label: c }))}
        />
      </Space>
      <div style={{ marginBottom: 8, fontSize: 12, color: token.colorTextSecondary }}>
        <b style={{ color: token.colorSuccess }}>+</b> есть у компании ·{' '}
        <b style={{ color: token.colorWarning }}>≈</b> похожий товар ·{' '}
        цена <span style={{ color: COLOR_WE_CHEAPER, fontWeight: 600 }}>зелёная</span> — у них дороже нас,{' '}
        <span style={{ color: COLOR_THEY_CHEAPER, fontWeight: 600 }}>красная</span> — у них дешевле · — нет
      </div>
      <Table
        rowKey="key"
        size="small"
        bordered
        columns={columns}
        dataSource={filtered}
        sticky={sticky}
        scroll={{ x: 280 + visibleCompanies.length * 112 }}
        pagination={{ defaultPageSize: 100, showSizeChanger: true, pageSizeOptions: [50, 100, 200, 500], showTotal: (t) => `${t} товаров` }}
      />
    </div>
  );
}
