import {
  StarFilled,
  TrophyOutlined,
  CrownOutlined,
  FireOutlined,
  HeartOutlined,
  RocketOutlined,
  ThunderboltOutlined,
  TeamOutlined,
  GiftOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ComponentType, CSSProperties } from 'react';

export const USER_BADGE_ICON_KEYS = [
  'star',
  'trophy',
  'crown',
  'fire',
  'heart',
  'rocket',
  'thunderbolt',
  'team',
  'gift',
  'medal',
] as const;

export type UserBadgeIconKey = (typeof USER_BADGE_ICON_KEYS)[number];

export const USER_BADGE_ICON_LABELS: Record<UserBadgeIconKey, string> = {
  star: 'Звезда',
  trophy: 'Кубок',
  crown: 'Корона',
  fire: 'Огонь',
  heart: 'Сердце',
  rocket: 'Ракета',
  thunderbolt: 'Молния',
  team: 'Команда',
  gift: 'Подарок',
  medal: 'Медаль',
};

const ICON_MAP: Record<UserBadgeIconKey, ComponentType<{ style?: CSSProperties; className?: string }>> = {
  star: StarFilled,
  trophy: TrophyOutlined,
  crown: CrownOutlined,
  fire: FireOutlined,
  heart: HeartOutlined,
  rocket: RocketOutlined,
  thunderbolt: ThunderboltOutlined,
  team: TeamOutlined,
  gift: GiftOutlined,
  medal: SafetyCertificateOutlined,
};

export function UserBadgeIcon({
  iconKey,
  color,
  size = 18,
}: {
  iconKey?: string | null;
  color?: string | null;
  size?: number;
}) {
  if (!iconKey) return null;
  const Cmp = ICON_MAP[iconKey as UserBadgeIconKey];
  if (!Cmp) return null;
  return <Cmp style={{ fontSize: size, color: color || '#22609A' }} />;
}
