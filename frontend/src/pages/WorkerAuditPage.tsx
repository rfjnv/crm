import { useState } from 'react';
import {
  Row, Col, Card, Rate, Typography, Button, Modal, Form,
  Input, DatePicker, Tag, Space, Empty, Popconfirm,
  Divider, Tooltip, message, Spin,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  StarFilled, UserOutlined, CalendarOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { workerReviewsApi } from '../api/workerReviews.api';
import type { WorkerSummary, WorkerReview } from '../types';

const { Title, Text, Paragraph } = Typography;

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Супер Админ',
  ADMIN: 'Администратор',
  MANAGER: 'Менеджер',
  OPERATOR: 'Оператор',
  HR: 'HR',
  ACCOUNTANT: 'Бухгалтер',
  WAREHOUSE: 'Склад',
  WAREHOUSE_MANAGER: 'Зав. склада',
  DRIVER: 'Водитель',
  LOADER: 'Грузчик',
  FOREIGN_TRADE: 'ВЭД',
};

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'red',
  ADMIN: 'volcano',
  MANAGER: 'blue',
  OPERATOR: 'cyan',
  HR: 'purple',
  ACCOUNTANT: 'gold',
  WAREHOUSE: 'green',
  WAREHOUSE_MANAGER: 'lime',
  DRIVER: 'orange',
  LOADER: 'geekblue',
  FOREIGN_TRADE: 'magenta',
};

function ratingColor(avg: number | null): string {
  if (avg === null) return 'var(--color-text-secondary)';
  if (avg >= 4.5) return '#52c41a';
  if (avg >= 3.5) return '#1890ff';
  if (avg >= 2.5) return '#faad14';
  return '#ff4d4f';
}

function StarDisplay({ value }: { value: number | null }) {
  if (value === null) return <Text type="secondary">Нет оценок</Text>;
  return (
    <Space size={4} align="center">
      <StarFilled style={{ color: ratingColor(value), fontSize: 16 }} />
      <Text strong style={{ color: ratingColor(value), fontSize: 16 }}>{value.toFixed(1)}</Text>
    </Space>
  );
}

export default function WorkerAuditPage() {
  const qc = useQueryClient();
  const [selectedWorker, setSelectedWorker] = useState<WorkerSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<WorkerReview | null>(null);
  const [form] = Form.useForm();

  const { data: summaries = [], isLoading } = useQuery({
    queryKey: ['worker-reviews', 'summaries'],
    queryFn: workerReviewsApi.getSummaries,
  });

  const createMutation = useMutation({
    mutationFn: workerReviewsApi.create,
    onSuccess: () => {
      message.success('Оценка добавлена');
      qc.invalidateQueries({ queryKey: ['worker-reviews'] });
      setFormOpen(false);
      setEditingReview(null);
      form.resetFields();
    },
    onError: () => message.error('Ошибка при сохранении'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { rating?: number; comment?: string } }) =>
      workerReviewsApi.update(id, payload),
    onSuccess: () => {
      message.success('Оценка обновлена');
      qc.invalidateQueries({ queryKey: ['worker-reviews'] });
      setFormOpen(false);
      setEditingReview(null);
      form.resetFields();
    },
    onError: () => message.error('Ошибка при обновлении'),
  });

  const deleteMutation = useMutation({
    mutationFn: workerReviewsApi.delete,
    onSuccess: () => {
      message.success('Оценка удалена');
      qc.invalidateQueries({ queryKey: ['worker-reviews'] });
    },
    onError: () => message.error('Ошибка при удалении'),
  });

  function openAddForm(worker: WorkerSummary) {
    setEditingReview(null);
    setSelectedWorker(worker);
    form.setFieldsValue({
      managerId: worker.id,
      period: dayjs(),
      rating: 3,
      comment: '',
    });
    setFormOpen(true);
  }

  function openEditForm(review: WorkerReview, worker: WorkerSummary) {
    setEditingReview(review);
    setSelectedWorker(worker);
    form.setFieldsValue({
      rating: review.rating,
      comment: review.comment ?? '',
      period: dayjs(review.period, 'YYYY-MM'),
    });
    setFormOpen(true);
  }

  function openHistory(worker: WorkerSummary) {
    setSelectedWorker(worker);
    setDrawerOpen(true);
  }

  function handleFormSubmit() {
    form.validateFields().then((vals) => {
      const period = (vals.period as dayjs.Dayjs).format('YYYY-MM');
      if (editingReview) {
        updateMutation.mutate({
          id: editingReview.id,
          payload: { rating: vals.rating, comment: vals.comment || undefined },
        });
      } else {
        createMutation.mutate({
          managerId: selectedWorker!.id,
          rating: vals.rating,
          comment: vals.comment || undefined,
          period,
        });
      }
    });
  }

  const workerInModal = selectedWorker
    ? summaries.find((s) => s.id === selectedWorker.id) ?? selectedWorker
    : null;

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 0' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>Аудит сотрудников</Title>
        <Text type="secondary">Оценки и отзывы — только для администраторов</Text>
      </div>

      <Row gutter={[16, 16]}>
        {summaries.map((worker) => (
          <Col key={worker.id} xs={24} sm={12} md={8} xl={6}>
            <Card
              hoverable
              style={{ borderRadius: 12, height: '100%' }}
              styles={{ body: { padding: '20px' } }}
              actions={[
                <Tooltip title="Добавить оценку" key="add">
                  <Button
                    type="text"
                    icon={<PlusOutlined />}
                    onClick={() => openAddForm(worker)}
                  >
                    Оценить
                  </Button>
                </Tooltip>,
                <Button
                  type="text"
                  key="history"
                  onClick={() => openHistory(worker)}
                  style={{ color: 'var(--color-primary)' }}
                >
                  История ({worker.reviewCount})
                </Button>,
              ]}
            >
              {/* Header */}
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Space size={8}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'var(--color-bg-elevated)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18,
                    }}>
                      <UserOutlined style={{ color: 'var(--color-primary)' }} />
                    </div>
                    <div>
                      <Text strong style={{ fontSize: 14, display: 'block' }}>{worker.fullName}</Text>
                      <Tag color={ROLE_COLORS[worker.role] ?? 'default'} style={{ marginTop: 2, fontSize: 11 }}>
                        {ROLE_LABELS[worker.role] ?? worker.role}
                      </Tag>
                    </div>
                  </Space>
                </Space>

                {/* Rating */}
                <div style={{
                  background: 'var(--color-bg-elevated)',
                  borderRadius: 8, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <StarDisplay value={worker.avgRating} />
                  {worker.reviewCount > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {worker.reviewCount} {worker.reviewCount === 1 ? 'отзыв' : worker.reviewCount < 5 ? 'отзыва' : 'отзывов'}
                    </Text>
                  )}
                </div>

                {/* Stars visual */}
                {worker.avgRating !== null && (
                  <Rate disabled allowHalf value={worker.avgRating} style={{ fontSize: 14 }} />
                )}

                {/* Latest comment */}
                {worker.latestReview?.comment && (
                  <div style={{
                    borderLeft: '3px solid var(--color-primary)',
                    paddingLeft: 10,
                    marginTop: 4,
                  }}>
                    <Paragraph
                      ellipsis={{ rows: 2 }}
                      style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}
                    >
                      "{worker.latestReview.comment}"
                    </Paragraph>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      <CalendarOutlined style={{ marginRight: 4 }} />
                      {worker.latestReview.period}
                    </Text>
                  </div>
                )}

                {worker.reviewCount === 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>Оценок пока нет</Text>
                )}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      {summaries.length === 0 && (
        <Empty description="Нет сотрудников" />
      )}

      {/* History modal */}
      <Modal
        open={drawerOpen}
        onCancel={() => setDrawerOpen(false)}
        footer={null}
        width={600}
        title={
          workerInModal
            ? <Space>
                <UserOutlined />
                <span>{workerInModal.fullName}</span>
                <Tag color={ROLE_COLORS[workerInModal.role] ?? 'default'} style={{ fontSize: 11 }}>
                  {ROLE_LABELS[workerInModal.role] ?? workerInModal.role}
                </Tag>
              </Space>
            : 'История оценок'
        }
      >
        {workerInModal && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16,
              background: 'var(--color-bg-elevated)', borderRadius: 10,
              padding: '12px 16px', marginBottom: 20,
            }}>
              <StarDisplay value={workerInModal.avgRating} />
              <Divider type="vertical" />
              <Text type="secondary">
                {workerInModal.reviewCount} {workerInModal.reviewCount === 1 ? 'отзыв' : workerInModal.reviewCount < 5 ? 'отзыва' : 'отзывов'}
              </Text>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => { setDrawerOpen(false); openAddForm(workerInModal); }}
              >
                Добавить
              </Button>
            </div>

            {workerInModal.reviews.length === 0 && (
              <Empty description="Оценок пока нет" />
            )}

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {workerInModal.reviews.map((review) => (
                <Card
                  key={review.id}
                  size="small"
                  style={{ borderRadius: 10 }}
                  styles={{ body: { padding: '12px 16px' } }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Space direction="vertical" size={4} style={{ flex: 1 }}>
                      <Space align="center">
                        <Rate disabled value={review.rating} style={{ fontSize: 13 }} />
                        <Tag style={{ marginLeft: 4 }}>{review.period}</Tag>
                      </Space>
                      {review.comment && (
                        <Text style={{ fontSize: 13 }}>"{review.comment}"</Text>
                      )}
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {review.reviewer.fullName} · {dayjs(review.createdAt).format('DD.MM.YYYY HH:mm')}
                      </Text>
                    </Space>
                    <Space size={4}>
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => { setDrawerOpen(false); openEditForm(review, workerInModal); }}
                      />
                      <Popconfirm
                        title="Удалить оценку?"
                        onConfirm={() => deleteMutation.mutate(review.id)}
                        okText="Да"
                        cancelText="Нет"
                      >
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          loading={deleteMutation.isPending}
                        />
                      </Popconfirm>
                    </Space>
                  </div>
                </Card>
              ))}
            </Space>
          </>
        )}
      </Modal>

      {/* Add/Edit form modal */}
      <Modal
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditingReview(null); form.resetFields(); }}
        onOk={handleFormSubmit}
        okText={editingReview ? 'Сохранить' : 'Добавить'}
        cancelText="Отмена"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        title={
          editingReview
            ? `Редактировать оценку — ${selectedWorker?.fullName}`
            : `Новая оценка — ${selectedWorker?.fullName}`
        }
        width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editingReview && (
            <Form.Item name="period" label="Период" rules={[{ required: true, message: 'Выберите месяц' }]}>
              <DatePicker picker="month" format="YYYY-MM" style={{ width: '100%' }} />
            </Form.Item>
          )}

          <Form.Item name="rating" label="Оценка" rules={[{ required: true, message: 'Поставьте оценку' }]}>
            <Rate />
          </Form.Item>

          <Form.Item name="comment" label="Комментарий (необязательно)">
            <Input.TextArea
              rows={4}
              placeholder="Напишите отзыв о работе сотрудника..."
              maxLength={2000}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
