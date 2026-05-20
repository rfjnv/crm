export type SiteLocale = 'ru' | 'uz' | 'en';

export const SITE_LOCALES: { value: SiteLocale; label: string }[] = [
  { value: 'ru', label: 'RU' },
  { value: 'uz', label: 'UZ' },
  { value: 'en', label: 'EN' },
];

export type ContentRow = {
  id?: string;
  locale: string;
  section: string;
  key: string;
  value: string;
  updated_at?: string;
};

export type ProductRow = {
  id: string;
  locale: string;
  name: string;
  category: string;
  image_url: string | null;
  sort_order: number;
};

export type ServiceRow = {
  id: string;
  locale: string;
  name: string;
  description: string;
  sort_order: number;
};

export type BlogPostRow = {
  id: string;
  locale: string;
  title: string;
  slug: string;
  body: string;
  cover_url: string | null;
  category: string;
  excerpt: string;
  post_date: string;
  published_at: string | null;
  sort_order: number;
};
