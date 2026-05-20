import { z } from 'zod';

export const localeSectionQuery = z.object({
  locale: z.enum(['ru', 'uz', 'en']),
  section: z.string().min(1),
});

export const localeQuery = z.object({
  locale: z.enum(['ru', 'uz', 'en']),
});

export const saveContentDto = z.object({
  locale: z.enum(['ru', 'uz', 'en']),
  section: z.string().min(1),
  rows: z.array(z.object({ key: z.string().min(1), value: z.string() })),
});

export const productItemSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  category: z.string(),
  image_url: z.string().nullable(),
  sort_order: z.number().int(),
});

export const saveProductsDto = z.object({
  locale: z.enum(['ru', 'uz', 'en']),
  items: z.array(productItemSchema),
});

export const serviceItemSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string(),
  sort_order: z.number().int(),
});

export const saveServicesDto = z.object({
  locale: z.enum(['ru', 'uz', 'en']),
  items: z.array(serviceItemSchema),
});

export const blogPostSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  slug: z.string(),
  body: z.string(),
  cover_url: z.string().nullable(),
  category: z.string(),
  excerpt: z.string(),
  post_date: z.string(),
  published_at: z.string().nullable(),
});

export const saveBlogDto = z.object({
  locale: z.enum(['ru', 'uz', 'en']),
  posts: z.array(blogPostSchema),
});
