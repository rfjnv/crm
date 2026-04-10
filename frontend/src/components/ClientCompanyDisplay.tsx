import { CrownFilled } from '@ant-design/icons';
import { Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';

/** Минимальные поля для бейджа SVIP рядом с названием компании */
export type ClientCompanyBadge = {
  id?: string;
  companyName?: string | null;
  isSvip?: boolean;
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

  const nameEl =
    link && client?.id ? (
      <Typography.Text type={secondary ? 'secondary' : undefined} style={{ margin: 0 }}>
        <Link to={`/clients/${client.id}`} style={{ fontWeight: vip ? 600 : undefined }}>
          {name}
        </Link>
      </Typography.Text>
    ) : (
      <Typography.Text type={secondary ? 'secondary' : undefined} style={{ margin: 0, fontWeight: vip ? 600 : undefined }}>
        {name}
      </Typography.Text>
    );

  return (
    <Space size={6} align="center" wrap className={className} style={style}>
      {vip && (
        <CrownFilled style={{ color: '#faad14', fontSize: variant === 'full' ? 16 : 14 }} aria-hidden />
      )}
      {nameEl}
      {vip && variant === 'full' && (
        <Tag color="gold" style={{ margin: 0, lineHeight: 1.35 }}>
          SVIP
        </Tag>
      )}
    </Space>
  );
}
