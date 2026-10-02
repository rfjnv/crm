import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Dropdown, Modal, TreeSelect, Typography } from 'antd';
import { inventoryApi } from '../api/warehouse.api';
import {
  CLIENT_LOSS_REASONS,
  CLIENT_LOSS_REASON_META,
  type ClientLossDetails,
  type ClientLossReason,
} from '../constants/clientLossReasons';

type Props = {
  value: ClientLossReason | null | undefined;
  /** Текущие категории и товары для «Качество товара» — подставляются при повторном выборе */
  details?: Partial<ClientLossDetails>;
  onChange: (value: ClientLossReason | null, details?: ClientLossDetails) => void;
  loading?: boolean;
  /** icon — маленькая кнопка для строки списка; button — обычная кнопка с подписью для карточки */
  variant?: 'icon' | 'button';
};

const CAT_PREFIX = 'cat:';

/** Выбор причины ухода клиента. Пустое значение — клиент не потерян, плашки нет. */
export default function ClientLossReasonMenu({ value, details, onChange, loading, variant = 'icon' }: Props) {
  const meta = value ? CLIENT_LOSS_REASON_META[value] : null;
  const [qualityOpen, setQualityOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
    enabled: qualityOpen,
  });

  // Категории — узлы, товары — листья; товары без категории идут отдельными листьями в конце.
  const treeData = useMemo(() => {
    const byCategory = new Map<string, { title: string; value: string }[]>();
    const loose: { title: string; value: string }[] = [];
    for (const p of products ?? []) {
      if (p.isActive === false) continue;
      const leaf = { title: p.name, value: p.id };
      const cat = p.category?.trim();
      if (!cat) loose.push(leaf);
      else byCategory.set(cat, [...(byCategory.get(cat) ?? []), leaf]);
    }
    const byName = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, 'ru');
    return [
      ...[...byCategory.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'ru'))
        .map(([cat, children]) => ({
          title: `${cat} (${children.length})`,
          value: CAT_PREFIX + cat,
          children: children.sort(byName),
        })),
      ...loose.sort(byName),
    ];
  }, [products]);

  const openQuality = () => {
    setPicked([
      ...(details?.lossCategories ?? []).map((c) => CAT_PREFIX + c),
      ...(details?.lossProductIds ?? []),
    ]);
    setQualityOpen(true);
  };

  const submitQuality = () => {
    onChange('QUALITY', {
      lossCategories: picked.filter((v) => v.startsWith(CAT_PREFIX)).map((v) => v.slice(CAT_PREFIX.length)),
      lossProductIds: picked.filter((v) => !v.startsWith(CAT_PREFIX)),
    });
    setQualityOpen(false);
  };

  const items = [
    ...CLIENT_LOSS_REASONS.map((r) => ({ key: r.value, label: `${r.emoji}  ${r.label}` })),
    ...(value ? [{ type: 'divider' as const }, { key: 'clear', label: 'Снять — клиент вернулся', danger: true }] : []),
  ];

  return (
    <>
      <Dropdown
        trigger={['click']}
        menu={{
          items,
          selectable: true,
          selectedKeys: value ? [value] : [],
          onClick: ({ key }) => {
            if (key === 'QUALITY') openQuality();
            else onChange(key === 'clear' ? null : (key as ClientLossReason));
          },
        }}
      >
        {variant === 'icon' ? (
          <Button
            type="text"
            size="small"
            loading={loading}
            title={meta ? `Причина ухода: ${meta.label}` : 'Указать причину ухода'}
            style={{ opacity: meta ? 1 : 0.45, fontSize: 14 }}
          >
            {meta ? meta.emoji : '🏷️'}
          </Button>
        ) : (
          <Button loading={loading}>
            {meta ? `${meta.emoji} ${meta.short}` : 'Причина ухода'}
          </Button>
        )}
      </Dropdown>

      <Modal
        title="👎 Не устраивает качество товара"
        open={qualityOpen}
        onCancel={() => setQualityOpen(false)}
        onOk={submitQuality}
        okText="Сохранить"
        cancelText="Отмена"
        okButtonProps={{ disabled: picked.length === 0 }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          Отметьте, чем недоволен клиент: целую категорию или отдельные товары.
        </Typography.Paragraph>
        <TreeSelect
          style={{ width: '100%' }}
          treeData={treeData}
          value={picked}
          onChange={(v) => setPicked(v as string[])}
          treeCheckable
          showCheckedStrategy={TreeSelect.SHOW_PARENT}
          showSearch
          treeNodeFilterProp="title"
          placeholder="Категории или товары"
          loading={productsLoading}
          maxTagCount="responsive"
          allowClear
          listHeight={360}
        />
      </Modal>
    </>
  );
}
