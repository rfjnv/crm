import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Typography, message,
  Tag, Space, DatePicker, theme, Segmented, Card, Pagination,
  Drawer, Statistic, Row, Col, Slider, Progress, Badge, Switch, Popover, Checkbox,
  Dropdown, Popconfirm, Tooltip,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, BarChartOutlined,
  ApartmentOutlined, UnorderedListOutlined, ThunderboltOutlined,
  FilterOutlined, ClearOutlined, TableOutlined, MoreOutlined, LockOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { inventoryApi } from '../api/warehouse.api';
import { usersApi } from '../api/users.api';
import { clientsApi } from '../api/clients.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { matchesSearch } from '../utils/translit';
import { downloadCsv } from '../utils/csv';
import type { Product, ProductReservation } from '../types';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';
import { useIsMobile } from '../hooks/useIsMobile';
import ProductAuditHistoryPanel from '../components/ProductAuditHistoryPanel';
import ProductHierarchyPanel from '../components/ProductHierarchyPanel';

/** Товары с параллельным остатком в рулонах (ламинация) показываем как «N рул. (кг)»,
 * как в исходном складском учёте — сначала физическое кол-во рулонов, вес в скобках. */
function formatStockCell(stock: number | string | null | undefined, rollStock?: number | string | null): string {
  const kgNum = Number(stock) || 0;
  const kg = Number.isInteger(kgNum) ? kgNum : parseFloat(kgNum.toFixed(3));
  if (rollStock == null) return String(kg);
  const rollNum = Number(rollStock) || 0;
  const rolls = Number.isInteger(rollNum) ? rollNum : parseFloat(rollNum.toFixed(3));
  return `${rolls} рул. (${kg} кг)`;
}

export default function ProductsPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [reserveProduct, setReserveProduct] = useState<Product | null>(null);
  const [reservationsProduct, setReservationsProduct] = useState<Product | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [reserveForm] = Form.useForm();

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

  function hideSelected() {
    const ids = selectedRowKeys.map(String);
    setHiddenRowIds((prev) => {
      const next = [...new Set([...prev, ...ids])];
      localStorage.setItem(ROW_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedRowKeys([]);
  }

  function unhideSelected() {
    const ids = new Set(selectedRowKeys.map(String));
    setHiddenRowIds((prev) => {
      const next = prev.filter((id) => !ids.has(id));
      localStorage.setItem(ROW_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedRowKeys([]);
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
  const canReserve = !!user?.permissions?.includes('manage_inventory');

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: usersApi.listCompanies,
    enabled: isSuperAdmin,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
    enabled: canReserve,
  });

  const { data: reservations } = useQuery({
    queryKey: ['product-reservations', reservationsProduct?.id],
    queryFn: () => inventoryApi.getProductReservations(reservationsProduct!.id),
    enabled: !!reservationsProduct,
  });

  const ALL_COLUMN_KEYS = [
    { key: 'sku', label: 'Артикул' },
    { key: 'format', label: 'Формат' },
    { key: 'category', label: 'Категория' },
    { key: 'countryOfOrigin', label: 'Страна' },
    { key: 'unit', label: 'Ед. изм.' },
    { key: 'stock', label: 'Остаток' },
    { key: 'reservedQty', label: 'Забронировано' },
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

  const reserveMut = useMutation({
    mutationFn: (data: { productId: string; clientId: string; quantity: number; expiresAt: string; note?: string }) =>
      inventoryApi.createReservation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-reservations'] });
      message.success('Товар забронирован');
      setReserveProduct(null);
      reserveForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const cancelReserveMut = useMutation({
    mutationFn: (id: string) => inventoryApi.cancelReservation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-reservations'] });
      message.success('Бронь отменена');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const fulfillReserveMut = useMutation({
    mutationFn: (id: string) => inventoryApi.fulfillReservation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-reservations'] });
      message.success('Бронь закрыта как использованная');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
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
      fixed: 'left' as const,
      width: 240,
      ellipsis: true,
      render: (v: string, r: Product) => (
        <Button type="link" style={{ padding: 0, whiteSpace: 'normal', textAlign: 'left', height: 'auto' }} onClick={() => navigate(`/inventory/products/${r.id}`)}>
          {v}
        </Button>
      ),
    },
    { key: 'sku', title: 'Артикул', dataIndex: 'sku', width: 130, render: (v: string) => <Tag>{v}</Tag> },
    { key: 'format', title: 'Формат', dataIndex: 'format', width: 120, render: (v: string | null) => v || '—' },
    { key: 'category', title: 'Категория', dataIndex: 'category', width: 150, render: (v: string | null) => v || '—' },
    { key: 'countryOfOrigin', title: 'Страна', dataIndex: 'countryOfOrigin', width: 110, render: (v: string | null) => v || '—' },
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
    {
      key: 'reservedQty',
      title: 'Забронировано',
      dataIndex: 'reservedQty',
      align: 'right' as const,
      width: 130,
      render: (v: number | undefined, r: Product) => {
        const reserved = Number(v) || 0;
        if (reserved <= 0) return <span style={{ color: token.colorTextTertiary }}>—</span>;
        return (
          <Tooltip title={`Доступно к продаже: ${Number(r.availableStock ?? 0)} ${r.unit}`}>
            <Tag color="gold" icon={<LockOutlined />}>{reserved} {r.unit}</Tag>
          </Tooltip>
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
      fixed: 'right' as const,
      width: canManageProducts || canReserve ? 56 : 0,
      render: (_: unknown, r: Product) => {
        if (!canManageProducts && !canReserve) return null;
        const items: NonNullable<MenuProps['items']> = [];
        if (canManageProducts) {
          items.push(
            { key: 'analytics', icon: <BarChartOutlined />, label: 'Аналитика', onClick: () => navigate(`/inventory/products/${r.id}`) },
            { key: 'edit', icon: <EditOutlined />, label: 'Редактировать', onClick: () => openEditForm(r) },
          );
        }
        if (canReserve) {
          items.push({
            key: 'reserve',
            icon: <LockOutlined />,
            label: 'Забронировать',
            onClick: () => { setReserveProduct(r); reserveForm.resetFields(); reserveForm.setFieldsValue({ productId: r.id }); },
          });
          if (Number(r.reservedQty) > 0) {
            items.push({ key: 'reservations', icon: <LockOutlined />, label: 'Брони', onClick: () => setReservationsProduct(r) });
          }
        }
        if (canManageProducts) {
          items.push(
            { type: 'divider' },
            {
              key: 'delete',
              icon: <DeleteOutlined />,
              label: 'Удалить',
              danger: true,
              onClick: () => {
                Modal.confirm({
                  title: 'Удалить товар?',
                  content: `«${r.name}» будет удалён`,
                  okText: 'Удалить',
                  cancelText: 'Отмена',
                  okButtonProps: { danger: true },
                  onOk: () => deleteMut.mutate(r.id),
                });
              },
            },
          );
        }
        return (
          <Dropdown trigger={['click']} menu={{ items }}>
            <Button type="text" icon={<MoreOutlined />} size="small" onClick={(e) => e.stopPropagation()} />
          </Dropdown>
        );
      },
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

  /** Excel в русской локали читает запятую как десятичный разделитель. */
  function csvNumber(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    const s = Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
    return s.replace('.', ',');
  }

  function exportStock() {
    const items = analyticsTarget;
    if (!items.length) {
      message.warning('Нечего выгружать: список пуст');
      return;
    }
    const headers = [
      'Артикул', 'Название', 'Категория', 'Формат', 'Страна', 'Ед. изм.',
      'Остаток (рулоны)', 'Остаток (кг/ед.)', 'Забронировано', 'Мин. остаток',
      ...(isSuperAdmin ? ['Цена закупки'] : []),
      'Цена продажи', 'Статус',
    ];
    const rows = items.map((p) => [
      p.sku ?? '',
      p.name,
      p.category ?? '',
      p.format ?? '',
      p.countryOfOrigin ?? '',
      p.unit,
      // Рулоны отдельной колонкой — только у товаров с параллельным учётом (ламинационная плёнка).
      p.rollStock == null ? '' : csvNumber(p.rollStock),
      csvNumber(p.stock),
      csvNumber(p.reservedQty ?? 0),
      csvNumber(p.minStock),
      ...(isSuperAdmin ? [csvNumber(p.purchasePrice)] : []),
      csvNumber(p.salePrice),
      p.isActive ? 'Активен' : 'Неактивен',
    ]);
    downloadCsv(`Остаток_${dayjs().format('YYYY-MM-DD')}.csv`, headers, rows);
    message.success(`Выгружено товаров: ${items.length}`);
  }

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
          <Button
            icon={<DownloadOutlined />}
            onClick={exportStock}
            block={isMobile}
          >
            {selectedRowKeys.length > 0 ? `Скачать остаток (${selectedRowKeys.length})` : 'Скачать остаток'}
          </Button>
          {(hiddenRowIds.length > 0 || showHidden) && (
            <Button
              type={showHidden ? 'primary' : 'default'}
              ghost={showHidden}
              block={isMobile}
              onClick={() => { setShowHidden((v) => !v); setSelectedRowKeys([]); }}
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
          {showHidden ? (
            <Button size="small" onClick={unhideSelected}>
              Показать отмеченные
            </Button>
          ) : (
            <>
              <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={() => setAnalyticsOpen(true)}>
                Аналитика по выбранным
              </Button>
              <Button size="small" onClick={hideSelected}>
                Скрыть отмеченные
              </Button>
            </>
          )}
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
          scroll={{ x: 1300 }}
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

      {/* Reservation Modal */}
      <Modal
        title={`Бронирование: ${reserveProduct?.name ?? ''}`}
        open={!!reserveProduct}
        onCancel={() => { setReserveProduct(null); reserveForm.resetFields(); }}
        onOk={() => reserveForm.submit()}
        confirmLoading={reserveMut.isPending}
        okText="Забронировать"
        cancelText="Отмена"
      >
        {reserveProduct && (
          <div style={{ marginBottom: 16, color: token.colorTextSecondary }}>
            Доступно к брони: <strong>{Number(reserveProduct.availableStock ?? reserveProduct.stock)} {reserveProduct.unit}</strong>
            {Number(reserveProduct.reservedQty) > 0 && ` (уже забронировано ${Number(reserveProduct.reservedQty)} ${reserveProduct.unit})`}
          </div>
        )}
        <Form
          form={reserveForm}
          layout="vertical"
          onFinish={(v) => {
            if (!reserveProduct) return;
            reserveMut.mutate({
              productId: reserveProduct.id,
              clientId: v.clientId,
              quantity: v.quantity,
              expiresAt: v.expiresAt.endOf('day').toISOString(),
              note: v.note,
            });
          }}
        >
          <Form.Item name="productId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="clientId" label="Клиент" rules={[{ required: true, message: 'Выберите клиента' }]}>
            <Select
              showSearch
              placeholder="Выберите клиента"
              optionFilterProp="label"
              options={(clients ?? []).map((c) => ({ label: c.companyName, value: c.id }))}
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label="Количество"
            rules={[
              { required: true, message: 'Обязательно' },
              {
                validator: (_, value) => {
                  const max = Number(reserveProduct?.availableStock ?? reserveProduct?.stock ?? 0);
                  if (value == null || value <= max) return Promise.resolve();
                  return Promise.reject(new Error(`Максимум доступно: ${max}`));
                },
              },
            ]}
          >
            <InputNumber style={{ width: '100%' }} min={0.001} precision={3} />
          </Form.Item>
          <Form.Item name="expiresAt" label="Забронировано до" rules={[{ required: true, message: 'Укажите срок брони' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
          </Form.Item>
          <Form.Item name="note" label="Примечание">
            <Input.TextArea rows={2} placeholder="Причина брони, договорённость с клиентом..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Reservations List Modal */}
      <Modal
        title={`Брони: ${reservationsProduct?.name ?? ''}`}
        open={!!reservationsProduct}
        onCancel={() => setReservationsProduct(null)}
        footer={null}
        width={isMobile ? '100%' : 700}
      >
        <Table
          dataSource={reservations ?? []}
          rowKey="id"
          pagination={{ pageSize: 15 }}
          size="small"
          scroll={{ x: 600 }}
          columns={[
            { title: 'Клиент', dataIndex: ['client', 'companyName'], render: (v: string | undefined) => v || '—' },
            { title: 'Кол-во', dataIndex: 'quantity', align: 'right' as const, width: 90 },
            {
              title: 'Статус',
              dataIndex: 'status',
              width: 110,
              render: (v: ProductReservation['status']) => {
                const map: Record<ProductReservation['status'], { color: string; text: string }> = {
                  ACTIVE: { color: 'gold', text: 'Активна' },
                  CANCELLED: { color: 'default', text: 'Отменена' },
                  FULFILLED: { color: 'green', text: 'Использована' },
                  EXPIRED: { color: 'red', text: 'Истекла' },
                };
                return <Tag color={map[v].color}>{map[v].text}</Tag>;
              },
            },
            {
              title: 'До',
              dataIndex: 'expiresAt',
              width: 110,
              render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
            },
            { title: 'Менеджер', dataIndex: ['manager', 'fullName'], render: (v: string | undefined) => v || '—' },
            { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
            {
              title: '',
              width: 140,
              render: (_: unknown, r: ProductReservation) =>
                r.status === 'ACTIVE' && canReserve ? (
                  <Space>
                    <Popconfirm title="Отметить бронь как использованную?" onConfirm={() => fulfillReserveMut.mutate(r.id)}>
                      <Button size="small">Выдано</Button>
                    </Popconfirm>
                    <Popconfirm title="Отменить бронь?" onConfirm={() => cancelReserveMut.mutate(r.id)}>
                      <Button size="small" danger>Отменить</Button>
                    </Popconfirm>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Modal>
    </div>
  );
}
