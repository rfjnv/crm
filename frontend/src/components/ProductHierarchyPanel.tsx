import { useMemo, useState, useCallback, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { smartFilterOption } from '../utils/translit';
import {
  Collapse,
  Input,
  Button,
  Dropdown,
  Modal,
  Select,
  Typography,
  Tag,
  message,
  Empty,
  Spin,
  theme,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  FolderOutlined,
  ShoppingOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { inventoryApi } from '../api/warehouse.api';
import type { Product } from '../types';

const UNCATEGORIZED_LABEL = 'Без категории';

function normCategory(c: string | null | undefined): string | null {
  const t = (c ?? '').trim();
  return t === '' ? null : t;
}

function dropIdForCategory(name: string | null): string {
  return name == null ? 'drop:uncat' : `drop:cat:${encodeURIComponent(name)}`;
}

function parseDropId(id: string): string | null | undefined {
  if (id === 'drop:uncat') return null;
  if (id.startsWith('drop:cat:')) return decodeURIComponent(id.slice('drop:cat:'.length));
  return undefined;
}

type DroppableHeaderProps = {
  dropId: string;
  title: ReactNode;
  extra?: ReactNode;
  muted?: boolean;
};

function DroppableHeader({ dropId, title, extra, muted }: DroppableHeaderProps) {
  const { token } = theme.useToken();
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        margin: '-4px 0',
        padding: '4px 0',
        borderRadius: 6,
        transition: 'background 0.15s',
        background: isOver ? (muted ? `${token.colorFillTertiary}` : `${token.colorPrimaryBg}`) : undefined,
        outline: isOver ? `1px dashed ${token.colorPrimary}` : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>{title}</div>
      {extra}
    </div>
  );
}

type DraggableProductRowProps = {
  product: Product;
  canManage: boolean;
  children: (dragHandle: ReactNode) => ReactNode;
};

function DraggableProductRow({ product, canManage, children }: DraggableProductRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: product.id,
    disabled: !canManage,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.45 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : 0,
  };
  const handle = canManage ? (
    <span
      {...listeners}
      {...attributes}
      style={{ cursor: 'grab', touchAction: 'none', display: 'inline-flex', padding: '0 4px' }}
      aria-label="Перетащить"
    >
      <HolderOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />
    </span>
  ) : null;
  return (
    <div ref={setNodeRef} style={style}>
      {children(handle)}
    </div>
  );
}

export type ProductHierarchyPanelProps = {
  products: Product[];
  loading?: boolean;
  canManage: boolean;
  searchHint?: string;
  onEditProduct: (p: Product) => void;
  onAddProductInCategory: (category: string) => void;
};

export default function ProductHierarchyPanel({
  products,
  loading,
  canManage,
  searchHint,
  onEditProduct,
  onAddProductInCategory,
}: ProductHierarchyPanelProps) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [moveProduct, setMoveProduct] = useState<Product | null>(null);
  const [moveTargetCategory, setMoveTargetCategory] = useState<string | null>(null);
  const [renameFrom, setRenameFrom] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [activeDrag, setActiveDrag] = useState<Product | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const { namedGroups, uncategorized } = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const key = normCategory(p.category) ?? UNCATEGORIZED_LABEL;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    const unc = map.get(UNCATEGORIZED_LABEL) ?? [];
    map.delete(UNCATEGORIZED_LABEL);
    const named = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
    for (const [, list] of named) {
      list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }
    unc.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { namedGroups: named, uncategorized: unc };
  }, [products]);

  const categoryOptions = useMemo(() => {
    const names = new Set(namedGroups.map(([n]) => n));
    const cur = moveProduct ? normCategory(moveProduct.category) : null;
    if (cur) names.add(cur);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'ru'));
    return [
      { label: UNCATEGORIZED_LABEL, value: '__none__' },
      ...sorted.map((n) => ({ label: n, value: n })),
    ];
  }, [namedGroups, moveProduct]);

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof inventoryApi.updateProduct>[1] }) =>
      inventoryApi.updateProduct(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err: unknown) => {
      const resp = (err as { response?: { data?: { error?: string; details?: string[] } } })?.response?.data;
      message.error(resp?.details?.join(', ') || resp?.error || 'Ошибка');
    },
  });

  const renameCategoryMut = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      const trimmed = to.trim();
      if (!trimmed) throw new Error('empty');
      const affected = products.filter((p) => normCategory(p.category) === from);
      await Promise.all(affected.map((p) => inventoryApi.updateProduct(p.id, { category: trimmed })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Категория переименована');
      setRenameFrom(null);
      setRenameTo('');
    },
    onError: () => message.error('Не удалось переименовать'),
  });

  const clearCategoryMut = useMutation({
    mutationFn: async (categoryName: string) => {
      const affected = products.filter((p) => normCategory(p.category) === categoryName);
      await Promise.all(affected.map((p) => inventoryApi.updateProduct(p.id, { category: null })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Категория снята с товаров');
    },
    onError: () => message.error('Не удалось обновить товары'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Товар удалён');
    },
    onError: (err: unknown) => {
      const resp = (err as { response?: { data?: { error?: string; details?: string[] } } })?.response?.data;
      message.error(resp?.details?.join(', ') || resp?.error || 'Ошибка');
    },
  });

  const clearDragCursor = useCallback(() => {
    setActiveDrag(null);
    if (typeof document !== 'undefined') {
      document.body.style.removeProperty('cursor');
      document.documentElement.style.removeProperty('cursor');
    }
  }, []);

  const onDragStart = useCallback((e: DragStartEvent) => {
    const id = String(e.active.id);
    const p = products.find((x) => x.id === id);
    setActiveDrag(p ?? null);
  }, [products]);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      clearDragCursor();
      const { active, over } = e;
      if (!over || !canManage) return;
      const target = parseDropId(String(over.id));
      if (target === undefined) return;
      const pid = String(active.id);
      const product = products.find((x) => x.id === pid);
      if (!product) return;
      const current = normCategory(product.category);
      const next = target;
      if (current === next) return;
      updateMut.mutate(
        { id: product.id, data: { category: next === null ? null : next } },
        { onSuccess: () => message.success('Товар перенесён') },
      );
    },
    [canManage, products, updateMut, clearDragCursor],
  );

  const onDragCancel = useCallback(() => {
    clearDragCursor();
  }, [clearDragCursor]);

  const openMove = (p: Product) => {
    const c = normCategory(p.category);
    setMoveProduct(p);
    setMoveTargetCategory(c);
  };

  const confirmMove = () => {
    if (!moveProduct) return;
    const next =
      moveTargetCategory === null || moveTargetCategory === UNCATEGORIZED_LABEL
        ? null
        : moveTargetCategory.trim() || null;
    updateMut.mutate(
      { id: moveProduct.id, data: { category: next } },
      {
        onSuccess: () => {
          message.success('Товар перемещён');
          setMoveProduct(null);
        },
      },
    );
  };

  const categoryMenuItems = (categoryName: string): MenuProps['items'] => {
    if (!canManage) return [];
    return [
      {
        key: 'add',
        icon: <PlusOutlined />,
        label: 'Добавить товар',
        onClick: () => onAddProductInCategory(categoryName),
      },
      {
        key: 'rename',
        label: 'Переименовать категорию',
        onClick: () => {
          setRenameFrom(categoryName);
          setRenameTo(categoryName);
        },
      },
      {
        key: 'clear',
        danger: true,
        label: 'Снять категорию',
        onClick: () => {
          Modal.confirm({
            title: 'Снять категорию?',
            content: `Все товары в «${categoryName}» станут без категории.`,
            okText: 'Снять',
            cancelText: 'Отмена',
            onOk: () => clearCategoryMut.mutateAsync(categoryName),
          });
        },
      },
    ];
  };

  const productMenuItems = (p: Product): MenuProps['items'] => {
    if (!canManage) return [];
    return [
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: 'Редактировать',
        onClick: () => onEditProduct(p),
      },
      {
        key: 'move',
        label: 'В другую категорию',
        onClick: () => openMove(p),
      },
      {
        key: 'del',
        danger: true,
        icon: <DeleteOutlined />,
        label: 'Удалить',
        onClick: () => {
          Modal.confirm({
            title: 'Удалить товар?',
            content: `«${p.name}»`,
            okText: 'Удалить',
            okButtonProps: { danger: true },
            cancelText: 'Отмена',
            onOk: () => deleteMut.mutateAsync(p.id),
          });
        },
      },
    ];
  };

  const renderProductRow = (p: Product) => (
    <DraggableProductRow key={p.id} product={p} canManage={canManage}>
      {(handle) => (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px 6px 20px',
            marginBottom: 4,
            borderRadius: 8,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorFillAlter,
          }}
        >
          {handle}
          <Typography.Text type="secondary" style={{ fontFamily: 'monospace', flexShrink: 0 }}>
            └
          </Typography.Text>
          <ShoppingOutlined style={{ color: token.colorSuccess, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: 'auto', fontWeight: 500 }}
              onClick={() => navigate(`/inventory/products/${p.id}`)}
            >
              {p.name}
            </Button>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {p.sku}
                {p.format ? ` · ${p.format}` : ''}
              </Typography.Text>
            </div>
          </div>
          <Tag color={p.isActive ? 'green' : 'default'} style={{ margin: 0 }}>
            {p.isActive ? 'Активен' : 'Выкл'}
          </Tag>
          {canManage && (
            <Dropdown menu={{ items: productMenuItems(p) }} trigger={['click']}>
              <Button type="text" size="small" icon={<MoreOutlined />} onClick={(e) => e.stopPropagation()} />
            </Dropdown>
          )}
        </div>
      )}
    </DraggableProductRow>
  );

  const collapseItems = namedGroups.map(([name, prods]) => ({
    key: name,
    label: (
      <DroppableHeader
        dropId={dropIdForCategory(name)}
        title={
          <>
            <FolderOutlined style={{ color: token.colorPrimary, flexShrink: 0 }} />
            <Typography.Text strong ellipsis style={{ flex: 1 }}>
              {name}
            </Typography.Text>
            <Tag style={{ margin: 0 }}>{prods.length}</Tag>
          </>
        }
        extra={
          canManage ? (
            <Dropdown menu={{ items: categoryMenuItems(name) }} trigger={['click']}>
              <Button type="text" size="small" icon={<MoreOutlined />} onClick={(e) => e.preventDefault()} />
            </Dropdown>
          ) : null
        }
      />
    ),
    styles: {
      header: { alignItems: 'center' },
    },
    children: <div style={{ paddingTop: 4 }}>{prods.map((p) => renderProductRow(p))}</div>,
  }));

  if (loading) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />;
  }

  if (products.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={searchHint || 'Нет товаров по фильтрам'}
      />
    );
  }

  return (
    <div>
      {searchHint ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {searchHint}
        </Typography.Text>
      ) : null}

      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
        Категории можно разворачивать. Перетащите товар на строку категории (или на «{UNCATEGORIZED_LABEL}» внизу), чтобы
        переместить.
      </Typography.Paragraph>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
        {namedGroups.length === 0 ? null : (
          <Collapse
            bordered={false}
            defaultActiveKey={[]}
            expandIconPosition="end"
            style={{ background: 'transparent' }}
            items={collapseItems}
          />
        )}

        {uncategorized.length > 0 && (
          <div
            style={{
              marginTop: namedGroups.length ? 16 : 0,
              padding: 12,
              borderRadius: 8,
              border: `1px dashed ${token.colorBorder}`,
              background: token.colorFillQuaternary,
              opacity: 0.92,
            }}
          >
            <DroppableHeader
              dropId={dropIdForCategory(null)}
              muted
              title={
                <Typography.Text type="secondary" strong>
                  <FolderOutlined style={{ marginRight: 8 }} />
                  {UNCATEGORIZED_LABEL}
                  <Tag style={{ marginLeft: 8 }}>{uncategorized.length}</Tag>
                </Typography.Text>
              }
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              Товары без категории
            </Typography.Text>
            {uncategorized.map((p) => renderProductRow(p))}
          </div>
        )}

        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                boxShadow: token.boxShadowSecondary,
                background: token.colorBgElevated,
                border: `1px solid ${token.colorBorder}`,
                maxWidth: 280,
              }}
            >
              <ShoppingOutlined style={{ marginRight: 8 }} />
              {activeDrag.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Modal
        title="Переместить в категорию"
        open={!!moveProduct}
        onCancel={() => setMoveProduct(null)}
        onOk={confirmMove}
        okText="Переместить"
        confirmLoading={updateMut.isPending}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          {moveProduct?.name}
        </Typography.Paragraph>
        <Select
          style={{ width: '100%' }}
          value={
            moveTargetCategory == null
              ? '__none__'
              : moveTargetCategory
          }
          onChange={(v) => setMoveTargetCategory(v === '__none__' ? null : v)}
          options={categoryOptions}
          showSearch
          filterOption={smartFilterOption}
        />
      </Modal>

      <Modal
        title="Переименовать категорию"
        open={!!renameFrom}
        onCancel={() => {
          setRenameFrom(null);
          setRenameTo('');
        }}
        onOk={() => {
          if (!renameFrom) return;
          const t = renameTo.trim();
          if (!t) {
            message.warning('Введите название');
            return;
          }
          if (t === renameFrom) {
            setRenameFrom(null);
            return;
          }
          renameCategoryMut.mutate({ from: renameFrom, to: t });
        }}
        confirmLoading={renameCategoryMut.isPending}
        okText="Сохранить"
      >
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Было: {renameFrom}
        </Typography.Text>
        <Input
          value={renameTo}
          onChange={(e) => setRenameTo(e.target.value)}
          placeholder="Новое название категории"
        />
      </Modal>
    </div>
  );
}
