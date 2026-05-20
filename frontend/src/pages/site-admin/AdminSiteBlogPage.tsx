import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Space, Typography, message, Popconfirm } from 'antd';
import { PlusOutlined, SaveOutlined, DeleteOutlined } from '@ant-design/icons';
import { siteCmsApi } from '../../api/siteCms.api';
import LocaleTabs from '../../components/site-admin/LocaleTabs';
import SiteImageUpload from '../../components/site-admin/SiteImageUpload';
import { slugify } from '../../site-admin/contentSections';
import type { BlogPostRow, SiteLocale } from '../../site-admin/types';

type EditablePost = BlogPostRow & { _isNew?: boolean };

export default function AdminSiteBlogPage() {
  const [locale, setLocale] = useState<SiteLocale>('ru');
  const [posts, setPosts] = useState<EditablePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPosts(await siteCmsApi.listBlog(locale));
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const addPost = () => {
    setPosts((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        locale,
        title: '',
        slug: '',
        body: '',
        cover_url: null,
        category: '',
        excerpt: '',
        post_date: new Date().toLocaleDateString('ru-RU'),
        published_at: new Date().toISOString(),
        sort_order: prev.length,
        _isNew: true,
      },
    ]);
  };

  const updatePost = (id: string, patch: Partial<EditablePost>) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        if (patch.title && !patch.slug && next._isNew) next.slug = slugify(patch.title);
        return next;
      }),
    );
  };

  const removePost = async (post: EditablePost) => {
    try {
      if (!post._isNew) await siteCmsApi.deleteBlogPost(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      message.success('Удалено');
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    }
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      setPosts(await siteCmsApi.saveBlog(locale, posts));
      message.success('Сохранено');
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Блог на сайте</Typography.Title>
        <LocaleTabs locale={locale} onChange={setLocale} />
      </div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<PlusOutlined />} onClick={addPost}>Добавить</Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveAll()}>Сохранить</Button>
      </Space>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading ? (
          <Card loading />
        ) : (
          posts.map((post) => (
            <Card
              key={post.id}
              extra={
                <Popconfirm title="Удалить?" onConfirm={() => void removePost(post)}>
                  <Button type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              }
            >
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
                <SiteImageUpload
                  currentUrl={post.cover_url}
                  folder="blog"
                  onUploaded={(url) => updatePost(post.id, { cover_url: url })}
                />
                <Form layout="vertical">
                  <Form.Item label="Заголовок">
                    <Input value={post.title} onChange={(e) => updatePost(post.id, { title: e.target.value })} />
                  </Form.Item>
                  <Form.Item label="Slug">
                    <Input value={post.slug} onChange={(e) => updatePost(post.id, { slug: e.target.value })} />
                  </Form.Item>
                  <Form.Item label="Категория">
                    <Input value={post.category} onChange={(e) => updatePost(post.id, { category: e.target.value })} />
                  </Form.Item>
                  <Form.Item label="Краткое описание">
                    <Input.TextArea rows={2} value={post.excerpt} onChange={(e) => updatePost(post.id, { excerpt: e.target.value })} />
                  </Form.Item>
                  <Form.Item label="Текст">
                    <Input.TextArea rows={6} value={post.body} onChange={(e) => updatePost(post.id, { body: e.target.value })} />
                  </Form.Item>
                </Form>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
