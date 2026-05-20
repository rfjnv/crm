import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Space, Typography, message, Popconfirm } from 'antd';
import { PlusOutlined, SaveOutlined, DeleteOutlined } from '@ant-design/icons';
import { getSupabase } from '../../lib/supabase';
import LocaleTabs from '../../components/site-admin/LocaleTabs';
import type { ServiceRow, SiteLocale } from '../../site-admin/types';

type EditableService = ServiceRow & { _isNew?: boolean };

export default function AdminSiteServicesPage() {
  const [locale, setLocale] = useState<SiteLocale>('ru');
  const [items, setItems] = useState<EditableService[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase.from('services').select('*').eq('locale', locale).order('sort_order');
    setItems((data ?? []) as ServiceRow[]);
    setLoading(false);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `new-${Date.now()}`, locale, name: '', description: '', sort_order: prev.length, _isNew: true },
    ]);
  };

  const updateItem = (id: string, patch: Partial<EditableService>) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removeItem = async (item: EditableService) => {
    const supabase = getSupabase();
    if (supabase && !item._isNew) await supabase.from('services').delete().eq('id', item.id);
    setItems((prev) => prev.filter((p) => p.id !== item.id));
    message.success('Удалено');
  };

  const saveAll = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setSaving(true);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const payload = {
        locale,
        name: item.name,
        description: item.description,
        sort_order: i,
        updated_at: new Date().toISOString(),
      };
      if (item._isNew) {
        const { data, error } = await supabase.from('services').insert(payload).select().single();
        if (error) {
          message.error(error.message);
          setSaving(false);
          return;
        }
        item.id = (data as ServiceRow).id;
        delete item._isNew;
      } else {
        const { error } = await supabase.from('services').update(payload).eq('id', item.id);
        if (error) {
          message.error(error.message);
          setSaving(false);
          return;
        }
      }
    }
    setSaving(false);
    message.success('Сохранено');
    void load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Услуги на сайте</Typography.Title>
        <LocaleTabs locale={locale} onChange={setLocale} />
      </div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<PlusOutlined />} onClick={addItem}>Добавить</Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveAll()}>Сохранить</Button>
      </Space>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading ? (
          <Card loading />
        ) : (
          items.map((item) => (
            <Card
              key={item.id}
              extra={
                <Popconfirm title="Удалить?" onConfirm={() => void removeItem(item)}>
                  <Button type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              }
            >
              <Form layout="vertical">
                <Form.Item label="Название">
                  <Input value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} />
                </Form.Item>
                <Form.Item label="Описание">
                  <Input.TextArea rows={3} value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} />
                </Form.Item>
              </Form>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
