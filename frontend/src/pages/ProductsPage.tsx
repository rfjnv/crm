import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Typography, message,
  Tag, Space, DatePicker, theme, Segmented, Popconfirm, Card, Pagination,
  Drawer, Statistic, Row, Col, Slider, Progress, Badge, Switch, Popover, Checkbox,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, BarChartOutlined,
  ApartmentOutlined, UnorderedListOutlined, ThunderboltOutlined,
  FilterOutlined, ClearOutlined, TableOutlined, EyeInvisibleOutlined, EyeOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { inventoryApi } from '../api/warehouse.api';
import { usersApi } from '../api/users.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { matchesSearch } from '../utils/translit';
import type { Product } from '../types';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';
import { useIsMobile } from '../hooks/useIsMobile';
import ProductAuditHistoryPanel from '../components/ProductAuditHistoryPanel';
import ProductHierarchyPanel from '../components/ProductHierarchyPanel';

/** Товары с параллельным остатком в рулонах (ламинация) показываем как «N рул. (кг)»,
 * как в исходном складском учёте — сначала физическое кол-во рулонов, вес в скобках. */
function formatStockCell(stock: number, rollStock?: number | null): string {
  const kg = Number.isInteger(stock) ? stock : parseFloat(stock.toFixed(3));
  if (rollStock == null) return String(kg);
  const rolls = Number.isInteger(rollStock) ? rollStock : parseFloat(rollStock.toFixed(3));
  return `${rolls} рул. (${kg} кг)`;
}

export default function ProductsPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [countryFilter, setCountryFilter] = useState<string | undefined>();
  const [unitFilter, setUnitFilter] = useState<string | undefined>();
  const [formatFilter, setFormatFilter] = useState<string | undefined>();
  const [stockFilter, setStockFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<string>('active');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [priceRange, setPriceRange] = useState<[number, number] | null>(null);
  const [showExtraFilters, setShowExtraFilters] = useState(false);

  // Selection
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Hidden rows
  const ROW_STORAGE_KEY = 'products_hidden_rows';
  const [hiddenRowIds, setHiddenRowIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(ROW_STORAGE_KEY) || '[]'); } catch { return []; }
  });
  const [showHidden, setShowHidden] = useState(false);

  function hideRow(id: string) {
    setHiddenRowIds((prev) => {
      const next = [...prev, id];
      localStorage.setItem(ROW_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function unhideRow(id: string) {
    setHiddenRowIds((prev) => {
      const next = prev.filter((x) => x !== id);
      localStorage.setItem(ROW_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearHiddenRows() {
    setHiddenRowIds([]);
    localStorage.removeItem(ROW_STORAGE_KEY);
  }

  const [mobilePage, setMobilePage] = useState(1);
  const mobilePageSize = 20;
  const [listMode, setListMode] = useState<'table' | 'hierarchy'>('table');
  const queryClient = useQueryClient();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canManageProducts = isSuperAdmin || (user?.permissions ?? []).includes('manage_products');

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: usersApi.listCompanies,
    enabled: isSuperAdmin,
  });

  const ALL_COLUMN_KEYS = [
    { key: 'sku', label: 'Артикул' },
    { key: 'format', label: 'Формат' },
    { key: 'category', label: 'Категория' },
    { key: 'countryOfOrigin', label: 'Страна' },
    { key: 'unit', label: 'Ед. изм.' },
    { key: 'stock', label: 'Остаток' },
    { key: 'minStock', label: 'Мин. остаток' },
    ...(isSuperAdmin ? [{ key: 'purchasePrice', label: 'Цена закупки' }] : []),
    { key: 'salePrice', label: 'Цена продажи' },
    { key: 'installmentPrice', label: 'Цена рассрочки' },
    { key: 'isActive', label: 'Статус' },
  ];

  const STORAGE_KEY = 'products_hidden_columns';
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  });

  function toggleColumn(key: string) {
    setHiddenColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    setMobilePage(1);
    setSelectedRowKeys([]);
  }, [debouncedSearch, categoryFilter, countryFilter, unitFilter, formatFilter, stockFilter, activeFilter, priceRange]);

  // Price bounds for slider
  const priceBounds = useMemo(() => {
    const prices = (products ?? [])
      .map((p) => Number(p.salePrice || 0))
      .filter((p) => p > 0);
    if (!prices.length) return [0, 0] as [number, number];
    return [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))] as [number, number];
  }, [products]);

  const filtered = useMemo(() => {
    return (products ?? []).filter((p) => {
      if (!showHidden && hiddenRowIds.includes(p.id)) return false;
      if (showHidden && !hiddenRowIds.includes(p.id)) return false;
      if (debouncedSearch) {
        const haystack = [p.name, p.sku ?? '', p.category ?? '', p.countryOfOrigin ?? '', p.format ?? ''].join(' ');
        if (!matchesSearch(haystack, debouncedSearch)) return false;
      }
      if (!showHidden) {
        if (activeFilter === 'active' && !p.isActive) return false;
        if (activeFilter === 'inactive' && p.isActive) return false;
        if (categoryFilter && p.category !== categoryFilter) return false;
        if (countryFilter && p.countryOfOrigin !== countryFilter) return false;
        if (unitFilter && p.unit !== unitFilter) return false;
        if (formatFilter && p.format !== formatFilter) return false;
        if (stockFilter === 'zero' && Number(p.stock) !== 0) return false;
        if (stockFilter === 'low' && !(Number(p.stock) > 0 && Number(p.stock) < Number(p.minStock))) return false;
        if (priceRange) {
          const price = Number(p.salePrice || 0);
          if (price < priceRange[0] || price > priceRange[1]) return false;
        }
      }
      return true;
    });
  }, [products, debouncedSearch, activeFilter, categoryFilter, countryFilter, unitFilter, formatFilter, stockFilter, priceRange, hiddenRowIds, showHidden]);

  const filteredMobileSlice = useMemo(() => {
    const start = (mobilePage - 1) * mobilePageSize;
    return filtered.slice(start, start + mobilePageSize);
  }, [filtered, mobilePage, mobilePageSize]);

  // Analytics target: selected rows if any, otherwise all filtered
  const analyticsTarget = useMemo(() => {
    if (selectedRowKeys.length > 0) {
      return filtered.filter((p) => selectedRowKeys.includes(p.id));
    }
    return filtered;
  }, [filtered, selectedRowKeys]);

  const categories = [...new Set((products ?? []).map((p) => p.category).filter(Boolean))] as string[];
  const countries = [...new Set((products ?? []).map((p) => p.countryOfOrigin).filter(Boolean))] as string[];
  const units = [...new Set((products ?? []).map((p) => p.unit).filter(Boolean))] as string[];
  const formats = [...new Set((products ?? []).map((p) => p.format).filter(Boolean))] as string[];

  const hasExtraFilters = !!(unitFilter || formatFilter || priceRange);
  const activeFiltersCount = [categoryFilter, countryFilter, unitFilter, formatFilter, priceRange].filter(Boolean).length
    + (stockFilter !== 'all' ? 1 : 0)
    + (activeFilter !== 'active' ? 1 : 0);

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => inventoryApi.createProduct(data as Parameters<typeof inventoryApi.createProduct>[0]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Товар создан');
      setOpen(false);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      inventoryApi.updateProduct(id, data as Parameters<typeof inventoryApi.updateProduct>[1]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Товар обновлён');
      setEditProduct(null);
    },
    onError: (err: unknown) => {
      const resp = (err as { response?: { data?: { error?: string; details?: string[] } } })?.response?.data;
      const msg = resp?.details?.join(', ') || resp?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Товар удалён');
    },
    onError: (err: unknown) => {
      const resp = (err as { response?: { data?: { error?: string; details?: string[] } } })?.response?.data;
      const msg = resp?.details?.join(', ') || resp?.error || 'Ошибка';
      message.error(msg);
    },
  });

  function openEditForm(r: Product) {
    setEditProduct(r);
    editForm.setFieldsValue({
      name: r.name,
      sku: r.sku,
      unit: r.unit,
      format: r.format,
      category: r.category,
      countryOfOrigin: r.countryOfOrigin,
      minStock: r.minStock,
      purchasePrice: r.purchasePrice ? Number(r.purchasePrice) : undefined,
      salePrice: r.salePrice ? Number(r.salePrice) : undefined,
      installmentPrice: r.installmentPrice ? Number(r.installmentPrice) : undefined,
      manufacturedAt: r.manufacturedAt ? dayjs(r.manufacturedAt) : null,
      expiresAt: r.expiresAt ? dayjs(r.expiresAt) : null,
      isActive: r.isActive,
    });
  }

  function clearAllFilters() {
    setCategoryFilter(undefined);
    setCountryFilter(undefined);
    setUnitFilter(undefined);
    setFormatFilter(undefined);
    setStockFilter('all');
    setActiveFilter('active');
    setSearchInput('');
    setPriceRange(null);
    setSelectedRowKeys([]);
  }

  const allColumns = [
    {
      key: 'name',
      title: 'Название',
      dataIndex: 'name',
      fixed: true,
      render: (v: string, r: Product) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/inventory/products/${r.id}`)}>
          {v}
        </Button>
      ),
    },
    { key: 'sku', title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
    { key: 'format', title: 'Формат', dataIndex: 'format', render: (v: string | null) => v || '—' },
    { key: 'category', title: 'Категория', dataIndex: 'category', render: (v: string | null) => v || '—' },
    { key: 'countryOfOrigin', title: 'Страна', dataIndex: 'countryOfOrigin', render: (v: string | null) => v || '—' },
    { key: 'unit', title: 'Ед. изм.', dataIndex: 'unit', width: 80 },
    {
      key: 'stock',
      title: 'Остаток',
      dataIndex: 'stock',
      align: 'right' as const,
      width: 130,
      sorter: (a: Product, b: Product) => Number(a.stock) - Number(b.stock),
      render: (v: number, r: Product) => {
        const stock = Number(v);
        const min = Number(r.minStock || 10);
        return (
          <span style={{ fontWeight: 600, color: stock === 0 ? token.colorTextDisabled : stock < min ? token.colorError : token.colorSuccess }}>
            {formatStockCell(stock, r.rollStock)}
          </span>
        );
      },
    },
    { key: 'minStock', title: 'Мин. остаток', dataIndex: 'minStock', align: 'right' as const, width: 100 },
    ...(isSuperAdmin ? [{
      key: 'purchasePrice',
      title: 'Цена закупки',
      dataIndex: 'purchasePrice',
      align: 'right' as const,
      width: 130,
      sorter: (a: Product, b: Product) => Number(a.purchasePrice || 0) - Number(b.purchasePrice || 0),
      render: (v: string | null) => v ? formatUZS(v) : '—',
    }] : []),
    {
      key: 'salePrice',
      title: 'Цена продажи',
      dataIndex: 'salePrice',
      align: 'right' as const,
      width: 130,
      sorter: (a: Product, b: Product) => Number(a.salePrice || 0) - Number(b.salePrice || 0),
      render: (v: string | null) => v ? formatUZS(v) : '—',
    },
    {
      key: 'installmentPrice',
      title: 'Цена рассрочки',
      dataIndex: 'installmentPrice',
      align: 'right' as const,
      width: 130,
      render: (v: string | null) => v ? formatUZS(v) : '—',
    },
    {
      key: 'isActive',
      title: 'Статус',
      dataIndex: 'isActive',
      width: canManageProducts ? 90 : 100,
      render: (v: boolean, r: Product) =>
        canManageProducts ? (
          <Switch
            size="small"
            checked={v}
            checkedChildren="Акт."
            unCheckedChildren="Неакт."
            loading={updateMut.isPending && editProduct?.id === r.id}
            onChange={(checked) => updateMut.mutate({ id: r.id, data: { isActive: checked } })}
          />
        ) : (
          <Tag color={v ? 'green' : 'default'}>{v ? 'Активен' : 'Неактивен'}</Tag>
        ),
    },
    {
      key: '_actions',
      title: '',
      width: canManageProducts ? 110 : 50,
      render: (_: unknown, r: Product) => (
        <Space size={0}>
          {showHidden ? (
            <Button
              type="text"
              icon={<EyeOutlined />}
              size="small"
              title="Показать в списке"
              onClick={() => unhideRow(r.id)}
            />
          ) : (
            <Button
              type="text"
              icon={<EyeInvisibleOutlined />}
              size="small"
              title="Скрыть из списка"
              onClick={() => hideRow(r.id)}
            />
          )}
          {canManageProducts && !showHidden && (
            <>
              <Button
                type="text"
                icon={<BarChartOutlined />}
                size="small"
                onClick={() => navigate(`/inventory/products/${r.id}`)}
              />
              <Button
                type="text"
                icon={<EditOutlined />}
                size="small"
                onClick={() => openEditForm(r)}
              />
              <Popconfirm
                title="Удалить товар?"
                description={`«${r.name}» будет удалён`}
                onConfirm={() => deleteMut.mutate(r.id)}
                okText="Удалить"
                cancelText="Отмена"
                okButtonProps={{ danger: true }}
              >
                <Button type="text" icon={<DeleteOutlined />} size="small" danger />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  const columns = allColumns.filter((c) => !hiddenColumns.includes(c.key));

  // ── Quick analytics computation ──────────────────────────────────
  const analytics = useMemo(() => {
    const items = analyticsTarget;
    const totalCount = items.length;
    const zeroStock = items.filter((p) => Number(p.stock) === 0).length;
    const lowStock = items.filter((p) => Number(p.stock) > 0 && Number(p.stock) < Number(p.minStock || 10)).length;
    const okStock = totalCount - zeroStock - lowStock;

    const totalStockValueSale = items.reduce((s, p) => s + Number(p.stock) * Number(p.salePrice || 0), 0);
    const totalStockValuePurchase = items.reduce((s, p) => s + Number(p.stock) * Number(p.purchasePrice || 0), 0);
    const totalUnits = items.reduce((s, p) => s + Number(p.stock), 0);

    // By category
    const catMap: Record<string, { count: number; stockValue: number }> = {};
    for (const p of items) {
      const cat = p.category || '(без категории)';
      if (!catMap[cat]) catMap[cat] = { count: 0, stockValue: 0 };
      catMap[cat].count++;
      catMap[cat].stockValue += Number(p.stock) * Number(p.salePrice || 0);
    }
    const byCategory = Object.entries(catMap)
      .map(([cat, v]) => ({ cat, ...v }))
      .sort((a, b) => b.stockValue - a.stockValue)
      .slice(0, 8);

    // Top by sale stock value
    const topByValue = [...items]
      .filter((p) => Number(p.stock) > 0)
      .sort((a, b) => Number(b.stock) * Number(b.salePrice || 0) - Number(a.stock) * Number(a.salePrice || 0))
      .slice(0, 10);

    return { totalCount, zeroStock, lowStock, okStock, totalStockValueSale, totalStockValuePurchase, totalUnits, byCategory, topByValue };
  }, [analyticsTarget]);

  const analyticsLabel = selectedRowKeys.length > 0
    ? `Аналитика (${selectedRowKeys.length} выбрано)`
    : `Аналитика (${filtered.length} товаров)`;

  return (
    <div>
      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="Поиск по названию, артикулу, формату..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: '100%', maxWidth: isMobile ? '100%' : 420 }}
        />
      </div>

      {/* Controls row */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
          alignItems: isMobile ? 'stretch' : 'flex-start',
          justifyContent: 'space-between',
          gap: isMobile ? 12 : 16,
          marginBottom: showExtraFilters ? 8 : 16,
        }}
      >
        <Space direction={isMobile ? 'vertical' : 'horizontal'} size={isMobile ? 8 : 12} style={{ width: isMobile ? '100%' : 'auto' }} wrap>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Товары
            {activeFiltersCount > 0 && (
              <Badge count={activeFiltersCount} size="small" style={{ marginLeft: 8, backgroundColor: token.colorPrimary }} />
            )}
          </Typography.Title>
          <Segmented
            value={listMode}
            onChange={(v) => setListMode(v as 'table' | 'hierarchy')}
            options={[
              { label: isMobile ? 'Список' : <><UnorderedListOutlined /> Список</>, value: 'table' },
              { label: isMobile ? 'Дерево' : <><ApartmentOutlined /> Иерархия</>, value: 'hierarchy' },
            ]}
          />
          <Select
            allowClear
            placeholder="Категория"
            style={{ width: isMobile ? '100%' : 160 }}
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categories.map((c) => ({ label: c, value: c }))}
          />
          <Select
            allowClear
            placeholder="Страна"
            style={{ width: isMobile ? '100%' : 140 }}
            value={countryFilter}
            onChange={setCountryFilter}
            options={countries.map((c) => ({ label: c, value: c }))}
          />
          <Segmented
            value={stockFilter}
            onChange={(v) => setStockFilter(v as string)}
            options={[
              { label: 'Все', value: 'all' },
              { label: 'Мало', value: 'low' },
              { label: 'Нет', value: 'zero' },
            ]}
            block={isMobile}
          />
          <Select
            value={activeFilter}
            onChange={setActiveFilter}
            style={{ width: isMobile ? '100%' : 150 }}
            options={[
              { label: 'Активные', value: 'active' },
              { label: 'Неактивные', value: 'inactive' },
              { label: 'Все товары', value: 'all' },
            ]}
          />
          <Button
            icon={<FilterOutlined />}
            onClick={() => setShowExtraFilters((v) => !v)}
            type={showExtraFilters || hasExtraFilters ? 'primary' : 'default'}
            ghost={showExtraFilters || hasExtraFilters}
          >
            {isMobile ? 'Ещё' : 'Доп. фильтры'}
          </Button>
          {activeFiltersCount > 0 && (
            <Button icon={<ClearOutlined />} onClick={clearAllFilters} type="text">
              Сбросить
            </Button>
          )}
        </Space>

        <Space wrap style={{ width: isMobile ? '100%' : 'auto' }}>
          <Button
            icon={<ThunderboltOutlined />}
            onClick={() => setAnalyticsOpen(true)}
            type="default"
            block={isMobile}
          >
            {selectedRowKeys.length > 0 ? `Аналитика (${selectedRowKeys.length})` : 'Аналитика'}
          </Button>
          {(hiddenRowIds.length > 0 || showHidden) && (
            <Button
              icon={showHidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              type={showHidden ? 'primary' : 'default'}
              ghost={showHidden}
              block={isMobile}
              onClick={() => setShowHidden((v) => !v)}
            >
              {showHidden ? 'Список' : `Скрытые (${hiddenRowIds.length})`}
            </Button>
          )}
          {showHidden && hiddenRowIds.length > 0 && (
            <Button size="small" danger onClick={clearHiddenRows}>
              Восстановить все
            </Button>
          )}
          {!isMobile && (
            <Popover
              trigger="click"
              placement="bottomRight"
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Столбцы</span>
                  {hiddenColumns.length > 0 && (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0 }}
                      onClick={() => { setHiddenColumns([]); localStorage.removeItem(STORAGE_KEY); }}
                    >
                      Показать все
                    </Button>
                  )}
                </div>
              }
              content={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
                  {ALL_COLUMN_KEYS.map(({ key, label }) => (
                    <Checkbox
                      key={key}
                      checked={!hiddenColumns.includes(key)}
                      onChange={() => toggleColumn(key)}
                    >
                      {label}
                    </Checkbox>
                  ))}
                </div>
              }
            >
              <Button
                icon={<TableOutlined />}
                type={hiddenColumns.length > 0 ? 'primary' : 'default'}
                ghost={hiddenColumns.length > 0}
              >
                Столбцы{hiddenColumns.length > 0 ? ` (−${hiddenColumns.length})` : ''}
              </Button>
            </Popover>
          )}
          {isSuperAdmin && (
            <Button onClick={() => setAuditOpen(true)} block={isMobile}>
              История аудита
            </Button>
          )}
          {canManageProducts && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)} block={isMobile}>
              Добавить
            </Button>
          )}
        </Space>
      </div>

      {/* Extra filters row */}
      {showExtraFilters && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            padding: '12px 16px',
            marginBottom: 16,
            background: token.colorFillQuaternary,
            borderRadius: token.borderRadius,
          }}
        >
          <Select
            allowClear
            placeholder="Ед. измерения"
            style={{ width: 140 }}
            value={unitFilter}
            onChange={setUnitFilter}
            options={units.map((u) => ({ label: u, value: u }))}
          />
          <Select
            allowClear
            placeholder="Формат"
            style={{ width: 180 }}
            value={formatFilter}
            onChange={setFormatFilter}
            showSearch
            options={formats.map((f) => ({ label: f, value: f }))}
          />
          {priceBounds[1] > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                Цена продажи:
              </Typography.Text>
              <Slider
                range
                min={priceBounds[0]}
                max={priceBounds[1]}
                value={priceRange ?? priceBounds}
                onChange={(v) => {
                  const [lo, hi] = v as [number, number];
                  if (lo === priceBounds[0] && hi === priceBounds[1]) {
                    setPriceRange(null);
                  } else {
                    setPriceRange([lo, hi]);
                  }
                }}
                style={{ width: 200 }}
                tooltip={{ formatter: (v) => formatUZS(v ?? 0) }}
              />
              {priceRange && (
                <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {formatUZS(priceRange[0])} — {formatUZS(priceRange[1])}
                </Typography.Text>
              )}
            </div>
          )}
        </div>
      )}

      {/* Selection bar */}
      {selectedRowKeys.length > 0 && listMode === 'table' && !isMobile && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 16px',
            marginBottom: 12,
            background: token.colorPrimaryBg,
            border: `1px solid ${token.colorPrimaryBorder}`,
            borderRadius: token.borderRadius,
          }}
        >
          <Typography.Text strong style={{ color: token.colorPrimary }}>
            Выбрано: {selectedRowKeys.length} из {filtered.length}
          </Typography.Text>
          <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={() => setAnalyticsOpen(true)}>
            Аналитика по выбранным
          </Button>
          <Button size="small" onClick={() => setSelectedRowKeys([])}>
            Снять выбор
          </Button>
        </div>
      )}

      {listMode === 'hierarchy' ? (
        <ProductHierarchyPanel
          products={filtered}
          loading={isLoading}
          canManage={canManageProducts}
          searchHint={
            debouncedSearch || categoryFilter || countryFilter || stockFilter !== 'all' || activeFilter !== 'active'
              ? 'Показаны товары по текущим фильтрам и поиску.'
              : undefined
          }
          onEditProduct={(p) => openEditForm(p)}
          onAddProductInCategory={(category) => {
            setOpen(true);
            form.resetFields();
            form.setFieldsValue({ category, unit: 'шт', minStock: 0 });
          }}
        />
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredMobileSlice.map((p) => {
            const stock = Number(p.stock);
            const min = Number(p.minStock || 10);
            const stockColor =
              stock === 0 ? token.colorTextDisabled : stock < min ? token.colorError : token.colorSuccess;
            return (
              <Card
                key={p.id}
                size="small"
                hoverable
                styles={{ body: { padding: 12 } }}
                onClick={() => navigate(`/inventory/products/${p.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Typography.Text strong ellipsis style={{ display: 'block' }}>
                      {p.name}
                    </Typography.Text>
                    <Tag style={{ marginTop: 4 }}>{p.sku}</Tag>
                    {p.category && (
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                        {p.category}
                      </Typography.Text>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <Typography.Text strong style={{ fontSize: 16, color: stockColor }}>
                      {formatStockCell(stock, p.rollStock)}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      мин {min}
                    </Typography.Text>
                    {p.salePrice != null && (
                      <Typography.Text style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                        {formatUZS(Number(p.salePrice))}
                      </Typography.Text>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
          {filtered.length === 0 && !isLoading && (
            <Typography.Text type="secondary">Нет товаров по фильтрам</Typography.Text>
          )}
          {filtered.length > mobilePageSize && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
              <Pagination
                size="small"
                current={mobilePage}
                pageSize={mobilePageSize}
                total={filtered.length}
                onChange={setMobilePage}
                showSizeChanger={false}
              />
            </div>
          )}
        </div>
      ) : (
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          size="middle"
          bordered={false}
          scroll={{ x: 600 }}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            preserveSelectedRowKeys: false,
          }}
        />
      )}

      {/* Create Modal */}
      <Modal
        title="Новый товар"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="Создать"
        cancelText="Отмена"
        width={isMobile ? '100%' : 560}
      >
        <Form form={form} layout="vertical" onFinish={(v) => {
          const data = {
            ...v,
            manufacturedAt: v.manufacturedAt ? v.manufacturedAt.toISOString() : undefined,
            expiresAt: v.expiresAt ? v.expiresAt.toISOString() : undefined,
          };
          createMut.mutate(data);
        }}>
          <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sku" label="Артикул (SKU)" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input />
          </Form.Item>
          {isSuperAdmin && (
            <Form.Item
              name="companyId"
              label="Компания"
              rules={[{ required: true, message: 'Выберите компанию' }]}
            >
              <Select
                placeholder="Выберите компанию"
                options={companies.map((c) => ({ value: c.id, label: c.displayName }))}
              />
            </Form.Item>
          )}
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="unit" label="Единица измерения" initialValue="шт" style={{ flex: 1 }}>
              <Select options={[
                { label: 'шт', value: 'шт' },
                { label: 'кг', value: 'кг' },
                { label: 'литр', value: 'литр' },
                { label: 'лист', value: 'лист' },
                { label: 'пачка', value: 'пачка' },
                { label: 'рулон', value: 'рулон' },
                { label: 'м²', value: 'м²' },
                { label: 'п/м', value: 'п/м' },
                { label: 'бабина', value: 'бабина' },
              ]} />
            </Form.Item>
            <Form.Item name="format" label="Формат" style={{ flex: 1 }}>
              <Input placeholder="A4, 72×104, 640мм..." />
            </Form.Item>
          </Space>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="category" label="Категория" style={{ flex: 1 }}>
              <Input placeholder="Бумага, Тонер..." />
            </Form.Item>
            <Form.Item name="countryOfOrigin" label="Страна производства" style={{ flex: 1 }}>
              <Input placeholder="Узбекистан, Китай..." />
            </Form.Item>
          </Space>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="minStock" label="Мин. остаток" initialValue={0} style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="salePrice" label="Цена продажи" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
            </Form.Item>
          </Space>
          {isSuperAdmin && (
            <Form.Item name="purchasePrice" label="Цена закупки">
              <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
            </Form.Item>
          )}
          <Form.Item name="installmentPrice" label="Цена рассрочки">
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="manufacturedAt" label="Дата производства" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="expiresAt" label="Годен до" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="Редактирование товара"
        open={!!editProduct}
        onCancel={() => setEditProduct(null)}
        onOk={() => editForm.submit()}
        confirmLoading={updateMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        width={isMobile ? '100%' : 560}
      >
        <Form form={editForm} layout="vertical" onFinish={(v) => {
          if (!editProduct) return;
          const data = {
            ...v,
            manufacturedAt: v.manufacturedAt ? v.manufacturedAt.toISOString() : null,
            expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
          };
          updateMut.mutate({ id: editProduct.id, data });
        }}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sku" label="Артикул (SKU)" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="unit" label="Единица измерения" style={{ flex: 1 }}>
              <Select options={[
                { label: 'шт', value: 'шт' },
                { label: 'кг', value: 'кг' },
                { label: 'литр', value: 'литр' },
                { label: 'лист', value: 'лист' },
                { label: 'пачка', value: 'пачка' },
                { label: 'рулон', value: 'рулон' },
                { label: 'м²', value: 'м²' },
                { label: 'п/м', value: 'п/м' },
                { label: 'бабина', value: 'бабина' },
              ]} />
            </Form.Item>
            <Form.Item name="format" label="Формат" style={{ flex: 1 }}>
              <Input placeholder="A4, 72×104, 640мм..." />
            </Form.Item>
          </Space>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="category" label="Категория" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="countryOfOrigin" label="Страна производства" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="minStock" label="Мин. остаток" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="salePrice" label="Цена продажи" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
            </Form.Item>
          </Space>
          {isSuperAdmin && (
            <Form.Item name="purchasePrice" label="Цена закупки">
              <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
            </Form.Item>
          )}
          <Form.Item name="installmentPrice" label="Цена рассрочки">
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="manufacturedAt" label="Дата производства" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="expiresAt" label="Годен до" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Space>
          <Form.Item name="isActive" label="Статус">
            <Select options={[{ label: 'Активен', value: true }, { label: 'Неактивен', value: false }]} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Audit History Modal */}
      <Modal
        title="История аудита товаров"
        open={auditOpen}
        onCancel={() => setAuditOpen(false)}
        footer={null}
        width={isMobile ? '100%' : 700}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <ProductAuditHistoryPanel />
      </Modal>

      {/* Quick Analytics Drawer */}
      <Drawer
        title={analyticsLabel}
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        width={isMobile ? '100%' : 520}
        extra={
          selectedRowKeys.length > 0 && (
            <Button size="small" onClick={() => setSelectedRowKeys([])}>
              Снять выбор
            </Button>
          )
        }
      >
        {/* Summary stats */}
        <Row gutter={[12, 12]}>
          <Col span={8}>
            <Card size="small" styles={{ body: { padding: '12px 10px' } }}>
              <Statistic
                title="Товаров"
                value={analytics.totalCount}
                valueStyle={{ fontSize: 22 }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" styles={{ body: { padding: '12px 10px' } }}>
              <Statistic
                title="Ед. на складе"
                value={analytics.totalUnits}
                valueStyle={{ fontSize: 22 }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card
              size="small"
              styles={{ body: { padding: '12px 10px' } }}
              style={{ borderColor: analytics.zeroStock > 0 ? token.colorError : undefined }}
            >
              <Statistic
                title="Нет остатка"
                value={analytics.zeroStock}
                valueStyle={{ fontSize: 22, color: analytics.zeroStock > 0 ? token.colorError : undefined }}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
          <Col span={12}>
            <Card size="small" styles={{ body: { padding: '12px 10px' } }}>
              <Statistic
                title="Стоимость (по цене продажи)"
                value={analytics.totalStockValueSale}
                formatter={(v) => formatUZS(Number(v))}
                valueStyle={{ fontSize: 16, color: token.colorSuccess }}
              />
            </Card>
          </Col>
          {isSuperAdmin && (
            <Col span={12}>
              <Card size="small" styles={{ body: { padding: '12px 10px' } }}>
                <Statistic
                  title="Стоимость (по цене закупки)"
                  value={analytics.totalStockValuePurchase}
                  formatter={(v) => formatUZS(Number(v))}
                  valueStyle={{ fontSize: 16 }}
                />
              </Card>
            </Col>
          )}
        </Row>

        {/* Stock health */}
        <div style={{ marginTop: 20, marginBottom: 8, borderBottom: `1px solid ${token.colorBorder}`, paddingBottom: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Состояние остатков</Typography.Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text style={{ color: token.colorSuccess }}>В норме</Typography.Text>
            <Typography.Text strong>{analytics.okStock}</Typography.Text>
          </div>
          <Progress
            percent={analytics.totalCount ? Math.round((analytics.okStock / analytics.totalCount) * 100) : 0}
            strokeColor={token.colorSuccess}
            showInfo={false}
            size="small"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text style={{ color: token.colorWarning }}>Мало (ниже мин.)</Typography.Text>
            <Typography.Text strong>{analytics.lowStock}</Typography.Text>
          </div>
          <Progress
            percent={analytics.totalCount ? Math.round((analytics.lowStock / analytics.totalCount) * 100) : 0}
            strokeColor={token.colorWarning}
            showInfo={false}
            size="small"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text style={{ color: token.colorError }}>Нет в наличии</Typography.Text>
            <Typography.Text strong>{analytics.zeroStock}</Typography.Text>
          </div>
          <Progress
            percent={analytics.totalCount ? Math.round((analytics.zeroStock / analytics.totalCount) * 100) : 0}
            strokeColor={token.colorError}
            showInfo={false}
            size="small"
          />
        </div>

        {/* By category */}
        {analytics.byCategory.length > 0 && (
          <>
            <div style={{ marginTop: 20, marginBottom: 8, borderBottom: `1px solid ${token.colorBorder}`, paddingBottom: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>По категориям (стоимость склада)</Typography.Text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {analytics.byCategory.map(({ cat, count, stockValue }) => (
                <div key={cat}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Typography.Text ellipsis style={{ maxWidth: '55%' }}>{cat}</Typography.Text>
                    <Space size={8}>
                      <Tag style={{ margin: 0 }}>{count} поз.</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatUZS(stockValue)}
                      </Typography.Text>
                    </Space>
                  </div>
                  <Progress
                    percent={analytics.totalStockValueSale > 0 ? Math.round((stockValue / analytics.totalStockValueSale) * 100) : 0}
                    strokeColor={token.colorPrimary}
                    showInfo={false}
                    size="small"
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Top by stock value */}
        {analytics.topByValue.length > 0 && (
          <>
            <div style={{ marginTop: 20, marginBottom: 8, borderBottom: `1px solid ${token.colorBorder}`, paddingBottom: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Топ-10 по стоимости склада</Typography.Text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {analytics.topByValue.map((p, i) => {
                const val = Number(p.stock) * Number(p.salePrice || 0);
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 8px',
                      background: i % 2 === 0 ? token.colorFillQuaternary : 'transparent',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                    onClick={() => { setAnalyticsOpen(false); navigate(`/inventory/products/${p.id}`); }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 11, minWidth: 16 }}>
                        {i + 1}.
                      </Typography.Text>
                      <Typography.Text ellipsis style={{ maxWidth: 220 }}>{p.name}</Typography.Text>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <Typography.Text strong style={{ fontSize: 12 }}>
                        {formatUZS(val)}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                        {formatStockCell(Number(p.stock), p.rollStock)} {p.rollStock == null ? p.unit : ''}
                      </Typography.Text>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
