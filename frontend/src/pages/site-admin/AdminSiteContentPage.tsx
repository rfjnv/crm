import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Space, Typography, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { getSupabase } from '../../lib/supabase';
import LocaleTabs from '../../components/site-admin/LocaleTabs';
import { CONTENT_SECTIONS, SECTION_LABELS, type ContentSection } from '../../site-admin/contentSections';
import type { ContentRow, SiteLocale } from '../../site-admin/types';

export default function AdminSiteContentPage() {
  const [locale, setLocale] = useState<SiteLocale>('ru');
  const [section, setSection] = useState<ContentSection>('nav');
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('content')
      .select('*')
      .eq('locale', locale)
      .eq('section', section)
      .order('key');
    setLoading(false);
    if (error) message.error(error.message);
    else setRows((data ?? []) as ContentRow[]);
  }, [locale, section]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRow = (key: string, value: string) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx]!, value };
        return next;
      }
      return [...prev, { locale, section, key, value }];
    });
  };

  const handleSave = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from('content').upsert(
      rows.map((r) => ({
        locale,
        section,
        key: r.key,
        value: r.value,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'locale,section,key' },
    );
    setSaving(false);
    if (error) message.error(error.message);
    else {
      message.success('Сохранено');
      void load();
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Тексты сайта</Typography.Title>
        <LocaleTabs locale={locale} onChange={setLocale} />
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        {CONTENT_SECTIONS.map((s) => (
          <Button key={s} type={s === section ? 'primary' : 'default'} size="small" onClick={() => setSection(s)}>
            {SECTION_LABELS[s]}
          </Button>
        ))}
      </Space>

      <Card loading={loading}>
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            Сохранить секцию
          </Button>
        </Space>

        {rows.length === 0 && !loading ? (
          <Typography.Text type="secondary">Нет полей для этой секции. Добавьте записи в Supabase или заполните через старую админку сайта.</Typography.Text>
        ) : (
          <Form layout="vertical">
            {rows.map((row) => {
              const multiline = row.value.length > 80 || row.value.startsWith('[') || row.value.startsWith('{');
              return (
                <Form.Item key={row.key} label={row.key}>
                  {multiline ? (
                    <Input.TextArea rows={4} value={row.value} onChange={(e) => updateRow(row.key, e.target.value)} />
                  ) : (
                    <Input value={row.value} onChange={(e) => updateRow(row.key, e.target.value)} />
                  )}
                </Form.Item>
              );
            })}
          </Form>
        )}
      </Card>
    </div>
  );
}
