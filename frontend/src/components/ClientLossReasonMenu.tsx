import { Button, Dropdown } from 'antd';
import { CLIENT_LOSS_REASONS, CLIENT_LOSS_REASON_META, type ClientLossReason } from '../constants/clientLossReasons';

type Props = {
  value: ClientLossReason | null | undefined;
  onChange: (value: ClientLossReason | null) => void;
  loading?: boolean;
  /** icon — маленькая кнопка для строки списка; button — обычная кнопка с подписью для карточки */
  variant?: 'icon' | 'button';
};

/** Выбор причины ухода клиента. Пустое значение — клиент не потерян, плашки нет. */
export default function ClientLossReasonMenu({ value, onChange, loading, variant = 'icon' }: Props) {
  const meta = value ? CLIENT_LOSS_REASON_META[value] : null;

  const items = [
    ...CLIENT_LOSS_REASONS.map((r) => ({ key: r.value, label: `${r.emoji}  ${r.label}` })),
    ...(value ? [{ type: 'divider' as const }, { key: 'clear', label: 'Снять — клиент вернулся', danger: true }] : []),
  ];

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items,
        selectable: true,
        selectedKeys: value ? [value] : [],
        onClick: ({ key }) => onChange(key === 'clear' ? null : (key as ClientLossReason)),
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
  );
}
