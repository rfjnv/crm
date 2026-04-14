import { CrownFilled } from '@ant-design/icons';
import { Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';

/** Минимальные поля для бейджа SVIP рядом с названием компании */
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
  const riskMeta = creditStatus === 'NEGATIVE'
    ? {
        letter: 'Н',
        tagColor: '#cf1322',
        bgGradient: 'linear-gradient(90deg, #fff1f0 0%, #ffd8d6 100%)',
        accent: '#cf1322',
      }
    : creditStatus === 'SATISFACTORY'
      ? {
          letter: 'У',
          tagColor: '#d48806',
          bgGradient: 'linear-gradient(90deg, #fffbe6 0%, #ffe7ba 100%)',
          accent: '#d48806',
        }
      : null;

  const nameEl =
    link && client?.id ? (
      <Typography.Text
        type={secondary ? 'secondary' : undefined}
        style={{
          margin: 0,
          background: riskMeta ? riskMeta.bgGradient : undefined,
          borderRadius: riskMeta ? 4 : undefined,
          padding: riskMeta ? '1px 6px' : undefined,
          display: 'inline-block',
        }}
      >
        <Link to={`/clients/${client.id}`} style={{ fontWeight: vip ? 600 : undefined }}>
          {name}
        </Link>
      </Typography.Text>
    ) : (
      <Typography.Text
        type={secondary ? 'secondary' : undefined}
        style={{
          margin: 0,
          fontWeight: vip ? 600 : undefined,
          background: riskMeta ? riskMeta.bgGradient : undefined,
          borderRadius: riskMeta ? 4 : undefined,
          padding: riskMeta ? '1px 6px' : undefined,
          display: 'inline-block',
        }}
      >
        {name}
      </Typography.Text>
    );

  return (
    <Space size={6} align="center" wrap className={className} style={style}>
      {vip && (
        <CrownFilled style={{ color: riskMeta?.accent || '#faad14', fontSize: variant === 'full' ? 16 : 14 }} aria-hidden />
      )}
      {nameEl}
      {riskMeta && (
        <Tag
          color={riskMeta.tagColor}
          style={{
            margin: 0,
            lineHeight: 1.2,
            width: 20,
            textAlign: 'center',
            paddingInline: 0,
            fontWeight: 700,
          }}
          title={creditStatus === 'NEGATIVE' ? 'Негатив: нельзя в долг' : 'Удовлетворительный: ограниченный долг'}
        >
          {riskMeta.letter}
        </Tag>
      )}
      {vip && variant === 'full' && (
        <Tag
          color={riskMeta ? undefined : 'gold'}
          style={{
            margin: 0,
            lineHeight: 1.35,
            background: riskMeta ? riskMeta.bgGradient : undefined,
            borderColor: riskMeta ? riskMeta.accent : undefined,
            color: riskMeta ? riskMeta.accent : undefined,
            fontWeight: riskMeta ? 600 : undefined,
          }}
        >
          SVIP
        </Tag>
      )}
    </Space>
  );
}
