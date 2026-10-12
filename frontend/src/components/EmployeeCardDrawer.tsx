import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, Col, Collapse, Drawer, Empty, Input, Rate, Row, Space, Spin, Statistic, Table, Tag,
  Tooltip, Typography, message,
} from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, TagsOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { employeeCardsApi, type EmployeeReviewInput } from '../api/employeeCards.api';
import { analyticsApi } from '../api/analytics.api';
import { useAuthStore } from '../store/authStore';
import { getFirstName } from '../lib/name-utils';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import { ATTENDANCE_MARK_META, type AttendanceMark } from '../constants/attendanceMarks';
import { EMPLOYEE_ROLE_LABELS, REVIEW_CRITERIA } from '../constants/employeeCards';
import AttendanceMarkModal, { type AttendanceMarkTarget } from './AttendanceMarkModal';
import type { EmployeeCardHistoryPoint } from '../types';

const { Text } = Typography;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

interface Props {
  userId: string | null;
  year: number;
  month: number;
  onClose: () => void;
}

type ReviewForm = Omit<EmployeeReviewInput, 'year' | 'month'>;

const EMPTY_FORM: ReviewForm = {
  discipline: null, quality: null, initiative: null, teamwork: null, praise: '', remarks: '', improve: '',
};

function Trend({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur === null || prev === null || Math.abs(cur - prev) < 0.05) return null;
  return cur > prev
    ? <ArrowUpOutlined style={{ color: '#3f8600', marginLeft: 4 }} />
    : <ArrowDownOutlined style={{ color: '#cf1322', marginLeft: 4 }} />;
}

/** Карточка сотрудника за месяц: показатели из CRM, плашки посещаемости, оценка HR и история. */
export default function EmployeeCardDrawer({ userId, year, month, onClose }: Props) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [form, setForm] = useState<ReviewForm>(EMPTY_FORM);
  const [markTarget, setMarkTarget] = useState<AttendanceMarkTarget | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['employee-card', userId, year, month],
    queryFn: () => employeeCardsApi.get(userId!, year, month),
    enabled: !!userId,
  });

  const { data: scheme } = useQuery({
    queryKey: ['bonus-scheme'],
    queryFn: analyticsApi.getBonusScheme,
    enabled: !!userId && data?.card.group === 'sales',
    staleTime: 300_000,
  });

  useEffect(() => {
    const r = data?.card.review;
    setForm(r
      ? {
          discipline: r.discipline, quality: r.quality, initiative: r.initiative, teamwork: r.teamwork,
          praise: r.praise ?? '', remarks: r.remarks ?? '', improve: r.improve ?? '',
        }
      : EMPTY_FORM);
  }, [data]);

  const save = useMutation({
    mutationFn: () => employeeCardsApi.saveReview(userId!, { year, month, ...form }),
    onSuccess: () => {
      message.success('Оценка сохранена');
      queryClient.invalidateQueries({ queryKey: ['employee-cards'] });
      queryClient.invalidateQueries({ queryKey: ['employee-card'] });
      queryClient.invalidateQueries({ queryKey: ['manager-kpi'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Не удалось сохранить оценку');
    },
  });

  const card = data?.card;
  const isSelf = !!card && card.userId === me?.id;
  const monthLabel = dayjs(new Date(year, month - 1, 1)).format('MMMM YYYY');
  const hrWeight = scheme?.weights?.hrReview ?? 0;

  const historyColumns = [
    {
      title: 'Месяц',
      key: 'm',
      render: (_: unknown, h: EmployeeCardHistoryPoint) => `${MONTHS[h.month - 1]} ${h.year}`,
    },
    {
      title: 'Оценка HR',
      key: 'score',
      render: (_: unknown, h: EmployeeCardHistoryPoint, i: number) => {
        const prev = i > 0 ? data!.history[i - 1].reviewScore : null;
        return h.reviewScore !== null
          ? <span>{h.reviewScore}<Trend cur={h.reviewScore} prev={prev} /></span>
          : <Text type="secondary">—</Text>;
      },
    },
    {
      title: 'Вовремя',
      key: 'att',
      render: (_: unknown, h: EmployeeCardHistoryPoint) =>
        h.workdays ? `${Math.round((h.onTime / h.workdays) * 100)}%` : '—',
    },
    { title: 'Опоздания', dataIndex: 'late', key: 'late' },
    { title: 'Прогулы', dataIndex: 'absent', key: 'absent' },
    ...(card?.group === 'sales'
      ? [{
          title: 'План',
          key: 'plan',
          render: (_: unknown, h: EmployeeCardHistoryPoint) =>
            h.planPercent !== null ? `${Math.round(h.planPercent * 100)}%` : '—',
        }]
      : []),
    { title: 'Просрочено задач', dataIndex: 'overdueTasks', key: 'overdue' },
  ];

  return (
    <Drawer
      open={!!userId}
      onClose={onClose}
      width={isMobile ? '100%' : 760}
      title={card ? `${getFirstName(card.fullName) || card.fullName} — ${monthLabel}` : 'Карточка сотрудника'}
      extra={card && <Tag>{EMPLOYEE_ROLE_LABELS[card.role] ?? card.role}</Tag>}
      destroyOnHidden
    >
      {isLoading || !card ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* ── 1. Автоматически из CRM ── */}
          <Card size="small" title="Показатели из CRM">
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}>
                <Statistic title="Вовремя" value={card.attendance.onTime} suffix={`/ ${card.attendance.workdays}`} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="Опоздания"
                  value={card.attendance.late}
                  valueStyle={{ color: card.attendance.late ? '#cf1322' : undefined }}
                  suffix={card.attendance.lateMinutes ? <Text type="secondary" style={{ fontSize: 12 }}>{card.attendance.lateMinutes} мин</Text> : undefined}
                />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title="Прогулы" value={card.attendance.absent} valueStyle={{ color: card.attendance.absent ? '#cf1322' : undefined }} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="Задачи: сделано"
                  value={card.tasks.done}
                  suffix={`/ ${card.tasks.dueInMonth}`}
                />
                {card.tasks.overdueOpen > 0 && <Tag color="error">просрочено {card.tasks.overdueOpen}</Tag>}
              </Col>

              {card.sales && (
                <>
                  <Col xs={12} md={6}>
                    <Statistic
                      title="План по выручке"
                      value={card.sales.planPercent !== null ? Math.round(card.sales.planPercent * 100) : '—'}
                      suffix={card.sales.planPercent !== null ? '%' : undefined}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatUZS(card.sales.revenueFact)}
                      {card.sales.revenueTarget ? ` из ${formatUZS(card.sales.revenueTarget)}` : ''}
                    </Text>
                  </Col>
                  <Col xs={12} md={6}>
                    <Statistic title="Сделок" value={card.sales.deals} />
                  </Col>
                  <Col xs={12} md={6}>
                    <Statistic title="Контакты с клиентами" value={card.sales.contacts} />
                  </Col>
                  <Col xs={12} md={6}>
                    <Tooltip title={`AI-аудитов звонков за месяц: ${card.sales.callAudits}`}>
                      <Statistic
                        title="Оценка звонков"
                        value={card.sales.callScore ?? '—'}
                        suffix={card.sales.callScore !== null ? '/ 10' : undefined}
                      />
                    </Tooltip>
                  </Col>
                </>
              )}

              {card.operations && (
                <>
                  <Col xs={12} md={6}><Statistic title="Отгрузок" value={card.operations.shipments} /></Col>
                  <Col xs={12} md={6}><Statistic title="Погрузок" value={card.operations.loadings} /></Col>
                  <Col xs={12} md={6}><Statistic title="Доставок" value={card.operations.deliveries} /></Col>
                  <Col xs={12} md={6}><Statistic title="Подтвердил позиций" value={card.operations.itemsConfirmed} /></Col>
                </>
              )}

              <Col xs={12} md={6}>
                <Tooltip title="Сколько раз сотрудник что-то менял в CRM за месяц (без входов и выходов)">
                  <Statistic title="Действий в CRM" value={card.crmActions} />
                </Tooltip>
              </Col>
            </Row>
          </Card>

          {/* ── 2. Плашки посещаемости за месяц ── */}
          <Card
            size="small"
            title="Отметки посещаемости"
            extra={(
              <Button
                size="small"
                icon={<TagsOutlined />}
                onClick={() => setMarkTarget({ userId: card.userId, userName: getFirstName(card.fullName), date: dayjs() })}
              >
                Отметить
              </Button>
            )}
          >
            {data.attendanceDays.filter((d) => d.marks.length || d.note).length === 0 ? (
              <Text type="secondary">За месяц отметок HR нет</Text>
            ) : (
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {data.attendanceDays
                  .filter((d) => d.marks.length || d.note)
                  .map((d) => (
                    <div
                      key={d.id}
                      style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', cursor: 'pointer' }}
                      onClick={() => setMarkTarget({
                        userId: card.userId,
                        userName: getFirstName(card.fullName),
                        date: dayjs(d.date),
                        marks: d.marks,
                        note: d.note,
                      })}
                    >
                      <Text strong style={{ width: 52 }}>{dayjs(d.date).format('DD.MM')}</Text>
                      {d.marks.map((m) => {
                        const meta = ATTENDANCE_MARK_META[m as AttendanceMark];
                        return <Tag key={m} color={meta?.color}>{meta?.label ?? m}</Tag>;
                      })}
                      {d.note && <Text type="secondary">{d.note}</Text>}
                    </div>
                  ))}
              </Space>
            )}
          </Card>

          {/* ── 3. Оценка HR ── */}
          <Card size="small" title="Оценка HR">
            {isSelf ? (
              <Alert type="info" showIcon message="Свою карточку оценивает руководитель." />
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={[12, 8]}>
                  {REVIEW_CRITERIA.map((c) => (
                    <Col xs={24} md={12} key={c.key}>
                      <Tooltip title={c.hint}>
                        <Text style={{ display: 'inline-block', width: 130 }}>{c.label}</Text>
                      </Tooltip>
                      <Rate
                        value={form[c.key] ?? 0}
                        onChange={(v) => setForm((f) => ({ ...f, [c.key]: v || null }))}
                      />
                    </Col>
                  ))}
                </Row>
                <div>
                  <Text type="secondary">Похвала</Text>
                  <Input.TextArea
                    value={form.praise ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, praise: e.target.value }))}
                    placeholder="За что похвалить в этом месяце"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    maxLength={2000}
                  />
                </div>
                <div>
                  <Text type="secondary">Замечания</Text>
                  <Input.TextArea
                    value={form.remarks ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                    placeholder="Что было не так"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    maxLength={2000}
                  />
                </div>
                <div>
                  <Text type="secondary">Что улучшить в следующем месяце</Text>
                  <Input.TextArea
                    value={form.improve ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, improve: e.target.value }))}
                    placeholder="Конкретная цель на месяц"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    maxLength={2000}
                  />
                </div>
                <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {card.review
                      ? `Сохранено: ${getFirstName(card.review.reviewer.fullName)}, ${dayjs(card.review.updatedAt).format('DD.MM.YYYY HH:mm')}`
                      : 'Ещё не оценён за этот месяц'}
                  </Text>
                  <Button type="primary" loading={save.isPending} onClick={() => save.mutate()}>
                    Сохранить оценку
                  </Button>
                </Space>
                {card.group === 'sales' && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {hrWeight > 0
                      ? `Средний балл входит в премию менеджера с весом ${hrWeight}% (схема бонуса на странице KPI).`
                      : 'В премию оценка пока не входит: вес «Оценка HR» в схеме бонуса — 0%. Его задаёт админ на странице KPI.'}
                  </Text>
                )}
              </Space>
            )}
          </Card>

          {/* ── 4. История ── */}
          <Card size="small" title="История за полгода">
            <Table
              dataSource={data.history}
              columns={historyColumns}
              rowKey={(h) => `${h.year}-${h.month}`}
              size="small"
              pagination={false}
              scroll={{ x: 560 }}
            />
          </Card>

          {data.legacyReviews.length > 0 && (
            <Collapse
              size="small"
              items={[{
                key: 'legacy',
                label: `Старые оценки «Аудита сотрудников» (${data.legacyReviews.length})`,
                children: data.legacyReviews.length ? (
                  <Space direction="vertical" size={4}>
                    {data.legacyReviews.map((r) => (
                      <Text key={r.id}>
                        {dayjs(r.period).format('DD.MM.YYYY')} · {r.rating}/5
                        {r.comment ? ` · ${r.comment}` : ''}
                        <Text type="secondary"> — {getFirstName(r.reviewer.fullName)}</Text>
                      </Text>
                    ))}
                  </Space>
                ) : <Empty />,
              }]}
            />
          )}
        </Space>
      )}

      <AttendanceMarkModal target={markTarget} onClose={() => setMarkTarget(null)} />
    </Drawer>
  );
}
