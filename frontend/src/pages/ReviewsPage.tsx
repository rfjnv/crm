import { useMemo, useState } from 'react';
import { Typography, Table, Rate, Card, Segmented } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { reviewsApi } from '../api/reviews.api';
import type { ReviewRow } from '../api/reviews.api';
import dayjs from 'dayjs';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';

const { Title } = Typography;

type FilterKey = 'all' | 'telegram' | 'delivery';

export default function ReviewsPage() {
  const [filter, setFilter] = useState<FilterKey>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['reviews-bundle'],
    queryFn: reviewsApi.getReviews,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const merged: ReviewRow[] = [...data.telegram, ...data.delivery].sort(
      (a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf(),
    );
    if (filter === 'telegram') return merged.filter((r) => r.channel === 'telegram');
    if (filter === 'delivery') return merged.filter((r) => r.channel === 'delivery');
    return merged;
  }, [data, filter]);

  const columns = [
    {
      title: 'Канал',
      dataIndex: 'channelLabel',
      key: 'channelLabel',
      width: 200,
      render: (label: string) => <Typography.Text strong>{label}</Typography.Text>,
    },
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
      width: 150,
    },
    {
      title: 'Клиент',
      key: 'client',
      render: (_: unknown, record: ReviewRow) => (
        <div>
          <ClientCompanyDisplay client={record.deal.client} link />
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            {[record.deal.client.contactName, record.deal.client.phone].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      ),
      width: 220,
    },
    {
      title: 'Менеджер',
      key: 'manager',
      render: (_: unknown, record: ReviewRow) => record.deal.manager.fullName,
      width: 200,
    },
    {
      title: 'Сделка',
      key: 'deal',
      render: (_: unknown, record: ReviewRow) => (
        <Link to={`/deals/${record.deal.id}`}>{record.deal.title}</Link>
      ),
      width: 250,
    },
    {
      title: 'Оценка',
      dataIndex: 'rating',
      key: 'rating',
      render: (rating: number) => <Rate disabled value={rating} />,
      width: 150,
    },
    {
      title: 'Комментарий',
      dataIndex: 'text',
      key: 'text',
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Title level={4} style={{ marginTop: 0 }}>Отзывы</Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Оценки из Telegram-бота и оценки после доставки (ссылка по QR на одной странице).
      </Typography.Paragraph>

      <Segmented
        style={{ marginBottom: 16 }}
        value={filter}
        onChange={(v) => setFilter(v as FilterKey)}
        options={[
          { label: `Все (${data ? data.telegram.length + data.delivery.length : 0})`, value: 'all' },
          { label: `Telegram (${data?.telegram.length ?? 0})`, value: 'telegram' },
          { label: `После доставки (${data?.delivery.length ?? 0})`, value: 'delivery' },
        ]}
      />

      <Card style={{ marginTop: 0 }} styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={rows}
          columns={columns}
          rowKey={(r) => `${r.channel}-${r.id}`}
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1100 }}
        />
      </Card>
    </div>
  );
}
