import { randomUUID } from 'crypto';
import { AppError } from '../../lib/errors';
import { isSupabaseConfigured } from '../../lib/config';
import { getSupabaseAdmin } from '../../lib/supabase';
import { dictionaryToContentRows, slugify } from './site-cms-dictionary.utils';
import { dictionaries } from './seed/dictionaries';

function admin() {
  if (!isSupabaseConfigured) {
    throw new AppError(503, 'Supabase не настроен на сервере');
  }
  return getSupabaseAdmin();
}

function mapDbError(error: { message: string; code?: string }): never {
  const msg = error.message.toLowerCase();
  if (msg.includes('schema cache') || msg.includes('could not find the table')) {
    throw new AppError(503, 'Таблицы CMS не найдены. Выполните docs/supabase-cms-schema.sql в Supabase SQL Editor.');
  }
  throw new AppError(400, error.message);
}

export class SiteCmsService {
  async getStatus() {
    const sb = admin();
    const tables = ['content', 'products', 'services', 'blog_posts', 'inquiries'] as const;
    const counts: Record<(typeof tables)[number], number> = {
      content: 0,
      products: 0,
      services: 0,
      blog_posts: 0,
      inquiries: 0,
    };

    for (const table of tables) {
      const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
      if (error) mapDbError(error);
      counts[table] = count ?? 0;
    }

    const { data: lastRow, error: lastError } = await sb
      .from('content')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) mapDbError(lastError);

    const hasCmsData =
      counts.content > 0 || counts.products > 0 || counts.services > 0 || counts.blog_posts > 0;

    return {
      ok: true,
      counts,
      lastContentUpdate: lastRow?.updated_at ?? null,
      hasCmsData,
      siteUsesFallback: !hasCmsData,
    };
  }

  async listContent(locale: string, section: string) {
    const sb = admin();
    const { data, error } = await sb
      .from('content')
      .select('*')
      .eq('locale', locale)
      .eq('section', section)
      .order('key');
    if (error) mapDbError(error);
    return data ?? [];
  }

  async saveContent(locale: string, section: string, rows: { key: string; value: string }[]) {
    const sb = admin();
    const { error } = await sb.from('content').upsert(
      rows.map((r) => ({
        locale,
        section,
        key: r.key,
        value: r.value,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'locale,section,key' },
    );
    if (error) mapDbError(error);
    return this.listContent(locale, section);
  }

  async listProducts(locale: string) {
    const { data, error } = await admin()
      .from('products')
      .select('*')
      .eq('locale', locale)
      .order('sort_order');
    if (error) mapDbError(error);
    return data ?? [];
  }

  async saveProducts(
    locale: string,
    items: { id?: string; name: string; category: string; image_url: string | null; sort_order: number }[],
  ) {
    const sb = admin();
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const payload = {
        locale,
        name: item.name,
        category: item.category,
        image_url: item.image_url,
        sort_order: i,
        updated_at: new Date().toISOString(),
      };
      if (item.id && !item.id.startsWith('new-')) {
        const { error } = await sb.from('products').update(payload).eq('id', item.id);
        if (error) mapDbError(error);
      } else {
        const { error } = await sb.from('products').insert(payload);
        if (error) mapDbError(error);
      }
    }
    return this.listProducts(locale);
  }

  async deleteProduct(id: string) {
    const { error } = await admin().from('products').delete().eq('id', id);
    if (error) mapDbError(error);
  }

  async listServices(locale: string) {
    const { data, error } = await admin()
      .from('services')
      .select('*')
      .eq('locale', locale)
      .order('sort_order');
    if (error) mapDbError(error);
    return data ?? [];
  }

  async saveServices(
    locale: string,
    items: { id?: string; name: string; description: string; sort_order: number }[],
  ) {
    const sb = admin();
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const payload = {
        locale,
        name: item.name,
        description: item.description,
        sort_order: i,
        updated_at: new Date().toISOString(),
      };
      if (item.id && !item.id.startsWith('new-')) {
        const { error } = await sb.from('services').update(payload).eq('id', item.id);
        if (error) mapDbError(error);
      } else {
        const { error } = await sb.from('services').insert(payload);
        if (error) mapDbError(error);
      }
    }
    return this.listServices(locale);
  }

  async deleteService(id: string) {
    const { error } = await admin().from('services').delete().eq('id', id);
    if (error) mapDbError(error);
  }

  async listBlogPosts(locale: string) {
    const { data, error } = await admin()
      .from('blog_posts')
      .select('*')
      .eq('locale', locale)
      .order('sort_order');
    if (error) mapDbError(error);
    return data ?? [];
  }

  async saveBlogPosts(
    locale: string,
    posts: {
      id?: string;
      title: string;
      slug: string;
      body: string;
      cover_url: string | null;
      category: string;
      excerpt: string;
      post_date: string;
      published_at: string | null;
    }[],
  ) {
    const sb = admin();
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]!;
      const payload = {
        locale,
        title: post.title,
        slug: post.slug,
        body: post.body,
        excerpt: post.excerpt,
        category: post.category,
        post_date: post.post_date,
        cover_url: post.cover_url,
        published_at: post.published_at ?? new Date().toISOString(),
        sort_order: i,
        updated_at: new Date().toISOString(),
      };
      if (post.id && !post.id.startsWith('new-')) {
        const { error } = await sb.from('blog_posts').update(payload).eq('id', post.id);
        if (error) mapDbError(error);
      } else {
        const { error } = await sb.from('blog_posts').insert(payload);
        if (error) mapDbError(error);
      }
    }
    return this.listBlogPosts(locale);
  }

  async deleteBlogPost(id: string) {
    const { error } = await admin().from('blog_posts').delete().eq('id', id);
    if (error) mapDbError(error);
  }

  async listInquiries() {
    const { data, error } = await admin()
      .from('inquiries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) mapDbError(error);
    return data ?? [];
  }

  /** Импорт текстов/каталога с сайта (dictionaries.ts) в Supabase — один раз после создания таблиц. */
  async seedFromDictionaries(): Promise<{ message: string }> {
    const sb = admin();
    const locales = ['ru', 'uz', 'en'] as const;

    for (const locale of locales) {
      const dict = dictionaries[locale];
      const rows = dictionaryToContentRows(locale, dict);

      const { error: contentError } = await sb.from('content').upsert(
        rows.map((r) => ({
          locale: r.locale,
          section: r.section,
          key: r.key,
          value: r.value,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'locale,section,key' },
      );
      if (contentError) mapDbError(contentError);

      await sb.from('products').delete().eq('locale', locale);
      if (dict.products.items.length) {
        const { error } = await sb.from('products').insert(
          dict.products.items.map((item, i) => ({
            locale,
            name: item.name,
            category: item.category,
            sort_order: i,
          })),
        );
        if (error) mapDbError(error);
      }

      await sb.from('services').delete().eq('locale', locale);
      if (dict.services.items.length) {
        const { error } = await sb.from('services').insert(
          dict.services.items.map((item, i) => ({
            locale,
            name: item.name,
            description: item.description,
            sort_order: i,
          })),
        );
        if (error) mapDbError(error);
      }

      await sb.from('blog_posts').delete().eq('locale', locale);
      if (dict.blog.posts.length) {
        const { error } = await sb.from('blog_posts').insert(
          dict.blog.posts.map((post, i) => ({
            locale,
            title: post.title,
            slug: slugify(post.title) + (i > 0 ? `-${i}` : ''),
            body: post.excerpt,
            excerpt: post.excerpt,
            category: post.category,
            post_date: post.date,
            sort_order: i,
            published_at: new Date().toISOString(),
          })),
        );
        if (error) mapDbError(error);
      }
    }

    return { message: 'Данные с сайта импортированы в Supabase (RU, UZ, EN).' };
  }

  async uploadImage(file: Buffer, mimeType: string, folder: string): Promise<string> {
    const sb = admin();
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const path = `${folder}/${randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('images').upload(path, file, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw new AppError(400, error.message);
    const { data } = sb.storage.from('images').getPublicUrl(path);
    return data.publicUrl;
  }
}

export const siteCmsService = new SiteCmsService();
