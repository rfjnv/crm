import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  DatePicker, Card, Typography, Tag, Spin, Empty, Button, Space,
  Badge, Progress, Popconfirm, theme, Input, Modal, Form, InputNumber, Segmented, message,
} from 'antd';
import { CheckCircleFilled, SearchOutlined, ToolOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { inventoryApi } from '../api/warehouse.api';
import BackButton from '../components/BackButton';
import { useAuthStore } from '../store/authStore';
import type { Product, UserRole } from '../types';
import './AuditCheckPage.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type StockFilter = 'all' | 'problems' | 'zero' | 'low';

/** Товары с параллельным остатком в рулонах (ламинация) показываем как «N рул. (кг)». */
function formatStockCell(stock: number | string | null | undefined, rollStock?: string | null): string {
  const kgNum = Number(stock) || 0;
  const kg = Number.isInteger(kgNum) ? kgNum : parseFloat(kgNum.toFixed(3));
  if (rollStock == null) return String(kg);
  const rollNum = Number(rollStock) || 0;
  const rolls = Number.isInteger(rollNum) ? rollNum : parseFloat(rollNum.toFixed(3));
  return `${rolls} рул. (${kg} кг)`;
}

function productMatchesSearch(p: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [p.name, p.sku, p.category, p.countryOfOrigin].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q);
}

function useStickyTopOffset() {
  const [top, setTop] = useState(56);
  useEffect(() => {
    const header = document.querySelector('.ant-layout-header');
    if (!header) return;
    const update = () => setTop(header.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return top;
}

// ─── Product card ─────────────────────────────────────────────────────────────

function ProductAuditCard({ product, checked, onToggle, onCorrect, canCorrect }: {
  product: Product;
  checked: boolean;
  onToggle: (id: string) => void;
  onCorrect: (p: Product) => void;
  canCorrect: boolean;
}) {
  const { token } = theme.useToken();
  const stock = Number(product.stock);
  const minStock = Number(product.minStock);
  const isNegative = stock < 0;
  const isBelowMin = !isNegative && minStock > 0 && stock < minStock;

  return (
    <Card
      size="small"
      className={checked ? 'audit-checked-card' : undefined}
      style={checked ? ({
        '--audit-checked-bg': token.colorSuccessBg,
        '--audit-checked-border': token.colorSuccess,
      } as CSSProperties) : undefined}
      title={
        <Space
          wrap
          size={8}
          align="center"
          style={{ cursor: 'pointer', padding: '8px 0', margin: '-8px 0' }}
          onClick={() => onToggle(product.id)}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(product.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={checked ? 'Отметить товар как непроверенный' : 'Отметить товар как проверенный'}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <Typography.Text strong>{product.name}</Typography.Text>
          {product.sku && <Tag style={{ fontSize: 11 }}>{product.sku}</Tag>}
          {product.category && <Tag color="blue">{product.category}</Tag>}
          {!product.isActive && <Tag>Неактивен</Tag>}
          {isNegative && <Tag color="red" icon={<WarningOutlined />}>Отрицательный остаток</Tag>}
          {isBelowMin && <Tag color="orange" icon={<WarningOutlined />}>Ниже минимума</Tag>}
          {checked && (
            <Tag color="success" icon={<CheckCircleFilled />} style={{ margin: 0 }}>
              Проверено
            </Tag>
          )}
        </Space>
      }
      extra={
        canCorrect ? (
          <Button size="small" icon={<ToolOutlined />} onClick={() => onCorrect(product)}>
            Скорректировать
          </Button>
        ) : undefined
      }
    >
      <Space size={24} wrap>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Остаток</Typography.Text>
          <div>
            <Typography.Text strong style={{ fontSize: 16, color: isNegative ? token.colorError : isBelowMin ? token.colorWarning : undefined }}>
              {formatStockCell(product.stock, product.rollStock)}
            </Typography.Text>
            {product.rollStock == null && <Typography.Text type="secondary"> {product.unit}</Typography.Text>}
          </div>
        </div>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Минимальный остаток</Typography.Text>
          <div>{minStock > 0 ? `${minStock} ${product.unit}` : '—'}</div>
        </div>
        {product.countryOfOrigin && (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Страна</Typography.Text>
            <div>{product.countryOfOrigin}</div>
          </div>
        )}
      </Space>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AuditStockPage() {
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const role = user?.role as UserRole | undefined;
  const canCorrect = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'WAREHOUSE' || role === 'WAREHOUSE_MANAGER';
  const queryClient = useQueryClient();

  const [params, setParams] = useSearchParams();
  const dateStr = params.get('date');
  const date: Dayjs = dateStr ? dayjs(dateStr) : dayjs();

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [correctProduct, setCorrectProduct] = useState<Product | null>(null);
  const [correctForm] = Form.useForm();
  const stickyTop = useStickyTopOffset();

  const ymd = date.format('YYYY-MM-DD');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`audit-stock-checked-${ymd}`);
      setCheckedIds(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch {
      setCheckedIds(new Set());
    }
    setSearch('');
  }, [ymd]);

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(`audit-stock-checked-${ymd}`, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['audit-stock-products'],
    queryFn: inventoryApi.listProducts,
  });

  const correctMut = useMutation({
    mutationFn: (data: { id: string; newStock: number; reason: string; newRollStock?: number }) =>
      inventoryApi.correctStock(data.id, { newStock: data.newStock, reason: data.reason, newRollStock: data.newRollStock }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-stock-products'] });
      message.success('Остаток скорректирован');
      setCorrectProduct(null);
      correctForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const activeProducts = useMemo(() => products.filter((p) => p.isActive), [products]);

  const filteredProducts = useMemo(() => {
    let list = activeProducts;
    if (stockFilter === 'zero') {
      list = list.filter((p) => Number(p.stock) <= 0);
    } else if (stockFilter === 'low') {
      list = list.filter((p) => Number(p.minStock) > 0 && Number(p.stock) < Number(p.minStock) && Number(p.stock) >= 0);
    } else if (stockFilter === 'problems') {
      list = list.filter((p) => Number(p.stock) < 0 || (Number(p.minStock) > 0 && Number(p.stock) < Number(p.minStock)));
    }
    return list.filter((p) => productMatchesSearch(p, search));
  }, [activeProducts, stockFilter, search]);

  const checkedCount = activeProducts.filter((p) => checkedIds.has(p.id)).length;
  const progressPercent = activeProducts.length > 0 ? Math.round((checkedCount / activeProducts.length) * 100) : 0;
  const allDone = activeProducts.length > 0 && checkedCount === activeProducts.length;

  const negativeCount = activeProducts.filter((p) => Number(p.stock) < 0).length;
  const belowMinCount = activeProducts.filter((p) => Number(p.minStock) > 0 && Number(p.stock) < Number(p.minStock) && Number(p.stock) >= 0).length;

  return (
    <div style={{ paddingBottom: 88 }}>
      <div style={{
        position: 'sticky',
        top: stickyTop,
        zIndex: 20,
        background: token.colorBgLayout,
        paddingBottom: 12,
        marginBottom: 10,
        borderBottom: `2px solid ${token.colorBorderSecondary}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <BackButton fallback="/inventory/products" />
          <Typography.Title level={4} style={{ margin: 0 }}>Аудит остатков товаров</Typography.Title>
        </div>

        <Space wrap align="center" size={8} style={{ marginBottom: 10 }}>
          <DatePicker
            value={date}
            onChange={(d) => {
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (d) next.set('date', d.format('YYYY-MM-DD'));
                else next.delete('date');
                return next;
              });
            }}
            format="DD.MM.YYYY"
            allowClear={false}
          />
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="Поиск по названию, артикулу, категории..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
          />
          <Segmented
            value={stockFilter}
            onChange={(v) => setStockFilter(v as StockFilter)}
            options={[
              { label: 'Все', value: 'all' },
              { label: `Проблемы (${negativeCount + belowMinCount})`, value: 'problems' },
              { label: `Нулевые (${activeProducts.filter((p) => Number(p.stock) <= 0).length})`, value: 'zero' },
              { label: `Ниже мин. (${belowMinCount})`, value: 'low' },
            ]}
          />
          {!isLoading && activeProducts.length > 0 && (
            <Space size={6} wrap>
              <Badge count={activeProducts.length} style={{ backgroundColor: token.colorPrimary }} />
              <Typography.Text type="secondary">товаров</Typography.Text>
            </Space>
          )}
        </Space>

        {!isLoading && activeProducts.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Typography.Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              Проверено:{' '}
              <strong style={{ color: allDone ? token.colorSuccess : token.colorPrimary, fontSize: 15 }}>
                {checkedCount}
              </strong>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}> / {activeProducts.length}</Typography.Text>
            </Typography.Text>
            <Progress
              percent={progressPercent}
              strokeColor={allDone ? token.colorSuccess : token.colorPrimary}
              showInfo
              size="small"
              style={{ flex: 1, margin: 0 }}
              format={(p) => <span style={{ fontSize: 12, color: allDone ? token.colorSuccess : undefined }}>{p}%</span>}
            />
            <Popconfirm
              title="Сбросить прогресс проверки?"
              description={`Отметки о проверке для ${date.format('DD.MM.YYYY')} будут удалены.`}
              okText="Сбросить"
              okButtonProps={{ danger: true }}
              cancelText="Отмена"
              onConfirm={() => {
                setCheckedIds(new Set());
                try { localStorage.removeItem(`audit-stock-checked-${ymd}`); } catch {}
              }}
            >
              <Button
                size="small"
                type="link"
                danger
                disabled={checkedCount === 0}
                style={{ padding: '8px 4px', height: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}
              >
                Сбросить
              </Button>
            </Popconfirm>
          </div>
        )}
      </div>

      {isLoading && <Spin style={{ display: 'block', margin: '60px auto' }} />}

      {!isLoading && activeProducts.length === 0 && (
        <Empty description="Нет активных товаров" style={{ marginTop: 60 }} />
      )}

      {!isLoading && activeProducts.length > 0 && filteredProducts.length === 0 && (
        <Empty description="Ничего не найдено по заданным фильтрам" style={{ marginTop: 60 }} />
      )}

      <Space direction="vertical" style={{ width: '100%' }} size={6}>
        {filteredProducts.map((product) => (
          <ProductAuditCard
            key={product.id}
            product={product}
            checked={checkedIds.has(product.id)}
            onToggle={toggleChecked}
            onCorrect={(p) => { setCorrectProduct(p); correctForm.setFieldsValue({ newStock: Number(p.stock), newRollStock: p.rollStock != null ? Number(p.rollStock) : undefined }); }}
            canCorrect={canCorrect}
          />
        ))}
      </Space>

      <Modal
        title={`Коррекция остатка: ${correctProduct?.name ?? ''}`}
        open={!!correctProduct}
        onCancel={() => { setCorrectProduct(null); correctForm.resetFields(); }}
        onOk={() => correctForm.submit()}
        confirmLoading={correctMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
      >
        {correctProduct && (
          <div style={{ marginBottom: 16, color: token.colorTextSecondary }}>
            Текущий остаток: <strong>{formatStockCell(correctProduct.stock, correctProduct.rollStock)}</strong>
            {correctProduct.rollStock == null ? ` ${correctProduct.unit}` : ''}
          </div>
        )}
        <Form form={correctForm} layout="vertical" onFinish={(v) => {
          if (!correctProduct) return;
          correctMut.mutate({ id: correctProduct.id, newStock: v.newStock, reason: v.reason, newRollStock: v.newRollStock });
        }}>
          <Form.Item name="newStock" label={`Новый остаток${correctProduct?.rollStock != null ? `, ${correctProduct.unit}` : ''}`} rules={[{ required: true, message: 'Обязательно' }]}>
            <InputNumber style={{ width: '100%' }} min={0} precision={3} />
          </Form.Item>
          {correctProduct?.rollStock != null && (
            <Form.Item name="newRollStock" label="Новый остаток, рулоны" rules={[{ required: true, message: 'Обязательно' }]}>
              <InputNumber style={{ width: '100%' }} min={0} precision={0} />
            </Form.Item>
          )}
          <Form.Item name="reason" label="Причина коррекции" rules={[{ required: true, message: 'Укажите причину' }]}>
            <Input.TextArea rows={2} placeholder="Инвентаризация, ошибка учёта, брак..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
