import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Table, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getSupabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';

type InquiryRow = {
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

export default function AdminInquiriesPage() {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<InquiryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('inquiries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      console.error(error);
    }
    setRows((data ?? []) as InquiryRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: 'Имя',
      key: 'name',
      render: (_: unknown, row: InquiryRow) => (
        <>
          <div>{row.name}</div>
          {row.company ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.company}</Typography.Text> : null}
        </>
      ),
    },
    {
      title: 'Контакт',
      key: 'contact',
      render: (_: unknown, row: InquiryRow) => (
        <>
          {row.phone && <div>{row.phone}</div>}
          {row.email && <div>{row.email}</div>}
        </>
      ),
    },
    {
      title: 'Категория',
      key: 'request_type',
      render: (_: unknown, row: InquiryRow) => (
        <>
          <div>{row.request_type}</div>
          {row.quantity ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.quantity}</Typography.Text> : null}
        </>
      ),
    },
    {
      title: 'Детали',
      dataIndex: 'details',
      key: 'details',
      ellipsis: true,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={3} style={{ marginTop: 0 }}>Заявки с сайта</Typography.Title>
          <Typography.Text type="secondary">Обращения с формы контактов на маркетинговом сайте</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          Обновить
        </Button>
      </div>
      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={isMobile ? { x: 800 } : undefined}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
