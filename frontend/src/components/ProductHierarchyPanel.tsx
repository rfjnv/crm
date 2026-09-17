import { useMemo, useState, useCallback, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { smartFilterOption } from '../utils/translit';
import {
  Collapse,
  Input,
  AutoComplete,
  Button,
  Dropdown,
  Modal,
  Select,
  Checkbox,
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
  TagsOutlined,
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
const UNTYPED_LABEL = 'Без типа';

function normCategory(c: string | null | undefined): string | null {
  const t = (c ?? '').trim();
  return t === '' ? null : t;
}

/** Тип читаем только из явного поля specifications.type — того же, что использует аналитика
 *  «Клиенты по иерархии» (см. inferTypeLabel в lib/analyticsHierarchySales.ts). Название по
 *  товару там используется лишь как запасной вариант для показа, не как ключ группировки —
 *  иначе сюда вернулась бы та же путаница, которую и просили исправить. */
function normType(p: Product): string | null {
  const specs = p.specifications;
  if (specs && typeof specs === 'object') {
    const t = (specs as Record<string, unknown>).type;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}

function mergeSpecifications(p: Product, patch: { type?: string | null }): Record<string, unknown> | null {
  const base = (p.specifications && typeof p.specifications === 'object')
    ? { ...(p.specifications as Record<string, unknown>) }
    : {};
  if (patch.type === null) delete base.type;
  else if (patch.type !== undefined) base.type = patch.type;
  return Object.keys(base).length > 0 ? base : null;
}

/** «Тип» может кодировать вложенность через `/`, например «Лист / Кизил / Без насечки» —
 *  тогда это три уровня, а не один длинный ярлык. */
function typeSegments(raw: string): string[] {
  return raw.split('/').map((s) => s.trim()).filter(Boolean);
}

function typePathMatches(raw: string | null, path: string[]): boolean {
  if (!raw) return false;
  const segs = typeSegments(raw);
  if (segs.length < path.length) return false;
  return path.every((seg, i) => segs[i] === seg);
}

type TypeTreeNode = {
  path: string[];
  label: string;
  /** Товары, у которых тип заканчивается ровно на этом узле (нет более глубокого уровня). */
  ownProducts: Product[];
  children: TypeTreeNode[];
};

type TypeTreeBuildNode = { label: string; path: string[]; ownProducts: Product[]; childMap: Map<string, TypeTreeBuildNode> };

/** Строит дерево типов произвольной глубины из плоского списка товаров одной категории. */
function buildTypeTree(list: Product[]): TypeTreeNode[] {
  const rootMap = new Map<string, TypeTreeBuildNode>();
  for (const p of list) {
    const raw = normType(p);
    if (!raw) continue;
    const segs = typeSegments(raw);
    if (segs.length === 0) continue;

    let map = rootMap;
    const path: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      path.push(segs[i]);
      let node = map.get(segs[i]);
      if (!node) {
        node = { label: segs[i], path: [...path], ownProducts: [], childMap: new Map() };
        map.set(segs[i], node);
      }
      if (i === segs.length - 1) node.ownProducts.push(p);
      map = node.childMap;
    }
  }

  const finalize = (nodes: TypeTreeBuildNode[]): TypeTreeNode[] =>
    nodes
      .map((n) => ({
        path: n.path,
        label: n.label,
        ownProducts: [...n.ownProducts].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        children: finalize([...n.childMap.values()]),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

  return finalize([...rootMap.values()]);
}

function countTypeNode(node: TypeTreeNode): number {
  return node.ownProducts.length + node.children.reduce((sum, c) => sum + countTypeNode(c), 0);
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
  /** Опционально — страница-редактор группировок сама не создаёт новые товары. */
  onAddProductInCategory?: (category: string) => void;
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
  const [renameFrom, setRenameFrom] = useState<
    | { level: 'category'; value: string }
    | { level: 'type'; category: string | null; path: string[] }
    | null
  >(null);
  const [renameTo, setRenameTo] = useState('');
  const [activeDrag, setActiveDrag] = useState<Product | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [applyCategory, setApplyCategory] = useState(false);
  const [applyType, setApplyType] = useState(false);
  const [bulkCategoryText, setBulkCategoryText] = useState('');
  const [bulkTypeText, setBulkTypeText] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const toggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

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

  const allCategoryNames = useMemo(
    () => namedGroups.map(([n]) => n).sort((a, b) => a.localeCompare(b, 'ru')),
    [namedGroups],
  );
  const allTypeNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of products) {
      const t = normType(p);
      if (t) names.add(t);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [products]);

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

  /** Переименование узла дерева типов — только внутри одной категории (`category`) и только
   *  этого уровня вложенности: у всех товаров, чей тип начинается с `path`, заменяется именно
   *  сегмент на глубине `path.length - 1`, остальные уровни (родительские и дочерние) сохраняются. */
  const renameTypeMut = useMutation({
    mutationFn: async ({ category, path, to }: { category: string | null; path: string[]; to: string }) => {
      const trimmed = to.trim();
      if (!trimmed) throw new Error('empty');
      const affected = products.filter((p) => normCategory(p.category) === category && typePathMatches(normType(p), path));
      await Promise.all(
        affected.map((p) => {
          const segs = typeSegments(normType(p)!);
          segs[path.length - 1] = trimmed;
          return inventoryApi.updateProduct(p.id, { specifications: mergeSpecifications(p, { type: segs.join(' / ') }) });
        }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Тип переименован');
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

  const clearTypeMut = useMutation({
    mutationFn: async ({ category, path }: { category: string | null; path: string[] }) => {
      const affected = products.filter((p) => normCategory(p.category) === category && typePathMatches(normType(p), path));
      await Promise.all(
        affected.map((p) => inventoryApi.updateProduct(p.id, { specifications: mergeSpecifications(p, { type: null }) })),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Тип снят с товаров');
    },
    onError: () => message.error('Не удалось обновить товары'),
  });

  const bulkAssignMut = useMutation({
    mutationFn: async ({ ids, category, type }: { ids: string[]; category?: string | null; type?: string | null }) => {
      const targets = products.filter((p) => ids.includes(p.id));
      await Promise.all(
        targets.map((p) => {
          const data: Parameters<typeof inventoryApi.updateProduct>[1] = {};
          if (category !== undefined) data.category = category;
          if (type !== undefined) data.specifications = mergeSpecifications(p, { type });
          return inventoryApi.updateProduct(p.id, data);
        }),
      );
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success(`Обновлено товаров: ${vars.ids.length}`);
      setBulkMoveOpen(false);
      setSelectedIds(new Set());
      setApplyCategory(false);
      setApplyType(false);
      setBulkCategoryText('');
      setBulkTypeText('');
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

  const openBulkMove = () => {
    setApplyCategory(false);
    setApplyType(false);
    setBulkCategoryText('');
    setBulkTypeText('');
    setBulkMoveOpen(true);
  };

  const confirmBulkMove = () => {
    if (!applyCategory && !applyType) {
      message.warning('Выберите, что менять — категорию и/или тип');
      return;
    }
    bulkAssignMut.mutate({
      ids: [...selectedIds],
      category: applyCategory ? (bulkCategoryText.trim() || null) : undefined,
      type: applyType ? (bulkTypeText.trim() || null) : undefined,
    });
  };

  const categoryMenuItems = (categoryName: string): MenuProps['items'] => {
    if (!canManage) return [];
    return [
      ...(onAddProductInCategory ? [{
        key: 'add',
        icon: <PlusOutlined />,
        label: 'Добавить товар',
        onClick: () => onAddProductInCategory(categoryName),
      }] : []),
      {
        key: 'rename',
        label: 'Переименовать категорию',
        onClick: () => {
          setRenameFrom({ level: 'category', value: categoryName });
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

  const typeMenuItems = (category: string | null, node: TypeTreeNode): MenuProps['items'] => {
    if (!canManage) return [];
    return [
      {
        key: 'rename',
        label: 'Переименовать',
        onClick: () => {
          setRenameFrom({ level: 'type', category, path: node.path });
          setRenameTo(node.label);
        },
      },
      {
        key: 'clear',
        danger: true,
        label: node.children.length > 0 ? 'Снять тип (со всей веткой)' : 'Снять тип',
        onClick: () => {
          Modal.confirm({
            title: 'Снять тип?',
            content: `Товары в «${node.path.join(' / ')}» станут без типа.`,
            okText: 'Снять',
            cancelText: 'Отмена',
            onOk: () => clearTypeMut.mutateAsync({ category, path: node.path }),
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
          {canManage && (
            <Checkbox
              checked={selectedIds.has(p.id)}
              onChange={(e) => toggleSelected(p.id, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
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

  const renderTypeNode = (category: string | null, node: TypeTreeNode, depth: number) => (
    <div key={node.path.join('/')} style={{ marginBottom: 10, marginLeft: depth * 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0 4px 4px' }}>
        <TagsOutlined style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
        <Typography.Text strong style={{ flex: 1 }}>
          {node.label}
        </Typography.Text>
        <Tag style={{ margin: 0 }}>{countTypeNode(node)}</Tag>
        {canManage && (
          <Dropdown menu={{ items: typeMenuItems(category, node) }} trigger={['click']}>
            <Button type="text" size="small" icon={<MoreOutlined />} />
          </Dropdown>
        )}
      </div>
      {node.children.map((child) => renderTypeNode(category, child, depth + 1))}
      {node.ownProducts.length > 0 && <div>{node.ownProducts.map((p) => renderProductRow(p))}</div>}
    </div>
  );

  const renderCategoryBody = (category: string | null, prods: Product[]) => {
    const tree = buildTypeTree(prods);
    const untyped = prods.filter((p) => normType(p) == null);
    if (tree.length === 0) {
      // Ни у кого не задан тип — не загромождаем интерфейс пустой группировкой.
      return <div style={{ paddingTop: 4 }}>{prods.map((p) => renderProductRow(p))}</div>;
    }
    return (
      <div style={{ paddingTop: 4 }}>
        {tree.map((node) => renderTypeNode(category, node, 0))}
        {untyped.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0 4px 4px' }}>
              <TagsOutlined style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
              <Typography.Text type="secondary" style={{ flex: 1 }}>
                {UNTYPED_LABEL}
              </Typography.Text>
              <Tag style={{ margin: 0 }}>{untyped.length}</Tag>
            </div>
            <div>{untyped.map((p) => renderProductRow(p))}</div>
          </div>
        )}
      </div>
    );
  };

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
    children: renderCategoryBody(name, prods),
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
    <div style={{ paddingBottom: selectedIds.size > 0 ? 64 : 0 }}>
      {searchHint ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {searchHint}
        </Typography.Text>
      ) : null}

      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
        Категории можно разворачивать. Перетащите товар на строку категории (или на «{UNCATEGORIZED_LABEL}» внизу), чтобы
        переместить. Внутри категории товары дополнительно сгруппированы по типу — тип можно вложить на несколько
        уровней через «/» (например «Лист / Кизил / Без насечки» — три уровня), задать и переименовать через меню
        группы или выбрать несколько товаров чекбоксами и перенести разом.
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
            {renderCategoryBody(null, uncategorized)}
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

      {canManage && selectedIds.size > 0 && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 20,
            display: 'flex',
            justifyContent: 'center',
            padding: 12,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 16px',
              borderRadius: 10,
              background: token.colorBgElevated,
              border: `1px solid ${token.colorBorder}`,
              boxShadow: token.boxShadowSecondary,
            }}
          >
            <Typography.Text>Выбрано: {selectedIds.size}</Typography.Text>
            <Button type="primary" size="small" onClick={openBulkMove}>
              Перенести в группу
            </Button>
            <Button size="small" onClick={() => setSelectedIds(new Set())}>
              Снять выбор
            </Button>
          </div>
        </div>
      )}

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
        title={renameFrom?.level === 'type' ? 'Переименовать тип' : 'Переименовать категорию'}
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
          if (renameFrom.level === 'category') {
            if (t === renameFrom.value) { setRenameFrom(null); return; }
            renameCategoryMut.mutate({ from: renameFrom.value, to: t });
          } else {
            if (t === renameFrom.path[renameFrom.path.length - 1]) { setRenameFrom(null); return; }
            renameTypeMut.mutate({ category: renameFrom.category, path: renameFrom.path, to: t });
          }
        }}
        confirmLoading={renameCategoryMut.isPending || renameTypeMut.isPending}
        okText="Сохранить"
      >
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Было: {renameFrom?.level === 'type' ? renameFrom.path.join(' / ') : renameFrom?.value}
        </Typography.Text>
        <Input
          value={renameTo}
          onChange={(e) => setRenameTo(e.target.value)}
          placeholder={renameFrom?.level === 'type' ? 'Новое название этого уровня' : 'Новое название категории'}
        />
      </Modal>

      <Modal
        title={`Перенести товары (${selectedIds.size})`}
        open={bulkMoveOpen}
        onCancel={() => setBulkMoveOpen(false)}
        onOk={confirmBulkMove}
        okText="Применить"
        confirmLoading={bulkAssignMut.isPending}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          Отметьте, что нужно изменить у выбранных товаров. Можно ввести существующее название или новое — новая
          группа появится сразу после сохранения.
        </Typography.Paragraph>

        <div style={{ marginBottom: 16 }}>
          <Checkbox checked={applyCategory} onChange={(e) => setApplyCategory(e.target.checked)}>
            Изменить категорию
          </Checkbox>
          {applyCategory && (
            <AutoComplete
              style={{ width: '100%', marginTop: 8 }}
              value={bulkCategoryText}
              onChange={setBulkCategoryText}
              options={allCategoryNames.map((n) => ({ value: n }))}
              filterOption={(input, option) => (option?.value as string ?? '').toLowerCase().includes(input.toLowerCase())}
              placeholder="Название категории (пусто — без категории)"
            />
          )}
        </div>

        <div>
          <Checkbox checked={applyType} onChange={(e) => setApplyType(e.target.checked)}>
            Изменить тип
          </Checkbox>
          {applyType && (
            <AutoComplete
              style={{ width: '100%', marginTop: 8 }}
              value={bulkTypeText}
              onChange={setBulkTypeText}
              options={allTypeNames.map((n) => ({ value: n }))}
              filterOption={(input, option) => (option?.value as string ?? '').toLowerCase().includes(input.toLowerCase())}
              placeholder="Например: Лист / Кизил / Без насечки (пусто — без типа)"
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
