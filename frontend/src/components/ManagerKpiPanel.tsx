import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Progress, Drawer, Row, Col, Statistic, Typography, Spin,
  DatePicker, Button, Modal, Form, InputNumber, message, Tooltip, Empty, Space,
} from 'antd';
import { EditOutlined, InfoCircleOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { formatUZS } from '../utils/currency';
import { getFirstName } from '../lib/name-utils';
import type { ManagerKpiRow } from '../types';

const { Text, Paragraph } = Typography;

/** Те же числа, что на странице «Посещаемость»: начало 09:00, допуск 15 минут. */
const WORK_START_LABEL = '09:00';
const GRACE_LABEL = '15 мин';

function planColor(percent: number | null): string {
  if (percent === null) return '#8c8c8c';
  if (percent >= 1) return '#52c41a';
  if (percent >= 0.7) return '#faad14';
  return '#ff4d4f';
}

function fmtMinutes(total: number): string {
  if (total <= 0) return '0 мин';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

export default function ManagerKpiPanel() {
  const user = useAuthStore((s) => s.user);
  const canEditPlan = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const queryClient = useQueryClient();

  const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'));
  const [detail, setDetail] = useState<ManagerKpiRow | null>(null);
  const [planFor, setPlanFor] = useState<ManagerKpiRow | null>(null);
  const [planForm] = Form.useForm();

  const year = month.year();
  const monthNum = month.month() + 1;

  const { data, isLoading } = useQuery({
    queryKey: ['manager-kpi', year, monthNum],
    queryFn: () => analyticsApi.getManagerKpi(year, monthNum),
    staleTime: 120_000,
  });

  const savePlan = useMutation({
    mutationFn: (v: { userId: string; revenueTarget: number | null; dealsTarget: number | null; callNotesTarget: number | null }) =>
      usersApi.upsertMonthlyGoal(v.userId, {
        year,
        month: monthNum,
        revenueTarget: v.revenueTarget,
        dealsTarget: v.dealsTarget,
        callNotesTarget: v.callNotesTarget,
      }),
    onSuccess: () => {
      message.success('План сохранён');
      setPlanFor(null);
      queryClient.invalidateQueries({ queryKey: ['manager-kpi'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Не удалось сохранить план');
    },
  });

  const rows = data?.rows ?? [];

  const totals = useMemo(() => {
    const target = rows.reduce((s, r) => s + (r.plan.revenueTarget ?? 0), 0);
    const fact = rows.reduce((s, r) => s + r.plan.revenueFact, 0);
    return {
      target,
      fact,
      percent: target > 0 ? fact / target : null,
      withoutPlan: rows.filter((r) => r.plan.revenueTarget === null).length,
    };
  }, [rows]);

  function openPlan(row: ManagerKpiRow) {
    setPlanFor(row);
    planForm.setFieldsValue({
      revenueTarget: row.plan.revenueTarget ?? undefined,
      dealsTarget: row.plan.dealsTarget ?? undefined,
      callNotesTarget: row.plan.callNotesTarget ?? undefined,
    });
  }

  const columns = [
    {
      title: 'Менеджер',
      dataIndex: 'fullName',
      key: 'fullName',
      fixed: 'left' as const,
      width: 170,
      render: (v: string, r: ManagerKpiRow) => (
        <div>
          <div>{getFirstName(v) || v}</div>
          {r.department && <Text type="secondary" style={{ fontSize: 11 }}>{r.department}</Text>}
        </div>
      ),
    },
    {
      title: 'План',
      key: 'plan',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, r: ManagerKpiRow) =>
        r.plan.revenueTarget === null
          ? <Text type="secondary">не задан</Text>
          : formatUZS(r.plan.revenueTarget),
    },
    {
      title: 'Факт',
      key: 'fact',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, r: ManagerKpiRow) => formatUZS(r.plan.revenueFact),
      sorter: (a: ManagerKpiRow, b: ManagerKpiRow) => a.plan.revenueFact - b.plan.revenueFact,
      defaultSortOrder: 'descend' as const,
    },
    {
      title: 'Выполнение',
      key: 'percent',
      width: 160,
      render: (_: unknown, r: ManagerKpiRow) =>
        r.plan.revenuePercent === null ? (
          <Text type="secondary">—</Text>
        ) : (
          <Progress
            percent={Math.min(Math.round(r.plan.revenuePercent * 100), 999)}
            size="small"
            strokeColor={planColor(r.plan.revenuePercent)}
            format={(p) => `${p}%`}
          />
        ),
      sorter: (a: ManagerKpiRow, b: ManagerKpiRow) =>
        (a.plan.revenuePercent ?? -1) - (b.plan.revenuePercent ?? -1),
    },
    {
      title: 'Клиенты',
      key: 'clients',
      width: 150,
      render: (_: unknown, r: ManagerKpiRow) => (
        <Tooltip title={`Новых ${r.clients.new} · вернувшихся ${r.clients.returned} · постоянных ${r.clients.regular}`}>
          <span>
            {r.clients.served}
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
              +{r.clients.new} / ↩{r.clients.returned}
            </Text>
          </span>
        </Tooltip>
      ),
      sorter: (a: ManagerKpiRow, b: ManagerKpiRow) => a.clients.served - b.clients.served,
    },
    {
      title: 'Контакты',
      key: 'contacts',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, r: ManagerKpiRow) => (
        <Tooltip title={`Заметки в карточке ${r.contacts.clientNotes} · доска звонков ${r.contacts.boardCalls}`}>
          <span>{r.contacts.total}</span>
        </Tooltip>
      ),
      sorter: (a: ManagerKpiRow, b: ManagerKpiRow) => a.contacts.total - b.contacts.total,
    },
    {
      title: 'Мёртвые',
      key: 'dead',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, r: ManagerKpiRow) =>
        r.assortment.deadSold.count > 0
          ? <Tag color="green">{r.assortment.deadSold.count}</Tag>
          : <Text type="secondary">—</Text>,
      sorter: (a: ManagerKpiRow, b: ManagerKpiRow) =>
        a.assortment.deadSold.count - b.assortment.deadSold.count,
    },
    {
      title: 'Опоздания',
      key: 'late',
      width: 130,
      align: 'right' as const,
      render: (_: unknown, r: ManagerKpiRow) =>
        r.attendance.late === 0 ? (
          <Text type="secondary">—</Text>
        ) : (
          <Tooltip title={`Суммарно ${fmtMinutes(r.attendance.lateMinutes)}`}>
            <Text style={{ color: '#ff4d4f' }}>{r.attendance.late} дн.</Text>
          </Tooltip>
        ),
      sorter: (a: ManagerKpiRow, b: ManagerKpiRow) => a.attendance.lateMinutes - b.attendance.lateMinutes,
    },
    ...(canEditPlan
      ? [{
          title: '',
          key: 'edit',
          width: 50,
          render: (_: unknown, r: ManagerKpiRow) => (
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={(e) => { e.stopPropagation(); openPlan(r); }}
            />
          ),
        }]
      : []),
  ];

  return (
    <>
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={(
          <span>
            KPI менеджеров
            <Tooltip title={`Период — календарный месяц. Рабочий день начинается в ${WORK_START_LABEL}, допуск ${GRACE_LABEL}; при опоздании допуск сгорает и минуты считаются от ${WORK_START_LABEL}.`}>
              <InfoCircleOutlined style={{ marginLeft: 8, fontSize: 13, opacity: 0.55 }} />
            </Tooltip>
          </span>
        )}
        extra={(
          <DatePicker
            picker="month"
            value={month}
            onChange={(v) => v && setMonth(v.startOf('month'))}
            allowClear={false}
            format="MMMM YYYY"
          />
        )}
      >
        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={12} md={6}>
            <Statistic title="План отдела" value={totals.target} formatter={(v) => formatUZS(Number(v))} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="Факт" value={totals.fact} formatter={(v) => formatUZS(Number(v))} valueStyle={{ color: '#1677ff' }} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="Выполнение"
              value={totals.percent === null ? '—' : `${Math.round(totals.percent * 100)}%`}
              valueStyle={{ color: planColor(totals.percent) }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="Без плана"
              value={totals.withoutPlan}
              suffix={`из ${rows.length}`}
              valueStyle={{ color: totals.withoutPlan > 0 ? '#faad14' : undefined }}
            />
          </Col>
        </Row>

        {isLoading ? (
          <Spin style={{ display: 'block', margin: '40px auto' }} />
        ) : (
          <Table
            dataSource={rows}
            columns={columns}
            rowKey="managerId"
            size="small"
            pagination={false}
            scroll={{ x: 1100 }}
            onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: 'pointer' } })}
            locale={{ emptyText: 'Нет менеджеров за этот месяц' }}
          />
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          Нажмите на строку — подробности по ассортименту, контактам, клиентам и посещаемости.
        </Text>
      </Card>

      <Drawer
        title={detail ? `${detail.fullName} — ${month.format('MMMM YYYY')}` : ''}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={720}
      >
        {detail && (
          <>
            <Card size="small" title="1. План продаж" style={{ marginBottom: 12 }}>
              <Row gutter={[12, 12]}>
                <Col span={8}><Statistic title="План" value={detail.plan.revenueTarget ?? 0} formatter={(v) => detail.plan.revenueTarget === null ? '—' : formatUZS(Number(v))} /></Col>
                <Col span={8}><Statistic title="Факт" value={detail.plan.revenueFact} formatter={(v) => formatUZS(Number(v))} /></Col>
                <Col span={8}>
                  <Statistic
                    title="Выполнение"
                    value={detail.plan.revenuePercent === null ? '—' : `${Math.round(detail.plan.revenuePercent * 100)}%`}
                    valueStyle={{ color: planColor(detail.plan.revenuePercent) }}
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">Сделок: </Text>
                  <Text strong>{detail.plan.dealsFact}</Text>
                  {detail.plan.dealsTarget !== null && <Text type="secondary"> из {detail.plan.dealsTarget}</Text>}
                </Col>
                <Col span={12}>
                  <Text type="secondary">Контактов: </Text>
                  <Text strong>{detail.contacts.total}</Text>
                  {detail.plan.callNotesTarget !== null && <Text type="secondary"> из {detail.plan.callNotesTarget}</Text>}
                </Col>
              </Row>
              {canEditPlan && (
                <Button size="small" icon={<EditOutlined />} style={{ marginTop: 10 }} onClick={() => openPlan(detail)}>
                  Изменить план
                </Button>
              )}
            </Card>

            <Card size="small" title="2. Ассортимент" style={{ marginBottom: 12 }}>
              <Space size="large" wrap style={{ marginBottom: 10 }}>
                <span><Text type="secondary">Позиций: </Text><Text strong>{detail.assortment.positions}</Text></span>
                <span><Text type="secondary">Продано всего: </Text><Text strong>{detail.assortment.totalQty.toLocaleString('ru-RU')}</Text></span>
              </Space>
              {detail.assortment.topProducts.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Продаж нет" />
              ) : (
                <Table
                  size="small"
                  pagination={false}
                  dataSource={detail.assortment.topProducts}
                  rowKey="productId"
                  columns={[
                    { title: 'Товар', dataIndex: 'name', ellipsis: true },
                    { title: 'Кол-во', dataIndex: 'qty', width: 110, align: 'right' as const, render: (v: number, r: { unit: string }) => `${v.toLocaleString('ru-RU')} ${r.unit}` },
                    { title: 'Выручка', dataIndex: 'revenue', width: 130, align: 'right' as const, render: (v: number) => formatUZS(v) },
                  ]}
                />
              )}
              <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 10, marginBottom: 6 }}>
                По категориям: {detail.assortment.byCategory.length === 0 ? '—' : detail.assortment.byCategory
                  .map((c) => `${c.category} — ${formatUZS(c.revenue)}`).join(' · ')}
              </Paragraph>
              <div style={{ marginTop: 8 }}>
                <Text strong>Оживил мёртвые товары: </Text>
                {detail.assortment.deadSold.count === 0 ? (
                  <Text type="secondary">нет</Text>
                ) : (
                  <>
                    <Tag color="green">{detail.assortment.deadSold.count} поз.</Tag>
                    <Text type="secondary">
                      {detail.assortment.deadSold.qty.toLocaleString('ru-RU')} ед. на {formatUZS(detail.assortment.deadSold.revenue)}
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      {detail.assortment.deadSold.products.map((p) => (
                        <Tag key={p.productId} style={{ marginBottom: 4 }}>{p.name} — {p.qty.toLocaleString('ru-RU')}</Tag>
                      ))}
                    </div>
                  </>
                )}
                <Tooltip title="Товары, которые до начала этого месяца не продавались 90+ дней.">
                  <InfoCircleOutlined style={{ marginLeft: 6, fontSize: 12, opacity: 0.5 }} />
                </Tooltip>
              </div>
            </Card>

            <Card size="small" title="3. Звонки и контакты" style={{ marginBottom: 12 }}>
              <Row gutter={[12, 12]}>
                <Col span={6}><Statistic title="Всего" value={detail.contacts.total} /></Col>
                <Col span={6}><Statistic title="Заметки клиента" value={detail.contacts.clientNotes} /></Col>
                <Col span={6}><Statistic title="Доска звонков" value={detail.contacts.boardCalls} /></Col>
                <Col span={6}><Statistic title="Клиентов" value={detail.contacts.uniqueClients} /></Col>
              </Row>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Последний контакт: {detail.contacts.lastContactAt
                  ? dayjs(detail.contacts.lastContactAt).format('DD.MM.YYYY HH:mm')
                  : '—'}
              </Text>
            </Card>

            <Card size="small" title="4. Привлечение клиентов" style={{ marginBottom: 12 }}>
              <Row gutter={[12, 12]}>
                <Col span={6}><Statistic title="Обслужено" value={detail.clients.served} /></Col>
                <Col span={6}><Statistic title="Новых" value={detail.clients.new} valueStyle={{ color: '#52c41a' }} /></Col>
                <Col span={6}><Statistic title="Вернувшихся" value={detail.clients.returned} valueStyle={{ color: '#1677ff' }} /></Col>
                <Col span={6}><Statistic title="Постоянных" value={detail.clients.regular} /></Col>
              </Row>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Вернувшийся — покупал раньше, но перед этой покупкой был перерыв 30+ дней.
              </Text>
            </Card>

            <Card size="small" title="5. Посещаемость">
              <Row gutter={[12, 12]}>
                <Col span={6}><Statistic title="Дней с отметкой" value={detail.attendance.days} /></Col>
                <Col span={6}><Statistic title="Вовремя" value={detail.attendance.onTime} valueStyle={{ color: '#52c41a' }} /></Col>
                <Col span={6}><Statistic title="Опозданий" value={detail.attendance.late} valueStyle={{ color: detail.attendance.late > 0 ? '#ff4d4f' : undefined }} /></Col>
                <Col span={6}><Statistic title="Без отметки" value={detail.attendance.absent} /></Col>
              </Row>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Суммарное опоздание: <Text strong>{fmtMinutes(detail.attendance.lateMinutes)}</Text>.
                {' '}Допуск {GRACE_LABEL} сгорает целиком: приход в 9:16 — это 16 минут опоздания, а не одна.
              </Text>
            </Card>
          </>
        )}
      </Drawer>

      <Modal
        title={planFor ? `План на ${month.format('MMMM YYYY')} — ${planFor.fullName}` : ''}
        open={!!planFor}
        onCancel={() => setPlanFor(null)}
        onOk={() => planForm.submit()}
        confirmLoading={savePlan.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
      >
        <Form
          form={planForm}
          layout="vertical"
          onFinish={(v) => {
            if (!planFor) return;
            savePlan.mutate({
              userId: planFor.managerId,
              revenueTarget: v.revenueTarget ?? null,
              dealsTarget: v.dealsTarget ?? null,
              callNotesTarget: v.callNotesTarget ?? null,
            });
          }}
        >
          <Form.Item name="revenueTarget" label="План по выручке (сум)">
            <InputNumber style={{ width: '100%' }} min={0} step={1000000} />
          </Form.Item>
          <Form.Item name="dealsTarget" label="План по сделкам">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="callNotesTarget" label="План по контактам">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            План задаётся на выбранный месяц отдельно для каждого сотрудника.
          </Text>
        </Form>
      </Modal>
    </>
  );
}
