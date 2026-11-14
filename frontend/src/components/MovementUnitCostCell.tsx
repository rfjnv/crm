import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, InputNumber, Popover, Space, message } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { inventoryApi } from '../api/warehouse.api';
import { formatUZS } from '../utils/currency';
import type { InventoryMovement } from '../types';

/**
 * Цена закупки прихода в истории движений: показывает и даёт поправить по документу
 * поставщика. Рисуется только с открытой себестоимостью — без неё сервер цену не отдаёт.
 */
export default function MovementUnitCostCell({ movement }: { movement: InventoryMovement }) {
  const queryClient = useQueryClient();
  const current = movement.unitCost != null ? Number(movement.unitCost) : null;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<number | null>(current);

  const save = useMutation({
    mutationFn: (unitCost: number | null) => inventoryApi.setMovementUnitCost(movement.id, unitCost),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-movements'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Цена закупки сохранена');
      setOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  if (movement.type !== 'IN') return <>—</>;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => { setOpen(v); if (v) setValue(current); }}
      trigger="click"
      title="Цена закупки за единицу, сум"
      content={(
        <Space>
          <InputNumber autoFocus min={0.01} step={100} value={value} onChange={(v) => setValue(v)} style={{ width: 150 }} />
          <Button type="primary" loading={save.isPending} onClick={() => save.mutate(value ?? null)}>Сохранить</Button>
        </Space>
      )}
    >
      <Button type="link" size="small" style={{ padding: 0 }}>
        {current != null ? formatUZS(current) : <span style={{ opacity: 0.6 }}>указать</span>} <EditOutlined />
      </Button>
    </Popover>
  );
}
