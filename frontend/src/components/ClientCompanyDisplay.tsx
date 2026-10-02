import { CrownFilled } from '@ant-design/icons';
import { Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { CLIENT_LOSS_REASON_META, type ClientLossReason } from '../constants/clientLossReasons';

/** Минимальные поля для бейджа статуса рядом с названием компании */
export type ClientCompanyBadge = {
  id?: string;
  companyName?: string | null;
  isSvip?: boolean;
  creditStatus?: 'NORMAL' | 'SATISFACTORY' | 'NEGATIVE';
  /** Причина ухода — плашка показывается, только если её передали (список и карточка клиента) */
  lossReason?: ClientLossReason | null;
  /** Для «Качество товара» — попадают в подсказку плашки */
  lossCategories?: string[];
  lossProductIds?: string[];
};

type Props = {
  client: ClientCompanyBadge | null | undefined;
  /** compact: только корона; full: корона + тег SVIP */
  variant?: 'compact' | 'full';
  /** Ссылка на карточку клиента (нужен client.id) */
  link?: boolean;
  /** Вторичный цвет текста (как подпись под сделкой) */
  secondary?: boolean;
  /** Скрыть бейдж статуса клиента (Неактивный/Нейтральный) — напр. для склада, кому это не нужно */
  showStatus?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

const STATUS_META = {
  NEGATIVE: {
    label: 'Неактивный',
    color: 'red',
    title: 'Неактивный: нельзя в долг',
  },
  SATISFACTORY: {
    label: 'Нейтральный',
    color: 'orange',
    title: 'Нейтральный: ограниченный долг',
  },
  NORMAL: null,
} as const;

export function ClientCompanyDisplay({
  client,
  variant = 'compact',
  link = false,
  secondary = false,
  showStatus = true,
  className,
  style,
}: Props) {
  const name = client?.companyName?.trim();
  if (!name) {
    return <span className={className}>—</span>;
  }

  const vip = !!client?.isSvip;
  const creditStatus = client?.creditStatus ?? 'NORMAL';
  const statusMeta = STATUS_META[creditStatus] ?? null;
  const lossMeta = client?.lossReason ? CLIENT_LOSS_REASON_META[client.lossReason] : null;
  const lossDetailParts = [
    ...(client?.lossCategories ?? []),
    ...(client?.lossProductIds?.length ? [`товаров: ${client.lossProductIds.length}`] : []),
  ];
  const lossTitle = lossMeta
    ? `Причина ухода: ${lossMeta.label}${lossDetailParts.length ? ` — ${lossDetailParts.join(', ')}` : ''}`
    : '';

  const nameEl = link && client?.id ? (
    <Typography.Text type={secondary ? 'secondary' : undefined} style={{ margin: 0 }}>
      <Link to={`/clients/${client.id}`} style={{ fontWeight: vip ? 600 : undefined }}>
        {name}
      </Link>
    </Typography.Text>
  ) : (
    <Typography.Text
      type={secondary ? 'secondary' : undefined}
      style={{ margin: 0, fontWeight: vip ? 600 : undefined }}
    >
      {name}
    </Typography.Text>
  );

  return (
    <Space size={4} align="center" wrap className={className} style={style}>
      {vip && (
        <CrownFilled
          style={{ color: '#faad14', fontSize: variant === 'full' ? 16 : 14 }}
          aria-hidden
        />
      )}
      {nameEl}
      {showStatus && statusMeta && (
        <Tag
          color={statusMeta.color}
          title={statusMeta.title}
          style={{ margin: 0, lineHeight: '18px', fontSize: 11, padding: '0 5px' }}
        >
          {statusMeta.label}
        </Tag>
      )}
      {lossMeta && (
        <Tag
          bordered={false}
          title={lossTitle}
          style={{ margin: 0, lineHeight: '18px', fontSize: 11, padding: '0 6px' }}
        >
          {lossMeta.emoji} {lossMeta.short}
        </Tag>
      )}
      {vip && variant === 'full' && (
        <Tag color="gold" style={{ margin: 0, lineHeight: '18px' }}>
          SVIP
        </Tag>
      )}
    </Space>
  );
}
