import { useState } from 'react';
import {
  Row, Col, Card, Rate, Typography, Button, Modal, Form,
  Input, DatePicker, Tag, Space, Empty, Popconfirm,
  Statistic, Divider, Tooltip, message, Spin,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  RiseOutlined, FallOutlined, MinusOutlined,
  TrophyOutlined, FireOutlined, ThunderboltOutlined,
  StarOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { Line } from '@ant-design/charts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme } from 'antd';
import dayjs from 'dayjs';
import { workerReviewsApi } from '../api/workerReviews.api';
import type { EnrichedWorkerSummary, WorkerReview, WorkerBadge } from '../types';

const { Title, Text, Paragraph } = Typography;
const { useToken } = theme;

// ─── helpers ────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Супер Админ', ADMIN: 'Администратор', MANAGER: 'Менеджер',
  OPERATOR: 'Оператор', HR: 'HR', ACCOUNTANT: 'Бухгалтер',
  WAREHOUSE: 'Склад', WAREHOUSE_MANAGER: 'Зав. склада',
  DRIVER: 'Водитель', LOADER: 'Грузчик', FOREIGN_TRADE: 'ВЭД',
};

const BADGE_META: Record<NonNullable<WorkerBadge>, { icon: React.ReactNode; label: string; color: string; glow: string }> = {
  leader:         { icon: <TrophyOutlined />,      label: 'Лидер',           color: '#faad14', glow: 'rgba(250,173,20,0.25)' },
  peak_today:     { icon: <FireOutlined />,         label: 'В пике сегодня',  color: '#ff4d4f', glow: 'rgba(255,77,79,0.2)'  },
  peak_yesterday: { icon: <StarOutlined />,         label: 'Пик вчера',       color: '#fa8c16', glow: 'rgba(250,140,22,0.2)' },
  rising:         { icon: <RiseOutlined />,         label: 'Растёт',          color: '#52c41a', glow: 'rgba(82,196,26,0.18)' },
  falling:        { icon: <FallOutlined />,         label: 'Снижение',        color: '#ff4d4f', glow: 'rgba(255,77,79,0.18)' },
  stable:         { icon: <ThunderboltOutlined />,  label: 'Стабильный',      color: '#1890ff', glow: 'rgba(24,144,255,0.18)'},
};

function ratingColor(v: number | null): string {
  if (v === null) return 'var(--color-text-secondary)';
  if (v >= 4.5) return '#52c41a';
  if (v >= 3.5) return '#1890ff';
  if (v >= 2.5) return '#faad14';
  return '#ff4d4f';
}

// Inline SVG sparkline
function Sparkline({ data }: { data: { rating: number }[] }) {
  if (data.length < 2) return <span style={{ fontSize: 11, opacity: 0.4 }}>нет данных</span>;
  const W = 80, H = 28;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((d.rating - 1) / 4) * H;
    return [x, y] as [number, number];
  });
  const pointsStr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const isUp = data[data.length - 1].rating >= data[0].rating;
  const color = isUp ? '#52c41a' : '#ff4d4f';
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline points={pointsStr} fill="none" stroke={color} strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} />
    </svg>
  );
}

// Trend arrow
function TrendBadge({ trend, delta }: { trend: string | null; delta: number }) {
  if (!trend || trend === 'new') return <Tag style={{ fontSize: 11 }}>🆕 Новый</Tag>;
  if (trend === 'rising')  return <Tag color="success"  icon={<RiseOutlined />}  style={{ fontSize: 11 }}>+{delta}</Tag>;
  if (trend === 'falling') return <Tag color="error"    icon={<FallOutlined />}  style={{ fontSize: 11 }}>{delta}</Tag>;
  return                          <Tag color="blue"     icon={<MinusOutlined />} style={{ fontSize: 11 }}>Стабильный</Tag>;
}

// Rank medal
function RankMedal({ rank }: { rank: number | null }) {
  if (!rank) return null;
  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
  return (
    <span style={{ fontSize: rank <= 3 ? 18 : 13, fontWeight: 700,
      color: rank <= 3 ? undefined : 'var(--color-text-secondary)' }}>
      {medals[rank] ?? `#${rank}`}
    </span>
  );
}

// ─── Worker card ─────────────────────────────────────────────────────────────

function WorkerCard({
  worker,
  onAdd,
  onHistory,
}: {
  worker: EnrichedWorkerSummary;
  onAdd: (w: EnrichedWorkerSummary) => void;
  onHistory: (w: EnrichedWorkerSummary) => void;
}) {
  const badgeMeta = worker.badge ? BADGE_META[worker.badge] : null;
  const borderColor = badgeMeta?.color ?? 'var(--color-border)';
  const glowColor   = badgeMeta?.glow  ?? 'transparent';

  return (
    <Card
      hoverable
      style={{
        borderRadius: 14,
        border: `1.5px solid ${borderColor}`,
        boxShadow: `0 0 18px ${glowColor}`,
        height: '100%',
        transition: 'box-shadow 0.2s, transform 0.15s',
      }}
      styles={{ body: { padding: '16px 18px' } }}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Space size={8} align="start">
            <div style={{
              width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg, ${borderColor}33, ${borderColor}11)`,
              border: `1.5px solid ${borderColor}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <UserOutlined style={{ color: borderColor, fontSize: 16 }} />
            </div>
            <div>
              <Text strong style={{ fontSize: 13, display: 'block', lineHeight: 1.3 }}>
                {worker.fullName}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {ROLE_LABELS[worker.role] ?? worker.role}
              </Text>
            </div>
          </Space>
          <RankMedal rank={worker.rank} />
        </div>

        {/* Badge */}
        {badgeMeta && (
          <Tag
            icon={badgeMeta.icon}
            style={{
              background: `${badgeMeta.color}18`,
              border: `1px solid ${badgeMeta.color}55`,
              color: badgeMeta.color,
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              padding: '1px 8px',
            }}
          >
            {badgeMeta.label}
          </Tag>
        )}

        {/* Rating + sparkline */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--color-bg-elevated)', borderRadius: 10, padding: '8px 12px',
        }}>
          <div>
            {worker.avgRating !== null ? (
              <>
                <Text strong style={{ fontSize: 22, color: ratingColor(worker.avgRating), lineHeight: 1 }}>
                  {worker.avgRating.toFixed(1)}
                </Text>
                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                  из 5 · {worker.reviewCount} отз.
                </Text>
              </>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>Нет оценок</Text>
            )}
          </div>
          <Sparkline data={worker.sparkline} />
        </div>

        {/* Stars */}
        {worker.avgRating !== null && (
          <Rate disabled allowHalf value={worker.avgRating} style={{ fontSize: 12 }} />
        )}

        {/* Trend */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <TrendBadge trend={worker.trend} delta={worker.trendDelta} />
          {worker.latestReview && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {worker.latestReview.period}
            </Text>
          )}
        </div>

        {/* Latest comment */}
        {worker.latestReview?.comment && (
          <Paragraph
            ellipsis={{ rows: 2 }}
            style={{
              margin: 0, fontSize: 11,
              color: 'var(--color-text-secondary)',
              borderLeft: `2px solid ${borderColor}66`,
              paddingLeft: 8,
            }}
          >
            "{worker.latestReview.comment}"
          </Paragraph>
        )}

        <Divider style={{ margin: '4px 0' }} />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="small" type="primary" ghost icon={<PlusOutlined />}
            onClick={() => onAdd(worker)} style={{ flex: 1, fontSize: 11 }}>
            Оценить
          </Button>
          <Button size="small" icon={<EditOutlined />}
            onClick={() => onHistory(worker)} style={{ flex: 1, fontSize: 11 }}>
            История
          </Button>
        </div>
      </Space>
    </Card>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function WorkerAuditPage() {
  const { token } = useToken();
  const qc = useQueryClient();

  const [selectedWorker, setSelectedWorker] = useState<EnrichedWorkerSummary | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formOpen, setFormOpen]       = useState(false);
  const [editingReview, setEditingReview] = useState<WorkerReview | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['worker-reviews', 'analytics'],
    queryFn: workerReviewsApi.getAnalytics,
  });

  const createMutation = useMutation({
    mutationFn: workerReviewsApi.create,
    onSuccess: () => {
      message.success('Оценка добавлена');
      qc.invalidateQueries({ queryKey: ['worker-reviews'] });
      setFormOpen(false); setEditingReview(null); form.resetFields();
    },
    onError: () => message.error('Ошибка при сохранении'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { rating?: number; comment?: string } }) =>
      workerReviewsApi.update(id, payload),
    onSuccess: () => {
      message.success('Оценка обновлена');
      qc.invalidateQueries({ queryKey: ['worker-reviews'] });
      setFormOpen(false); setEditingReview(null); form.resetFields();
    },
    onError: () => message.error('Ошибка при обновлении'),
  });

  const deleteMutation = useMutation({
    mutationFn: workerReviewsApi.delete,
    onSuccess: () => {
      message.success('Удалено');
      qc.invalidateQueries({ queryKey: ['worker-reviews'] });
    },
  });

  function openAdd(worker: EnrichedWorkerSummary) {
    setEditingReview(null);
    setSelectedWorker(worker);
    form.setFieldsValue({ period: dayjs(), rating: 3, comment: '' });
    setFormOpen(true);
  }

  function openEdit(review: WorkerReview, worker: EnrichedWorkerSummary) {
    setEditingReview(review);
    setSelectedWorker(worker);
    form.setFieldsValue({
      rating: review.rating,
      comment: review.comment ?? '',
      period: dayjs(review.period, 'YYYY-MM-DD'),
    });
    setFormOpen(true);
  }

  function openHistory(worker: EnrichedWorkerSummary) {
    setSelectedWorker(worker);
    setHistoryOpen(true);
  }

  function handleSubmit() {
    form.validateFields().then((vals) => {
      const period = (vals.period as dayjs.Dayjs).format('YYYY-MM-DD');
      if (editingReview) {
        updateMutation.mutate({ id: editingReview.id, payload: { rating: vals.rating, comment: vals.comment || undefined } });
      } else {
        createMutation.mutate({ managerId: selectedWorker!.id, rating: vals.rating, comment: vals.comment || undefined, period });
      }
    });
  }

  // Sync selectedWorker with fresh analytics data
  const workerInModal = selectedWorker
    ? (data?.workers.find(w => w.id === selectedWorker.id) ?? selectedWorker)
    : null;

  if (isLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  const workers  = data?.workers  ?? [];
  const chartData = data?.chartData ?? [];

  // Top 3 for podium
  const podium = [...workers]
    .filter(w => w.rank !== null && w.rank <= 3)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  return (
    <div style={{ padding: '24px 0' }}>
      {/* ── Page title ── */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>Аудит сотрудников</Title>
        <Text type="secondary">Оценки, динамика и аналитика команды</Text>
      </div>

      {/* ── Top stats ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {[
          {
            title: 'Средний рейтинг',
            value: data?.teamAvg ?? 0,
            prefix: <StarOutlined style={{ color: '#faad14' }} />,
            suffix: '/ 5',
            precision: 1,
          },
          {
            title: 'Лидер команды',
            value: data?.topWorker?.fullName ?? '—',
            prefix: <TrophyOutlined style={{ color: '#faad14' }} />,
          },
          {
            title: 'Всего оценок',
            value: data?.totalReviews ?? 0,
            prefix: <StarOutlined style={{ color: token.colorPrimary }} />,
          },
          {
            title: 'Сотрудников',
            value: workers.length,
            prefix: <TeamOutlined style={{ color: token.colorPrimary }} />,
          },
        ].map((s) => (
          <Col key={s.title} xs={12} sm={6}>
            <Card style={{ borderRadius: 12 }} styles={{ body: { padding: '14px 18px' } }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 12 }}>{s.title}</Text>}
                value={s.value}
                prefix={s.prefix}
                suffix={s.suffix}
                precision={(s as { precision?: number }).precision}
                valueStyle={{ fontSize: 20, fontWeight: 700 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── Podium top-3 ── */}
      {podium.length > 0 && (
        <>
          <Title level={5} style={{ marginBottom: 12 }}>🏆 Топ сотрудники</Title>
          <Row gutter={[12, 12]} style={{ marginBottom: 28 }}>
            {podium.map((w) => {
              const badgeMeta = w.badge ? BADGE_META[w.badge] : null;
              const medals: Record<number, { emoji: string; bg: string; border: string }> = {
                1: { emoji: '🥇', bg: 'linear-gradient(135deg,#fffbe6,#fff7cc)', border: '#faad14' },
                2: { emoji: '🥈', bg: 'linear-gradient(135deg,#f5f5f5,#e8e8e8)', border: '#8c8c8c' },
                3: { emoji: '🥉', bg: 'linear-gradient(135deg,#fff2e8,#ffe7ba)', border: '#fa8c16' },
              };
              const medal = medals[w.rank!];
              return (
                <Col key={w.id} xs={24} sm={8}>
                  <Card
                    style={{
                      borderRadius: 14, textAlign: 'center',
                      background: medal.bg,
                      border: `2px solid ${medal.border}44`,
                    }}
                    styles={{ body: { padding: '16px 12px' } }}
                  >
                    <div style={{ fontSize: 32, lineHeight: 1 }}>{medal.emoji}</div>
                    <Text strong style={{ display: 'block', marginTop: 6, fontSize: 14 }}>
                      {w.fullName}
                    </Text>
                    <div style={{ margin: '6px 0' }}>
                      <Rate disabled allowHalf value={w.avgRating ?? 0} style={{ fontSize: 13 }} />
                    </div>
                    <Text style={{ fontSize: 20, fontWeight: 800, color: ratingColor(w.avgRating) }}>
                      {w.avgRating?.toFixed(1) ?? '—'}
                    </Text>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                      {w.reviewCount} отзывов
                    </Text>
                    {badgeMeta && (
                      <Tag style={{
                        marginTop: 6, fontSize: 10,
                        background: `${badgeMeta.color}18`,
                        border: `1px solid ${badgeMeta.color}55`,
                        color: badgeMeta.color,
                        borderRadius: 20,
                      }}>
                        {badgeMeta.icon} {badgeMeta.label}
                      </Tag>
                    )}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </>
      )}

      {/* ── Worker cards ── */}
      <Title level={5} style={{ marginBottom: 12 }}>Все сотрудники</Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
        {workers.map((worker) => (
          <Col key={worker.id} xs={24} sm={12} md={8} xl={6}>
            <WorkerCard worker={worker} onAdd={openAdd} onHistory={openHistory} />
          </Col>
        ))}
        {workers.length === 0 && (
          <Col span={24}><Empty description="Нет сотрудников" /></Col>
        )}
      </Row>

      {/* ── Trend line chart ── */}
      {chartData.length > 0 && (
        <Card
          title={<Text strong>Динамика рейтингов по дням</Text>}
          style={{ borderRadius: 14, marginBottom: 24 }}
          styles={{ body: { padding: '16px 20px' } }}
        >
          <Line
            data={chartData}
            xField="date"
            yField="rating"
            seriesField="worker"
            height={280}
            shapeField="smooth"
            legend={{ position: 'top' }}
            axis={{
              y: {
                min: 1, max: 5,
                labelFormatter: (v: number) => `★${v}`,
                labelFill: token.colorTextSecondary,
                grid: true,
                gridStroke: token.colorBorderSecondary,
                gridLineDash: [4, 4],
              },
              x: {
                labelFill: token.colorTextSecondary,
              },
            }}
            style={{ lineWidth: 2 }}
            point={{ size: 4, shape: 'circle' }}
          />
        </Card>
      )}

      {chartData.length === 0 && workers.length > 0 && (
        <Card style={{ borderRadius: 14, textAlign: 'center', padding: 32 }}>
          <Empty description="График появится после добавления оценок" />
        </Card>
      )}

      {/* ── History modal ── */}
      <Modal
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={580}
        title={
          workerInModal
            ? <Space>
                <UserOutlined />
                <span>{workerInModal.fullName}</span>
                {workerInModal.rank && <RankMedal rank={workerInModal.rank} />}
              </Space>
            : 'История оценок'
        }
      >
        {workerInModal && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              background: 'var(--color-bg-elevated)', borderRadius: 10,
              padding: '12px 16px', marginBottom: 20,
            }}>
              {workerInModal.avgRating !== null && (
                <>
                  <Text strong style={{ fontSize: 24, color: ratingColor(workerInModal.avgRating) }}>
                    {workerInModal.avgRating.toFixed(1)}
                  </Text>
                  <Rate disabled allowHalf value={workerInModal.avgRating} style={{ fontSize: 14 }} />
                  <Divider type="vertical" />
                </>
              )}
              <Text type="secondary">{workerInModal.reviewCount} отзывов</Text>
              <Sparkline data={workerInModal.sparkline} />
              <Button type="primary" size="small" icon={<PlusOutlined />}
                onClick={() => { setHistoryOpen(false); openAdd(workerInModal as EnrichedWorkerSummary); }}>
                Добавить
              </Button>
            </div>

            {workerInModal.reviews.length === 0 && <Empty description="Оценок пока нет" />}

            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {workerInModal.reviews.map((review) => (
                <Card key={review.id} size="small" style={{ borderRadius: 10 }}
                  styles={{ body: { padding: '10px 14px' } }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Space direction="vertical" size={3} style={{ flex: 1 }}>
                      <Space align="center">
                        <Rate disabled value={review.rating} style={{ fontSize: 12 }} />
                        <Tag style={{ fontSize: 11 }}>{review.period}</Tag>
                      </Space>
                      {review.comment && (
                        <Text style={{ fontSize: 12 }}>"{review.comment}"</Text>
                      )}
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {review.reviewer.fullName} · {dayjs(review.createdAt).format('DD.MM.YYYY HH:mm')}
                      </Text>
                    </Space>
                    <Space size={2}>
                      <Tooltip title="Редактировать">
                        <Button type="text" size="small" icon={<EditOutlined />}
                          onClick={() => { setHistoryOpen(false); openEdit(review, workerInModal as EnrichedWorkerSummary); }} />
                      </Tooltip>
                      <Popconfirm title="Удалить оценку?" onConfirm={() => deleteMutation.mutate(review.id)}
                        okText="Да" cancelText="Нет">
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                          loading={deleteMutation.isPending} />
                      </Popconfirm>
                    </Space>
                  </div>
                </Card>
              ))}
            </Space>
          </>
        )}
      </Modal>

      {/* ── Add/Edit form modal ── */}
      <Modal
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditingReview(null); form.resetFields(); }}
        onOk={handleSubmit}
        okText={editingReview ? 'Сохранить' : 'Добавить'}
        cancelText="Отмена"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        title={editingReview
          ? `Редактировать — ${selectedWorker?.fullName}`
          : `Новая оценка — ${selectedWorker?.fullName}`}
        width={420}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editingReview && (
            <Form.Item name="period" label="Дата" rules={[{ required: true, message: 'Выберите дату' }]}>
              <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item name="rating" label="Оценка" rules={[{ required: true, message: 'Поставьте оценку' }]}>
            <Rate />
          </Form.Item>
          <Form.Item name="comment" label="Комментарий (необязательно)">
            <Input.TextArea rows={4} placeholder="Напишите отзыв..." maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
