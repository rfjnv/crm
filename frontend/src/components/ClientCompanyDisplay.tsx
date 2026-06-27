import { CrownFilled } from '@ant-design/icons';
import { Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';

/** Минимальные поля для бейджа статуса рядом с названием компании */
export type ClientCompanyBadge = {
  id?: string;
  companyName?: string | null;
  isSvip?: boolean;
  creditStatus?: 'NORMAL' | 'SATISFACTORY' | 'NEGATIVE';
};

type Props = {
  client: ClientCompanyBadge | null | undefined;
  /** compact: только корона; full: корона + тег SVIP */
  variant?: 'compact' | 'full';
  /** Ссылка на карточку клиента (нужен client.id) */
  link?: boolean;
  /** Вторичный цвет текста (как подпись под сделкой) */
  secondary?: boolean;
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
      {statusMeta && (
        <Tag
          color={statusMeta.color}
          title={statusMeta.title}
          style={{ margin: 0, lineHeight: '18px', fontSize: 11, padding: '0 5px' }}
        >
          {statusMeta.label}
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
