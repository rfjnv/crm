import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Select, Table, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FileExcelOutlined } from '@ant-design/icons';
import Section from './ui/Section';
import Money from './ui/Money';
import { fmtQty, money } from './history/historyChartUtils';
import { downloadBlob } from '../utils/download';
import type { CategoryAnalysisResponse } from '../api/categoryAnalysis.api';

/** Столько товаров показываем отдельными колонками; больше — списком в одной колонке. */
const MAX_PRODUCT_COLUMNS = 6;

interface Bought {
  productId: string;
  name: string;
  short: string;
  unit: string;
  qty: number;
  rev: number;
}

interface ClientLine {
  id: string;
  name: string;
  managerName: string;
  rev: number;
  revPrev: number;
  qty: number;
  qtyPrev: number;
  orders: number;
  lastBuy: string | null;
  items: Bought[];
}

const day = (d: string | null) => (d ? d.split('-').reverse().join('.') : '—');

/**
 * «Кто что купил» внутри категории за выбранный период: клиент × товар, количество и сумма.
 * Фильтр по товару, поиск и выгрузка всего списка в Excel.
 */
export default function CategoryClientProducts({ data, short }: {
  data: CategoryAnalysisResponse;
  short: (name: string) => string;
}) {
  const [productId, setProductId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);

  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data]);
  const clientById = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data]);
  // Товары, которые в периоде кто-то купил, — по выручке
  const sold = useMemo(
    () => data.products.filter((p) => data.clientProducts.some((r) => r.productId === p.id && r.qty > 0)),
    [data],
  );
  const unitOf = (pid: string) => productById.get(pid)?.unit ?? '';

  const lines = useMemo(() => {
    const byClient = new Map<string, ClientLine>();
    for (const r of data.clientProducts) {
      if (productId && r.productId !== productId) continue;
      const c = clientById.get(r.clientId);
      let line = byClient.get(r.clientId);
      if (!line) {
        // Заказы по всей категории — сделки клиента; по одному товару — сделки с этим товаром
        line = { id: r.clientId, name: c?.name ?? '—', managerName: c?.managerName ?? '—', rev: 0, revPrev: 0, qty: 0, qtyPrev: 0, orders: productId ? r.orders : (c?.orders ?? 0), lastBuy: null, items: [] };
        byClient.set(r.clientId, line);
      }
      line.rev += r.rev;
      line.revPrev += r.revPrev;
      line.qty += r.qty;
      line.qtyPrev += r.qtyPrev;
      if (r.lastBuy && (!line.lastBuy || r.lastBuy > line.lastBuy)) line.lastBuy = r.lastBuy;
      if (r.qty > 0) {
        const p = productById.get(r.productId);
        line.items.push({ productId: r.productId, name: p?.name ?? '—', short: short(p?.name ?? '—'), unit: p?.unit ?? '', qty: r.qty, rev: r.rev });
      }
    }
    const q = query.trim().toLowerCase();
    // В списке — те, кто купил в этом периоде
    return [...byClient.values()]
      .filter((l) => l.qty > 0 || l.rev > 0)
      .filter((l) => !q || l.name.toLowerCase().includes(q))
      .map((l) => ({ ...l, items: l.items.sort((a, b) => b.rev - a.rev) }))
      .sort((a, b) => b.rev - a.rev);
  }, [data, productId, query, clientById, productById, short]);

  const totals = useMemo(() => lines.reduce(
    (s, l) => ({ rev: s.rev + l.rev, revPrev: s.revPrev + l.revPrev, qty: s.qty + l.qty }),
    { rev: 0, revPrev: 0, qty: 0 },
  ), [lines]);

  const pivot = !productId && sold.length > 1 && sold.length <= MAX_PRODUCT_COLUMNS;
  const qtyOf = (l: ClientLine, pid: string) => l.items.find((i) => i.productId === pid);

  const columns: ColumnsType<ClientLine> = [
    {
      title: 'Клиент', dataIndex: 'name', key: 'name', fixed: 'left', width: 220,
      render: (v: string, r) => <div className="cat-prod"><Link to={`/clients/${r.id}`}>{v}</Link><span className="cat-muted">{r.managerName}</span></div>,
    },
  ];

  if (productId) {
    const unit = unitOf(productId);
    columns.push(
      { title: 'Кол-во', key: 'qty', align: 'right', sorter: (a, b) => a.qty - b.qty, render: (_, r) => <>{fmtQty(r.qty)} <span className="cat-muted">{unit}</span></> },
      { title: 'Сумма', dataIndex: 'rev', key: 'rev', align: 'right', sorter: (a, b) => a.rev - b.rev, defaultSortOrder: 'descend', render: (v: number) => <Money value={v} /> },
      { title: 'Ср. цена', key: 'price', align: 'right', render: (_, r) => (r.qty > 0 ? money(r.rev / r.qty) : '—') },
      { title: 'Год назад', key: 'qtyPrev', align: 'right', sorter: (a, b) => a.qtyPrev - b.qtyPrev,
        render: (_, r) => (r.qtyPrev > 0 ? <Tooltip title={money(r.revPrev)}>{fmtQty(r.qtyPrev)} <span className="cat-muted">{unit}</span></Tooltip> : <span className="cat-muted">—</span>) },
    );
  } else if (pivot) {
    for (const p of sold) {
      columns.push({
        title: <Tooltip title={p.name}><span>{short(p.name)}</span></Tooltip>,
        key: p.id,
        align: 'right',
        sorter: (a, b) => (qtyOf(a, p.id)?.qty ?? 0) - (qtyOf(b, p.id)?.qty ?? 0),
        render: (_, r) => {
          const it = qtyOf(r, p.id);
          return it ? (
            <div className="cat-cell2">
              <span>{fmtQty(it.qty)} <span className="cat-muted">{p.unit}</span></span>
              <span className="cat-muted">{money(it.rev)}</span>
            </div>
          ) : <span className="cat-muted">—</span>;
        },
      });
    }
  } else {
    columns.push({
      title: 'Что купил', key: 'items', width: 340,
      render: (_, r) => (
        <div className="cat-items">
          {r.items.map((i) => (
            <Tooltip key={i.productId} title={`${i.name} · ${money(i.rev)}`}>
              <span className="cat-item">{i.short} · <b>{fmtQty(i.qty)}</b> {i.unit}</span>
            </Tooltip>
          ))}
        </div>
      ),
    });
  }

  if (!productId) {
    columns.push(
      { title: 'Сумма', dataIndex: 'rev', key: 'rev', align: 'right', sorter: (a, b) => a.rev - b.rev, defaultSortOrder: 'descend', render: (v: number) => <Money value={v} /> },
      { title: 'Год назад', dataIndex: 'revPrev', key: 'revPrev', align: 'right', sorter: (a, b) => a.revPrev - b.revPrev,
        render: (v: number) => (v > 0 ? <Money value={v} /> : <span className="cat-muted">—</span>) },
    );
  }
  columns.push(
    { title: 'Заказы', dataIndex: 'orders', key: 'orders', align: 'right', sorter: (a, b) => a.orders - b.orders },
    { title: 'Последняя покупка', dataIndex: 'lastBuy', key: 'last', align: 'right', sorter: (a, b) => (a.lastBuy ?? '').localeCompare(b.lastBuy ?? ''), render: (v: string | null) => day(v) },
  );

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Кто что купил');
      ws.columns = [
        { header: 'Клиент', key: 'client', width: 32 },
        { header: 'Менеджер', key: 'manager', width: 22 },
        { header: 'Товар', key: 'product', width: 40 },
        { header: 'Артикул', key: 'sku', width: 18 },
        { header: 'Кол-во', key: 'qty', width: 12 },
        { header: 'Ед.', key: 'unit', width: 8 },
        { header: 'Сумма', key: 'rev', width: 16 },
        { header: 'Ср. цена', key: 'price', width: 14 },
        { header: 'Заказы', key: 'orders', width: 9 },
        { header: 'Последняя покупка', key: 'last', width: 18 },
        { header: 'Кол-во год назад', key: 'qtyPrev', width: 16 },
        { header: 'Сумма год назад', key: 'revPrev', width: 16 },
      ];
      const visible = new Set(lines.map((l) => l.id));
      const rows = data.clientProducts
        .filter((r) => visible.has(r.clientId) && r.qty > 0 && (!productId || r.productId === productId))
        .map((r) => {
          const c = clientById.get(r.clientId);
          const p = productById.get(r.productId);
          return {
            client: c?.name ?? '—', manager: c?.managerName ?? '—', product: p?.name ?? '—', sku: p?.sku ?? '',
            qty: r.qty, unit: p?.unit ?? '', rev: r.rev, price: r.qty > 0 ? Math.round(r.rev / r.qty) : null,
            orders: r.orders, last: day(r.lastBuy), qtyPrev: r.qtyPrev || null, revPrev: r.revPrev || null,
          };
        })
        .sort((a, b) => a.client.localeCompare(b.client, 'ru') || b.rev - a.rev);
      ws.addRows(rows);
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      for (const key of ['rev', 'price', 'revPrev']) ws.getColumn(key).numFmt = '# ##0';
      const buf = await wb.xlsx.writeBuffer();
      const p = data.periods.cur;
      const suffix = productId ? `_${short(productById.get(productId)?.name ?? '')}` : '';
      downloadBlob(
        new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `${data.category}${suffix}_${day(p.from)}-${day(p.to)}.xlsx`.replace(/[\\/:*?"<>|]/g, '_'),
      );
    } catch (e) {
      message.error(`Не удалось выгрузить: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Section title="Кто что купил" count={lines.length}>
      <div className="cat-tools">
        <Select
          className="cat-select"
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Все товары"
          value={productId ?? undefined}
          onChange={(v) => setProductId(v ?? null)}
          options={sold.map((p) => ({ value: p.id, label: short(p.name) }))}
        />
        <Input.Search allowClear placeholder="Клиент" value={query} onChange={(e) => setQuery(e.target.value)} className="cat-search" />
        <Button icon={<FileExcelOutlined />} loading={exporting} disabled={!lines.length} onClick={exportXlsx}>Excel</Button>
      </div>
      <Table
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={lines}
        pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: pivot ? 520 + sold.length * 130 : 1000 }}
        summary={() => (lines.length > 1 ? (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><b>Итого · {lines.length}</b></Table.Summary.Cell>
              {productId ? (
                <>
                  <Table.Summary.Cell index={1} align="right"><b>{fmtQty(totals.qty)}</b> <span className="cat-muted">{unitOf(productId)}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><b><Money value={totals.rev} /></b></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} colSpan={columns.length - 3} />
                </>
              ) : (
                <>
                  {pivot && sold.map((p, i) => {
                    const q = lines.reduce((s, l) => s + (qtyOf(l, p.id)?.qty ?? 0), 0);
                    return <Table.Summary.Cell key={p.id} index={1 + i} align="right"><b>{fmtQty(q)}</b> <span className="cat-muted">{p.unit}</span></Table.Summary.Cell>;
                  })}
                  {!pivot && <Table.Summary.Cell index={1} />}
                  <Table.Summary.Cell index={pivot ? 1 + sold.length : 2} align="right"><b><Money value={totals.rev} /></b></Table.Summary.Cell>
                  <Table.Summary.Cell index={pivot ? 2 + sold.length : 3} align="right"><Money value={totals.revPrev} /></Table.Summary.Cell>
                  <Table.Summary.Cell index={pivot ? 3 + sold.length : 4} colSpan={2} />
                </>
              )}
            </Table.Summary.Row>
          </Table.Summary>
        ) : null)}
      />
    </Section>
  );
}
