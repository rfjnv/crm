import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Select, Typography, Tag, Card, Tooltip, DatePicker, Input, Row, Col, Statistic, Space } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, EditOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import { inventoryApi } from '../api/warehouse.api';
import { usersApi } from '../api/users.api';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import ReceiptPunchedTag from '../components/ReceiptPunchedTag';
import StockBalanceCell from '../components/StockBalanceCell';
import { Link } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

const typeConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  IN: { color: 'green', icon: <ArrowUpOutlined />, label: 'Приход' },
  OUT: { color: 'red', icon: <ArrowDownOutlined />, label: 'Расход' },
  CORRECTION: { color: 'orange', icon: <EditOutlined />, label: 'Коррекция' },
};

export default function MovementsPage() {
  const isMobile = useIsMobile();
  const [productFilter, setProductFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<'IN' | 'OUT' | 'CORRECTION' | undefined>();
  const [managerFilter, setManagerFilter] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedMovement, setSelectedMovement] = useState<any>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const filters = {
    productId: productFilter,
    type: typeFilter,
    createdBy: managerFilter,
    dateFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
    dateTo: dateRange?.[1]?.format('YYYY-MM-DD'),
    search: debouncedSearch || undefined,
  };

  const { data: movements, isLoading } = useQuery({
    queryKey: ['movements', filters],
    queryFn: () => inventoryApi.listMovements(filters),
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const { data: managers } = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => usersApi.list(),
  });

  const summary = useMemo(() => {
    const rows = movements ?? [];
    let inQty = 0;
    let outQty = 0;
    let inCount = 0;
    let outCount = 0;
    for (const m of rows) {
      const qty = Number(m.quantity) || 0;
      if (m.type === 'IN') {
        inQty += qty;
        inCount += 1;
      } else if (m.type === 'OUT') {
        outQty += qty;
        outCount += 1;
      }
    }
    return { inQty, outQty, inCount, outCount, total: rows.length };
  }, [movements]);

  const dailyTotals = useMemo(() => {
    const map = new Map<string, { date: string; inQty: number; outQty: number; count: number }>();
    for (const m of movements ?? []) {
      const day = dayjs((m as any).eventDate ?? m.createdAt).format('YYYY-MM-DD');
      const entry = map.get(day) ?? { date: day, inQty: 0, outQty: 0, count: 0 };
      const qty = Number(m.quantity) || 0;
      if (m.type === 'IN') entry.inQty += qty;
      else if (m.type === 'OUT') entry.outQty += qty;
      entry.count += 1;
      map.set(day, entry);
    }
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [movements]);

  const columns = [
    {
      title: 'Тип',
      dataIndex: 'type',
      width: 80,
      render: (v: string) => {
        const cfg = typeConfig[v] || typeConfig.OUT;
        return <Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag>;
      },
    },
    { title: 'Товар', dataIndex: ['product', 'name'] },
    { title: 'Артикул', dataIndex: ['product', 'sku'], render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Кол-во', dataIndex: 'quantity', align: 'right' as const, width: 80 },
    {
      title: 'Рулоны',
      dataIndex: 'rollQuantity',
      align: 'right' as const,
      width: 80,
      render: (v: string | number | null | undefined) => {
        const n = v == null ? null : Number(v);
        return n != null && Number.isFinite(n) && n > 0 ? n : '—';
      },
    },
    {
      title: 'Было → Стало',
      key: 'balance',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, r: any) => <StockBalanceCell movement={r} />,
    },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, record: any) => {
        if (!record.deal?.id) return record.deal?.title || '—';
        if (record.deal?.client) {
          return (
            <Space size={4} wrap>
              <Link to={`/deals/${record.deal.id}`} style={{ textDecoration: 'none' }}>
                <ClientCompanyDisplay client={record.deal.client} />
              </Link>
              <ReceiptPunchedTag isReceiptPunched={record.deal.isReceiptPunched} />
            </Space>
          );
        }
        return (
          <Space size={4} wrap>
            <Link to={`/deals/${record.deal.id}`}>{record.deal.title || '—'}</Link>
            <ReceiptPunchedTag isReceiptPunched={record.deal.isReceiptPunched} />
          </Space>
        );
      },
    },
    { title: 'Менеджер', dataIndex: 'creatorName', render: (v: string | null) => v || '—' },
    { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
    {
      title: 'Дата',
      dataIndex: 'eventDate',
      width: 140,
      render: (_v: string, r: { eventDate?: string; createdAt: string }) => {
        const event = r.eventDate ?? r.createdAt;
        const sameDay = dayjs(event).isSame(r.createdAt, 'day');
        return (
          <Tooltip
            title={
              sameDay
                ? `Запись создана: ${dayjs(r.createdAt).format('DD.MM.YYYY HH:mm')}`
                : `Бизнес-дата: ${dayjs(event).format('DD.MM.YYYY')} • запись создана: ${dayjs(r.createdAt).format('DD.MM.YYYY HH:mm')}`
            }
          >
            <span>{dayjs(event).format('DD.MM.YYYY')}</span>
          </Tooltip>
        );
      },
    },
  ];

  // Mobile: show detail view instead of list when an item is selected
  if (isMobile && selectedMovement) {
    const m = selectedMovement;
    const cfg = typeConfig[m.type] || typeConfig.OUT;
    return (
      <div>
        <div
          onClick={() => setSelectedMovement(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}
        >
          <LeftOutlined />
          <Typography.Text>Назад</Typography.Text>
        </div>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag>
              <Tooltip title={`Запись создана: ${dayjs(m.createdAt).format('DD.MM.YYYY HH:mm')}`}>
                <Typography.Text type="secondary">
                  {dayjs(m.eventDate ?? m.createdAt).format('DD.MM.YYYY')}
                </Typography.Text>
              </Tooltip>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Товар</Typography.Text>
              <div><Typography.Text strong>{m.product?.name}</Typography.Text></div>
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Артикул</Typography.Text>
                <div><Tag>{m.product?.sku}</Tag></div>
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Кол-во</Typography.Text>
                <div><Typography.Text strong style={{ fontSize: 16 }}>{m.quantity}</Typography.Text></div>
              </div>
            </div>
            {m.creatorName && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Менеджер</Typography.Text>
                <div><Typography.Text>{m.creatorName}</Typography.Text></div>
              </div>
            )}
            {m.deal && (
              <Link to={`/deals/${m.deal.id}`} style={{ textDecoration: 'none' }}>
                <Card size="small" style={{ background: 'rgba(22, 119, 255, 0.04)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Клиент</Typography.Text>
                      <div><ClientCompanyDisplay client={m.deal.client} /></div>
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Сделка: {m.deal.title}</Typography.Text>
                        {' '}
                        <ReceiptPunchedTag isReceiptPunched={m.deal.isReceiptPunched} />
                      </div>
                    </div>
                    <RightOutlined style={{ color: '#999' }} />
                  </div>
                </Card>
              </Link>
            )}
            {m.note && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Примечание</Typography.Text>
                <div style={{ wordBreak: 'break-word' }}><Typography.Text>{m.note}</Typography.Text></div>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', marginBottom: 16, gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Движение склада</Typography.Title>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <Input
          allowClear
          placeholder="Поиск по товару, клиенту, примечанию"
          prefix={<SearchOutlined />}
          style={{ width: isMobile ? '100%' : 260 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <Select
          allowClear
          placeholder="Товар"
          style={{ width: isMobile ? '100%' : 220 }}
          value={productFilter}
          onChange={(v) => setProductFilter(v)}
          showSearch
          optionFilterProp="label"
          options={(products ?? []).map((p) => ({ label: `${p.name} (${p.sku})`, value: p.id }))}
        />
        <Select
          allowClear
          placeholder="Тип движения"
          style={{ width: isMobile ? '100%' : 160 }}
          value={typeFilter}
          onChange={(v) => setTypeFilter(v)}
          options={[
            { label: 'Приход', value: 'IN' },
            { label: 'Расход', value: 'OUT' },
            { label: 'Коррекция', value: 'CORRECTION' },
          ]}
        />
        <Select
          allowClear
          placeholder="Менеджер"
          style={{ width: isMobile ? '100%' : 200 }}
          value={managerFilter}
          onChange={(v) => setManagerFilter(v)}
          showSearch
          optionFilterProp="label"
          options={(managers ?? []).map((u) => ({ label: u.fullName, value: u.id }))}
        />
        <RangePicker
          style={{ width: isMobile ? '100%' : 240 }}
          value={dateRange}
          onChange={(v) => setDateRange(v as [Dayjs, Dayjs] | null)}
          format="DD.MM.YYYY"
        />
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic title="Всего записей" value={summary.total} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="Приход (кол-во)"
              value={summary.inQty}
              valueStyle={{ color: '#3f8600' }}
              prefix={<ArrowUpOutlined />}
              suffix={`· ${summary.inCount} зап.`}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="Расход (кол-во)"
              value={summary.outQty}
              valueStyle={{ color: '#cf1322' }}
              prefix={<ArrowDownOutlined />}
              suffix={`· ${summary.outCount} зап.`}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="Разница (приход − расход)"
              value={summary.inQty - summary.outQty}
              valueStyle={{ color: summary.inQty - summary.outQty >= 0 ? '#3f8600' : '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      {dailyTotals.length > 0 && (
        <Card size="small" title="Ежедневные итоги" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {dailyTotals.slice(0, 31).map((d) => (
              <Tooltip
                key={d.date}
                title={`${d.count} записей · приход ${d.inQty} · расход ${d.outQty}`}
              >
                <Tag style={{ padding: '4px 8px', margin: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.4 }}>
                    <Typography.Text strong style={{ fontSize: 12 }}>
                      {dayjs(d.date).format('DD.MM.YYYY')}
                    </Typography.Text>
                    <span style={{ fontSize: 11 }}>
                      <span style={{ color: '#3f8600' }}>+{d.inQty}</span>
                      {' / '}
                      <span style={{ color: '#cf1322' }}>-{d.outQty}</span>
                    </span>
                  </div>
                </Tag>
              </Tooltip>
            ))}
          </div>
        </Card>
      )}

      {isMobile ? (
        <MobileCardList
          data={movements ?? []}
          rowKey="id"
          loading={isLoading}
          renderCard={(m: any) => {
            const cfg = typeConfig[m.type] || typeConfig.OUT;
            return (
              <Card
                size="small"
                style={{ marginBottom: 0, cursor: 'pointer' }}
                onClick={() => setSelectedMovement(m)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <Tag color={cfg.color} icon={cfg.icon} style={{ margin: 0, flexShrink: 0 }}>{cfg.label}</Tag>
                    <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>{m.product?.name}</Typography.Text>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap', marginLeft: 8, flexShrink: 0 }}>
                    {dayjs(m.eventDate ?? m.createdAt).format('DD.MM.YYYY')}
                  </Typography.Text>
                </div>
              </Card>
            );
          }}
        />
      ) : (
        <Table
          dataSource={movements}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          size="middle"
          bordered={false}
          scroll={{ x: 700 }}
        />
      )}
    </div>
  );
}
