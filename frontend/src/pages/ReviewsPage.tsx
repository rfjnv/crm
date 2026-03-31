import { Typography, Table, Rate, Card } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { reviewsApi } from '../api/reviews.api';
import type { TelegramReview } from '../api/reviews.api';
import dayjs from 'dayjs';

const { Title } = Typography;

export default function ReviewsPage() {
  const { data: reviews, isLoading } = useQuery({
    queryKey: ['telegram-reviews'],
    queryFn: reviewsApi.getReviews,
  });

  const columns = [
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
      render: (_: unknown, record: TelegramReview) => (
        <div>
          <Link to={`/clients/${record.deal.client.id}`}>
            {record.deal.client.contactName}
          </Link>
          <div style={{ fontSize: 12, color: 'gray' }}>{record.deal.client.phone}</div>
        </div>
      ),
      width: 200,
    },
    {
      title: 'Менеджер',
      key: 'manager',
      render: (_: unknown, record: TelegramReview) => record.deal.manager.fullName,
      width: 200,
    },
    {
      title: 'Сделка',
      key: 'deal',
      render: (_: unknown, record: TelegramReview) => (
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
      <Title level={4} style={{ marginTop: 0 }}>Отзывы из Telegram</Title>
      
      <Card style={{ marginTop: 16 }} bodyStyle={{ padding: 0 }}>
        <Table
          dataSource={reviews}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1000 }}
        />
      </Card>
    </div>
  );
}
