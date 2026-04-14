/** Допустимые ключи значка (фронтенд сопоставляет с иконками Ant Design). */
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
