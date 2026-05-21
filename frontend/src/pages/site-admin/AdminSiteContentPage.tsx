import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Space, Typography, message, Modal } from 'antd';
import { SaveOutlined, PlusOutlined } from '@ant-design/icons';
import { siteCmsApi } from '../../api/siteCms.api';
import CmsSchemaAlert from '../../components/site-admin/CmsSchemaAlert';
import LocaleTabs from '../../components/site-admin/LocaleTabs';
import { CONTENT_SECTIONS, SECTION_LABELS, type ContentSection } from '../../site-admin/contentSections';
import type { ContentRow, SiteLocale } from '../../site-admin/types';

export default function AdminSiteContentPage() {
  const [locale, setLocale] = useState<SiteLocale>('ru');
  const [section, setSection] = useState<ContentSection>('nav');
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [newKey, setNewKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await siteCmsApi.listContent(locale, section);
      setSchemaMissing(false);
      setRows(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '';
      if (msg.includes('Таблицы CMS') || msg.includes('schema cache')) setSchemaMissing(true);
      else message.error(msg || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
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
    setSaving(true);
    try {
      const data = await siteCmsApi.saveContent(
        locale,
        section,
        rows.map((r) => ({ key: r.key, value: r.value })),
      );
      setRows(data);
      message.success('Сохранено в Supabase. Обновите сайт polygraph-business.onrender.com (Ctrl+F5).');
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const addField = () => {
    const key = newKey.trim();
    if (!key) return;
    if (rows.some((r) => r.key === key)) {
      message.warning('Такой ключ уже есть');
      return;
    }
    setRows((prev) => [...prev, { locale, section, key, value: '' }]);
    setNewKey('');
    setAddFieldOpen(false);
  };

  return (
    <div>
      {schemaMissing ? <CmsSchemaAlert /> : null}
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
          <Button icon={<PlusOutlined />} onClick={() => setAddFieldOpen(true)}>
            Добавить поле
          </Button>
        </Space>

        {rows.length === 0 && !loading ? (
          <Typography.Paragraph type="secondary">
            В этой секции пока нет текстов. Нажмите «Добавить поле» (например ключ <code>title</code> или <code>subtitle</code>), введите значение и сохраните.
          </Typography.Paragraph>
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

      <Modal
        title="Новое поле"
        open={addFieldOpen}
        onOk={addField}
        onCancel={() => {
          setAddFieldOpen(false);
          setNewKey('');
        }}
        okText="Добавить"
      >
        <Form layout="vertical">
          <Form.Item label="Ключ (латиница, например title или menu.about)">
            <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="title" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
