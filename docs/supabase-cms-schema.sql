-- Polygraph Business CMS — выполнить один раз в Supabase SQL Editor
-- Dashboard → SQL → New query → вставить весь файл → Run

create table if not exists public.content (
  id uuid primary key default gen_random_uuid(),
  locale text not null check (locale in ('ru', 'uz', 'en')),
  section text not null,
  key text not null,
  value text not null default '',
  updated_at timestamptz not null default now(),
  unique (locale, section, key)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  locale text not null check (locale in ('ru', 'uz', 'en')),
  name text not null,
  category text not null default '',
  image_url text,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  locale text not null check (locale in ('ru', 'uz', 'en')),
  name text not null,
  description text not null default '',
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  locale text not null check (locale in ('ru', 'uz', 'en')),
  title text not null,
  slug text not null,
  body text not null default '',
  cover_url text,
  category text not null default '',
  excerpt text not null default '',
  post_date text not null default '',
  published_at timestamptz,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  unique (locale, slug)
);

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  phone text,
  email text,
  request_type text not null default '',
  quantity text,
  details text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_content_locale on public.content (locale);
create index if not exists idx_products_locale_sort on public.products (locale, sort_order);
create index if not exists idx_services_locale_sort on public.services (locale, sort_order);
create index if not exists idx_blog_posts_locale on public.blog_posts (locale, sort_order);
create index if not exists idx_inquiries_created on public.inquiries (created_at desc);

insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

alter table public.content enable row level security;
alter table public.products enable row level security;
alter table public.services enable row level security;
alter table public.blog_posts enable row level security;
alter table public.inquiries enable row level security;

create policy "content_public_read" on public.content for select using (true);
create policy "products_public_read" on public.products for select using (true);
create policy "services_public_read" on public.services for select using (true);
create policy "blog_posts_public_read" on public.blog_posts for select using (true);

create policy "inquiries_public_insert" on public.inquiries for insert with check (true);

create policy "content_admin_all" on public.content for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "products_admin_all" on public.products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "services_admin_all" on public.services for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "blog_posts_admin_all" on public.blog_posts for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "inquiries_admin_read" on public.inquiries for select using (auth.role() = 'authenticated');

create policy "images_public_read" on storage.objects for select using (bucket_id = 'images');
create policy "images_admin_write" on storage.objects for all using (bucket_id = 'images' and auth.role() = 'authenticated') with check (bucket_id = 'images' and auth.role() = 'authenticated');
