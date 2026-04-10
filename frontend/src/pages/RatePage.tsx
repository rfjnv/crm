import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Typography, Button, Input, Rate, Card, Result, Spin } from 'antd';
import { StarFilled, CheckCircleFilled } from '@ant-design/icons';
import client from '../api/client';

interface RatingInfo {
  dealTitle: string;
  dealDate: string;
  driverName: string | null;
  loaderName: string | null;
  alreadyRated: boolean;
  rating: number | null;
}

export default function RatePage() {
  const { token } = useParams<{ token: string }>();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, isError } = useQuery<RatingInfo>({
    queryKey: ['public-rate', token],
    queryFn: () => client.get(`/public/rate/${token}`).then((r) => r.data),
    enabled: !!token,
    retry: false,
  });

  const submitMut = useMutation({
    mutationFn: () => client.post(`/public/rate/${token}`, { rating, comment: comment.trim() || undefined }),
    onSuccess: () => setSubmitted(true),
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'var(--app-vh, 100vh)', background: '#f5f5f5' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'var(--app-vh, 100vh)', background: '#f5f5f5' }}>
        <Result status="404" title="Ссылка не найдена" subTitle="Возможно, ссылка устарела или недействительна." />
      </div>
    );
  }

  if (data.alreadyRated || submitted) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'var(--app-vh, 100vh)', background: '#f5f5f5', padding: 16 }}>
        <Card style={{ maxWidth: 420, width: '100%', textAlign: 'center', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <CheckCircleFilled style={{ fontSize: 56, color: '#52c41a', marginBottom: 16 }} />
          <Typography.Title level={3} style={{ marginBottom: 8 }}>Спасибо за оценку!</Typography.Title>
          {(data.rating || rating) > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Rate disabled value={data.rating || rating} character={<StarFilled />} style={{ fontSize: 28 }} />
            </div>
          )}
          <Typography.Text type="secondary">Ваш отзыв помогает нам стать лучше.</Typography.Text>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'var(--app-vh, 100vh)', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 16 }}>
      <Card style={{ maxWidth: 420, width: '100%', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>Оцените доставку</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {data.dealTitle}
          </Typography.Text>
        </div>

        {data.driverName && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <Typography.Text>Водитель: <strong>{data.driverName}</strong></Typography.Text>
          </div>
        )}

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Rate
            value={rating}
            onChange={setRating}
            character={<StarFilled />}
            style={{ fontSize: 40 }}
          />
          {rating > 0 && (
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">
                {rating === 1 && 'Очень плохо'}
                {rating === 2 && 'Плохо'}
                {rating === 3 && 'Нормально'}
                {rating === 4 && 'Хорошо'}
                {rating === 5 && 'Отлично!'}
              </Typography.Text>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <Input.TextArea
            rows={3}
            placeholder="Оставьте комментарий (необязательно)..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            showCount
          />
        </div>

        <Button
          type="primary"
          block
          size="large"
          disabled={rating === 0}
          loading={submitMut.isPending}
          onClick={() => submitMut.mutate()}
          style={{ borderRadius: 8, height: 48, fontSize: 16 }}
        >
          Отправить оценку
        </Button>

        {submitMut.isError && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <Typography.Text type="danger">
              {(submitMut.error as any)?.response?.data?.error || 'Произошла ошибка'}
            </Typography.Text>
          </div>
        )}
      </Card>
    </div>
  );
}
