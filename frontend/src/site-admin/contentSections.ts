export const CONTENT_SECTIONS = [
  'meta',
  'nav',
  'hero',
  'about',
  'stats',
  'services',
  'products',
  'blog',
  'contact',
  'form',
  'footer',
  'trust',
  'ctaSection',
] as const;

export type ContentSection = (typeof CONTENT_SECTIONS)[number];

export const SECTION_LABELS: Record<ContentSection, string> = {
  meta: 'SEO / Meta',
  nav: 'Навигация',
  hero: 'Главная — Hero',
  about: 'О компании',
  stats: 'Статистика',
  services: 'Услуги (заголовки)',
  products: 'Продукция (заголовки)',
  blog: 'Блог (заголовки)',
  contact: 'Контакты',
  form: 'Форма заявки',
  footer: 'Подвал',
  trust: 'Блок доверия',
  ctaSection: 'CTA секция',
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `post-${Date.now()}`;
}
