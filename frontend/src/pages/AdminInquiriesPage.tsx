import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Table, Button, Typography, Card } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { siteCmsApi } from '../api/siteCms.api';
import { useIsMobile } from '../hooks/useIsMobile';

export default function AdminInquiriesPage() {
  const isMobile = useIsMobile();

  const { data: users = [], isLoading, refetch } = useQuery({
    queryKey: ['site-cms-inquiries'],
    queryFn: siteCmsApi.listInquiries,
  });

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
      render: (_: unknown, row: { name: string; company: string | null }) => (
        <>
          <div>{row.name}</div>
          {row.company ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.company}</Typography.Text> : null}
        </>
      ),
    },
    {
      title: 'Контакт',
      key: 'contact',
      render: (_: unknown, row: { phone: string | null; email: string | null }) => (
        <>
          {row.phone && <div>{row.phone}</div>}
          {row.email && <div>{row.email}</div>}
        </>
      ),
    },
    {
      title: 'Категория',
      key: 'request_type',
      render: (_: unknown, row: { request_type: string; quantity: string | null }) => (
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
          <Typography.Text type="secondary">Обращения с формы контактов</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>
          Обновить
        </Button>
      </div>
      <Card>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={users}
          columns={columns}
          scroll={isMobile ? { x: 800 } : undefined}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
