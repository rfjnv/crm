import { Space, Tag, theme } from 'antd';
import { UserBadgeIcon } from '../constants/userBadges';

type Props = {
  badgeLabel?: string | null;
  badgeIcon?: string | null;
  badgeColor?: string | null;
  /** compact: только тег; full: иконка + тег */
  variant?: 'compact' | 'full';
};

/** Медаль команды: произвольный текст + цвет + иконка (аналогично бейджу SVIP у клиентов). */
export function TeamMedalDisplay({
  badgeLabel,
  badgeIcon,
  badgeColor,
  variant = 'full',
}: Props) {
  const { token } = theme.useToken();
  const label = badgeLabel?.trim();
  const color = badgeColor?.trim() || '#22609A';
  const hasIcon = !!badgeIcon;
  const hasLabel = !!label;
  const fillBg = color.startsWith('#') && color.length === 7 ? `${color}22` : `${color}33`;

  if (!hasIcon && !hasLabel) {
    return <span style={{ color: token.colorTextQuaternary }}>—</span>;
  }

  const tag = hasLabel ? (
    <Tag
      style={{
        margin: 0,
        lineHeight: 1.45,
        borderColor: color,
        color,
        background: fillBg,
      }}
    >
      {label}
    </Tag>
  ) : null;

  if (variant === 'compact') {
    return tag ?? <UserBadgeIcon iconKey={badgeIcon} color={color} size={18} />;
  }

  return (
    <Space size={8} align="center" wrap>
      {hasIcon && <UserBadgeIcon iconKey={badgeIcon} color={color} size={18} />}
      {tag}
    </Space>
  );
}
