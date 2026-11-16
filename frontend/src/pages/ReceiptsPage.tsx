import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Alert, Card, Col, DatePicker, Empty, Input, Row, Segmented, Space, Spin, Statistic, Table, Tag, Typography, theme } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { inventoryApi, type ReceiptRow } from '../api/warehouse.api';
import { useCostAccess } from '../hooks/useCostAccess';
import CostAccessButton from '../components/CostAccessButton';
import MovementUnitCostCell from '../components/MovementUnitCostCell';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';

const { Title, Text } = Typography;

type View = 'supply' | 'all' | 'nocost';

const KIND: Record<ReceiptRow['kind'], { label: string; color: string }> = {
  SUPPLY: { label: 'Поставка', color: 'green' },
  HISTORY: { label: 'Для истории', color: 'default' },
  RETURN: { label: 'Возврат', color: 'orange' },
  EXCHANGE: { label: 'Обмен', color: 'purple' },
  CORRECTION: { label: 'Коррекция', color: 'gold' },
};

const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));

/**
 * «Поступления»: каждый приход на склад с ценой закупки и суммой. Цену можно поставить
 * или поправить прямо в таблице. Только админы и только с открытой себестоимостью (ПИН).
 */
export default function ReceiptsPage() {
  const cost = useCostAccess();
  const isMobile = useIsMobile();
  const { token } = theme.useToken();
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('year'), dayjs()]);
  const [view, setView] = useState<View>('supply');
  const [search, setSearch] = useState('');

  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');
  const { data, isLoading, error } = useQuery({
    queryKey: ['inventory-receipts', from, to],
    queryFn: () => inventoryApi.listReceipts({ from, to }),
    enabled: cost.open,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (view === 'supply' && !(r.kind === 'SUPPLY' || r.kind === 'HISTORY')) return false;
      if (view === 'nocost' && (num(r.unitCost) != null || !(r.kind === 'SUPPLY' || r.kind === 'HISTORY'))) return false;
      if (!q) return true;
      return [r.product.name, r.product.sku, r.product.category ?? '', r.note ?? ''].some((s) => s.toLowerCase().includes(q));
    });
  }, [data, view, search]);

  const totals = useMemo(() => {
    let sum = 0;
    let priced = 0;
    for (const r of rows) {
      const c = num(r.unitCost);
      if (c != null) { sum += c * Number(r.quantity); priced++; }
    }
    return { sum, priced, noCost: rows.length - priced };
  }, [rows]);

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      width: 104,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
      sorter: (a: ReceiptRow, b: ReceiptRow) => a.createdAt.localeCompare(b.createdAt),
    },
    {
      title: 'Товар',
      key: 'product',
      render: (_: unknown, r: ReceiptRow) => (
        <Space direction="vertical" size={0}>
          <Link to={`/inventory/products/${r.product.id}`}>{r.product.name}</Link>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.product.sku}{r.product.category ? ` · ${r.product.category}` : ''}</Text>
        </Space>
      ),
    },
    {
      title: 'Кол-во',
      key: 'qty',
      align: 'right' as const,
      width: 130,
      render: (_: unknown, r: ReceiptRow) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {Number(r.quantity).toLocaleString('ru-RU')} {r.product.unit}
          {num(r.rollQuantity) ? <Text type="secondary"> · {num(r.rollQuantity)} рул</Text> : null}
        </span>
      ),
    },
    {
      title: 'Цена закупки',
      key: 'unitCost',
      align: 'right' as const,
      width: 150,
      render: (_: unknown, r: ReceiptRow) => <MovementUnitCostCell movement={r} />,
    },
    {
      title: 'Сумма',
      key: 'sum',
      align: 'right' as const,
      width: 150,
      sorter: (a: ReceiptRow, b: ReceiptRow) => (num(a.unitCost) ?? 0) * Number(a.quantity) - (num(b.unitCost) ?? 0) * Number(b.quantity),
      render: (_: unknown, r: ReceiptRow) => {
        const c = num(r.unitCost);
        return c == null ? '—' : <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatUZS(Math.round(c * Number(r.quantity)))}</span>;
      },
    },
    {
      title: 'Тип',
      dataIndex: 'kind',
      width: 120,
      render: (k: ReceiptRow['kind']) => <Tag color={KIND[k].color}>{KIND[k].label}</Tag>,
    },
    {
      title: 'Примечание',
      dataIndex: 'note',
      render: (v: string | null) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    { title: 'Кто', dataIndex: 'creatorName', width: 120, render: (v: string | null) => v || '—' },
  ];

  const errMsg = (error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Поступления</Title>
        <Space wrap>
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { label: 'Поставки', value: 'supply' },
              { label: 'Без цены', value: 'nocost' },
              { label: 'Все приходы', value: 'all' },
            ]}
          />
          <DatePicker.RangePicker
            value={range}
            format="DD.MM.YYYY"
            allowClear={false}
            onChange={(v) => { if (v?.[0] && v?.[1]) setRange([v[0], v[1]]); }}
          />
          <Input.Search
            allowClear
            placeholder="Товар, артикул, партия…"
            style={{ width: isMobile ? '100%' : 240 }}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Space>
      </Space>

      {!cost.open ? (
        <Card>
          <Empty
            image={<LockOutlined style={{ fontSize: 48, color: token.colorTextTertiary }} />}
            description={(
              <Space direction="vertical">
                <Text strong>Цены закупки защищены ПИН-кодом</Text>
                <Text type="secondary">Откройте доступ своим ПИН-кодом, чтобы увидеть поступления с себестоимостью.</Text>
              </Space>
            )}
          >
            <CostAccessButton label="Ввести ПИН-код" />
          </Empty>
        </Card>
      ) : isLoading ? (
        <Card><div style={{ textAlign: 'center', padding: 48 }}><Spin /></div></Card>
      ) : error ? (
        <Alert type="error" showIcon message={errMsg || 'Не удалось загрузить поступления'} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Поступлений" value={rows.length} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="С ценой закупки" value={totals.priced} /></Card></Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="Без цены" value={totals.noCost} valueStyle={totals.noCost ? { color: token.colorWarning } : undefined} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small"><Statistic title="Сумма закупки" value={Math.round(totals.sum)} formatter={(v) => formatUZS(Number(v))} /></Card>
            </Col>
          </Row>
          {totals.noCost > 0 && view !== 'nocost' && (
            <Alert type="warning" showIcon message={`У ${totals.noCost} поступлений нет цены закупки — они не входят в сумму. Нажмите «указать» в строке или откройте «Без цены».`} />
          )}
          <Card styles={{ body: { padding: 0 } }}>
            <Table<ReceiptRow>
              rowKey="id"
              dataSource={rows}
              columns={columns}
              size="small"
              scroll={{ x: 1100 }}
              pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'], showTotal: (t) => `Всего: ${t}` }}
            />
          </Card>
        </Space>
      )}
    </div>
  );
}
