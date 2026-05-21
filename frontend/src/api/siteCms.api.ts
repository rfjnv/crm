import client from './client';
import type { BlogPostRow, ContentRow, ProductRow, ServiceRow } from '../site-admin/types';

export type InquiryRow = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  request_type: string;
  quantity: string | null;
  details: string;
  created_at: string;
};

export const siteCmsApi = {
  status: () =>
    client
      .get<{
        ok: boolean;
        counts: { content: number; products: number; services: number; blog_posts: number; inquiries: number };
        lastContentUpdate: string | null;
        hasCmsData: boolean;
        siteUsesFallback: boolean;
      }>('/site-cms/status')
      .then((r) => r.data),

  listContent: (locale: string, section: string) =>
    client.get<ContentRow[]>('/site-cms/content', { params: { locale, section } }).then((r) => r.data),

  saveContent: (locale: string, section: string, rows: { key: string; value: string }[]) =>
    client.put<ContentRow[]>('/site-cms/content', { locale, section, rows }).then((r) => r.data),

  listProducts: (locale: string) =>
    client.get<ProductRow[]>('/site-cms/products', { params: { locale } }).then((r) => r.data),

  saveProducts: (locale: string, items: ProductRow[]) =>
    client.put<ProductRow[]>('/site-cms/products', { locale, items }).then((r) => r.data),

  deleteProduct: (id: string) => client.delete(`/site-cms/products/${id}`),

  listServices: (locale: string) =>
    client.get<ServiceRow[]>('/site-cms/services', { params: { locale } }).then((r) => r.data),

  saveServices: (locale: string, items: ServiceRow[]) =>
    client.put<ServiceRow[]>('/site-cms/services', { locale, items }).then((r) => r.data),

  deleteService: (id: string) => client.delete(`/site-cms/services/${id}`),

  listBlog: (locale: string) =>
    client.get<BlogPostRow[]>('/site-cms/blog', { params: { locale } }).then((r) => r.data),

  saveBlog: (locale: string, posts: BlogPostRow[]) =>
    client.put<BlogPostRow[]>('/site-cms/blog', { locale, posts }).then((r) => r.data),

  deleteBlogPost: (id: string) => client.delete(`/site-cms/blog/${id}`),

  listInquiries: () => client.get<InquiryRow[]>('/site-cms/inquiries').then((r) => r.data),

  seedFromDictionaries: () =>
    client.post<{ message: string }>('/site-cms/seed').then((r) => r.data),

  uploadImage: (file: File, folder: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('folder', folder);
    return client
      .post<{ url: string }>('/site-cms/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data.url);
  },
};
