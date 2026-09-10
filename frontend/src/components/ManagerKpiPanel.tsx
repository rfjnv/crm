import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Progress, Drawer, Row, Col, Statistic, Typography, Spin,
  DatePicker, Button, Modal, Form, InputNumber, message, Tooltip, Empty, Space,
  Segmented,
} from 'antd';
import { EditOutlined, InfoCircleOutlined, SettingOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { formatUZS } from '../utils/currency';
import { getFirstName } from '../lib/name-utils';
import type { ManagerKpiRow } from '../types';
import ManagerBonusCard from './ManagerBonusCard';
import BonusSchemeModal from './BonusSchemeModal';

const { Text } = Typography;

/** Те же числа, что на странице «Посещаемость»: начало 09:00, допуск 15 минут. */
const WORK_START_LABEL = '09:00';
const GRACE_LABEL = '15 мин';

function planColor(percent: number | null): string {
  if (percent === null) return '#8c8c8c';
  if (percent >= 1) return '#52c41a';
  if (percent >= 0.7) return '#faad14';
  return '#ff4d4f';
}

/** Доля от целого; при нулевом знаменателе — прочерк. */
function pct(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 1000) / 10}%`;
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
  /** Числа или доли — переключатель в шапке карточки деталей. */
  const [unit, setUnit] = useState<'abs' | 'pct'>('abs');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [planForm] = Form.useForm();

  const year = month.year();
  const monthNum = month.month() + 1;

  const { data, isLoading } = useQuery({
    queryKey: ['manager-kpi', year, monthNum],
    queryFn: () => analyticsApi.getManagerKpi(year, monthNum),
    staleTime: 120_000,
  });

  const savePlan = useMutation({
    // Планы по сделкам и контактам здесь не трогаем: их не присылаем совсем,
    // иначе сохранение оклада обнулило бы то, что задали на странице «Команда».
    mutationFn: (v: { userId: string; revenueTarget: number | null; fixedSalary: number | null }) =>
      usersApi.upsertMonthlyGoal(v.userId, {
        year,
        month: monthNum,
        revenueTarget: v.revenueTarget,
        fixedSalary: v.fixedSalary,
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

  // Карточка держит копию строки, а не ссылку на свежие данные: после правки
  // плана или оклада она осталась бы со старыми числами, пока её не закроют.
  useEffect(() => {
    if (!detail) return;
    const fresh = rows.find((r) => r.managerId === detail.managerId);
    if (fresh && fresh !== detail) setDetail(fresh);
  }, [rows, detail]);

  const totals = useMemo(() => {
    const target = rows.reduce((s, r) => s + (r.plan.revenueTarget ?? 0), 0);
    const fact = rows.reduce((s, r) => s + r.plan.revenueFact, 0);
    return {
      target,
      fact,
      percent: target > 0 ? fact / target : null,
      withoutPlan: rows.filter((r) => r.plan.revenueTarget === null).length,
      bonus: rows.reduce((s, r) => s + r.bonus.amount, 0),
      payout: rows.reduce((s, r) => s + r.salary.total, 0),
    };
  }, [rows]);

  function openPlan(row: ManagerKpiRow) {
    setPlanFor(row);
    planForm.setFieldsValue({
      revenueTarget: row.plan.revenueTarget ?? undefined,
      // Если оклад перенесён с прошлого месяца, подставляем его же: сохранение
      // закрепит сумму за этим месяцем.
      fixedSalary: row.salary.fixed ?? undefined,
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
      title: 'Бонус',
      key: 'bonus',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, r: ManagerKpiRow) =>
        r.bonus.amount > 0 ? (
          <Tooltip title={`База ${formatUZS(r.bonus.base)} (ставка ${r.bonus.rate}% от факта) × критерии ${Math.round(r.bonus.score * 100)}%`}>
            <div>
              <div>{formatUZS(r.bonus.amount)}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {`${String(r.bonus.rate).replace('.', ',')}% · ${Math.round(r.bonus.score * 100)}%`}
              </Text>
            </div>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
      sorter: (a: ManagerKpiRow, b: ManagerKpiRow) => a.bonus.amount - b.bonus.amount,
    },
    {
      title: 'К выплате',
      key: 'payout',
      width: 160,
      align: 'right' as const,
      render: (_: unknown, r: ManagerKpiRow) =>
        r.salary.fixed === null && r.salary.bonus === 0 ? (
          <Text type="secondary">—</Text>
        ) : (
          <Tooltip title={r.salary.fixed === null
            ? 'Оклад не задан — показан один бонус'
            : `Оклад ${formatUZS(r.salary.fixed)} + бонус ${formatUZS(r.salary.bonus)}`}>
            <div>
              <div><Text strong>{formatUZS(r.salary.total)}</Text></div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {r.salary.fixed === null ? 'без оклада' : `оклад ${formatUZS(r.salary.fixed)}`}
              </Text>
            </div>
          </Tooltip>
        ),
      sorter: (a: ManagerKpiRow, b: ManagerKpiRow) => a.salary.total - b.salary.total,
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
      title: 'Лиды',
      key: 'leads',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, r: ManagerKpiRow) =>
        r.leads.contacted === 0 ? (
          <Text type="secondary">—</Text>
        ) : (
          <Tooltip title={`${r.leads.converted} из ${r.leads.contacted} холодных контактов купили`}>
            <span>{`${r.leads.converted}/${r.leads.contacted}`}</span>
          </Tooltip>
        ),
      sorter: (a: ManagerKpiRow, b: ManagerKpiRow) => a.leads.converted - b.leads.converted,
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
          <Space size={8}>
            <DatePicker
              picker="month"
              value={month}
              onChange={(v) => v && setMonth(v.startOf('month'))}
              allowClear={false}
              format="MMMM YYYY"
            />
            {canEditPlan && (
              <Tooltip title="Настроить расчёт бонуса: веса критериев, ступени ставки, цели">
                <Button icon={<SettingOutlined />} onClick={() => setSchemeOpen(true)} />
              </Tooltip>
            )}
          </Space>
        )}
      >
        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={12} md={8} lg={4}>
            <Statistic title="План отдела" value={totals.target} formatter={(v) => formatUZS(Number(v))} valueStyle={{ fontSize: 18 }} />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic title="Факт" value={totals.fact} formatter={(v) => formatUZS(Number(v))} valueStyle={{ fontSize: 18, color: '#1677ff' }} />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title="Выполнение"
              value={totals.percent === null ? '—' : `${Math.round(totals.percent * 100)}%`}
              valueStyle={{ fontSize: 18, color: planColor(totals.percent) }}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title="Без плана"
              value={totals.withoutPlan}
              suffix={`из ${rows.length}`}
              valueStyle={{ fontSize: 18, color: totals.withoutPlan > 0 ? '#faad14' : undefined }}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title="Бонусы к выплате"
              value={totals.bonus}
              formatter={(v) => formatUZS(Number(v))}
              valueStyle={{ fontSize: 18, color: '#52c41a' }}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title="Оклады + бонусы"
              value={totals.payout}
              formatter={(v) => formatUZS(Number(v))}
              valueStyle={{ fontSize: 18 }}
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
            scroll={{ x: 1420 }}
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
        extra={(
          <Segmented
            size="small"
            value={unit}
            onChange={(v) => setUnit(v as 'abs' | 'pct')}
            options={[
              { label: 'Числа', value: 'abs' },
              { label: 'Проценты', value: 'pct' },
            ]}
          />
        )}
      >
        {detail && (
          <>
            <ManagerBonusCard bonus={detail.bonus} salary={detail.salary} tiers={data?.scheme.tiers ?? []} />

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
              {detail.assortment.topGroups.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Продаж нет" />
              ) : (
                // Свёрнуто по «семье»: иначе весь топ занимает самоклейка разных форматов.
                // Стрелка слева раскрывает конкретные позиции внутри группы.
                <Table
                  size="small"
                  pagination={false}
                  dataSource={showAllGroups
                    ? detail.assortment.topGroups
                    : detail.assortment.topGroups.slice(0, 5)}
                  rowKey="family"
                  expandable={{
                    rowExpandable: (g) => g.products.length > 1,
                    expandedRowRender: (g) => (
                      <Table
                        size="small"
                        pagination={false}
                        showHeader={false}
                        dataSource={g.products}
                        rowKey="productId"
                        columns={[
                          { title: 'Товар', dataIndex: 'name', ellipsis: true },
                          { title: 'Кол-во', dataIndex: 'qty', width: 110, align: 'right' as const, render: (v: number, r: { unit: string }) => `${v.toLocaleString('ru-RU')} ${r.unit}` },
                          {
                            title: 'Выручка', dataIndex: 'revenue', width: 130, align: 'right' as const,
                            render: (v: number) => (unit === 'pct' ? pct(v, detail.plan.revenueFact) : formatUZS(v)),
                          },
                        ]}
                      />
                    ),
                  }}
                  columns={[
                    {
                      title: 'Товар', dataIndex: 'family', ellipsis: true,
                      render: (v: string, g: ManagerKpiRow['assortment']['topGroups'][number]) => (
                        <span>
                          {v}
                          {g.products.length > 1 && (
                            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                              {g.products.length} поз.
                            </Text>
                          )}
                        </span>
                      ),
                    },
                    { title: 'Кол-во', dataIndex: 'qty', width: 110, align: 'right' as const, render: (v: number) => v.toLocaleString('ru-RU') },
                    {
                      title: 'Выручка', dataIndex: 'revenue', width: 130, align: 'right' as const,
                      render: (v: number) => (unit === 'pct' ? pct(v, detail.plan.revenueFact) : formatUZS(v)),
                    },
                  ]}
                />
              )}
              {detail.assortment.topGroups.length > 5 && (
                <Button type="link" size="small" style={{ paddingLeft: 0 }}
                  onClick={() => setShowAllGroups((v) => !v)}>
                  {showAllGroups
                    ? 'Свернуть'
                    : `Показать все (${detail.assortment.topGroups.length})`}
                </Button>
              )}
              {/* Категорий бывает полтора десятка — таблицей с долей, а не строкой через точки. */}
              {detail.assortment.byCategory.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Text strong style={{ fontSize: 13 }}>По категориям</Text>
                  <Table
                    size="small"
                    pagination={false}
                    showHeader={false}
                    style={{ marginTop: 6 }}
                    dataSource={showAllCategories
                      ? detail.assortment.byCategory
                      : detail.assortment.byCategory.slice(0, 5)}
                    rowKey="category"
                    columns={[
                      { title: 'Категория', dataIndex: 'category', ellipsis: true },
                      {
                        title: 'Доля', key: 'share', width: 120,
                        render: (_: unknown, c: { revenue: number }) => (
                          <Progress
                            percent={detail.plan.revenueFact
                              ? Math.round((c.revenue / detail.plan.revenueFact) * 100)
                              : 0}
                            size="small"
                            strokeColor="#1677ff"
                          />
                        ),
                      },
                      {
                        title: 'Выручка', dataIndex: 'revenue', width: 130, align: 'right' as const,
                        render: (v: number) => (unit === 'pct' ? pct(v, detail.plan.revenueFact) : formatUZS(v)),
                      },
                    ]}
                  />
                  {detail.assortment.byCategory.length > 5 && (
                    <Button type="link" size="small" style={{ paddingLeft: 0 }}
                      onClick={() => setShowAllCategories((v) => !v)}>
                      {showAllCategories
                        ? 'Свернуть'
                        : `Показать все (${detail.assortment.byCategory.length})`}
                    </Button>
                  )}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <Space size={8} align="center" wrap>
                  <Text strong style={{ fontSize: 13 }}>Оживил мёртвые товары</Text>
                  <Tooltip title="Позиции, которые до начала этого месяца не продавались 90+ дней.">
                    <InfoCircleOutlined style={{ fontSize: 12, opacity: 0.5 }} />
                  </Tooltip>
                  {detail.assortment.deadSold.count === 0
                    ? <Text type="secondary">нет</Text>
                    : (
                      <>
                        <Tag color="green" style={{ margin: 0 }}>
                          {detail.assortment.deadSold.count} поз.
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          на {formatUZS(detail.assortment.deadSold.revenue)}
                        </Text>
                      </>
                    )}
                </Space>
                {detail.assortment.deadSold.count > 0 && (
                  <Table
                    size="small"
                    pagination={false}
                    showHeader={false}
                    style={{ marginTop: 6 }}
                    dataSource={detail.assortment.deadSold.products}
                    rowKey="productId"
                    columns={[
                      { title: 'Товар', dataIndex: 'name', ellipsis: true },
                      {
                        title: 'Кол-во', dataIndex: 'qty', width: 130, align: 'right' as const,
                        render: (v: number, r: { unit: string }) => `${v.toLocaleString('ru-RU')} ${r.unit}`,
                      },
                      {
                        title: 'Выручка', dataIndex: 'revenue', width: 130, align: 'right' as const,
                        render: (v: number) => (unit === 'pct' ? pct(v, detail.plan.revenueFact) : formatUZS(v)),
                      },
                    ]}
                  />
                )}
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
                <Col span={6}>
                  <Statistic
                    title="Новых"
                    value={unit === 'pct' ? pct(detail.clients.new, detail.clients.served) : detail.clients.new}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Вернувшихся"
                    value={unit === 'pct' ? pct(detail.clients.returned, detail.clients.served) : detail.clients.returned}
                    valueStyle={{ color: '#1677ff' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Постоянных"
                    value={unit === 'pct' ? pct(detail.clients.regular, detail.clients.served) : detail.clients.regular}
                  />
                </Col>
              </Row>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Вернувшийся — покупал раньше, но перед этой покупкой был перерыв 60+ дней.
              </Text>
            </Card>

            <Card size="small" title="5. Лиды" style={{ marginBottom: 12 }}>
              <Row gutter={[12, 12]}>
                <Col span={8}><Statistic title="Холодных контактов" value={detail.leads.contacted} /></Col>
                <Col span={8}>
                  <Statistic
                    title="Купили после контакта"
                    value={detail.leads.converted}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="Конверсия лида"
                    value={pct(detail.leads.converted, detail.leads.contacted)}
                    valueStyle={{ color: '#1677ff' }}
                  />
                </Col>
              </Row>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Лид — клиент, с которым связались и который до этого не покупал 30+ дней.
                {` Засчитывается покупка в течение ${detail.leads.windowDays} дней ПОСЛЕ контакта.`}
                {' '}Считаются уникальные клиенты, а не заметки, поэтому несколько записей одному
                клиенту счётчик не поднимают.
              </Text>
            </Card>

            <Card size="small" title="6. Посещаемость">
              <Row gutter={[12, 12]}>
                <Col span={6}><Statistic title="Рабочих дней" value={detail.attendance.workdays} /></Col>
                <Col span={6}>
                  <Statistic
                    title="Вовремя"
                    value={unit === 'pct'
                      ? pct(detail.attendance.onTime, detail.attendance.workdays)
                      : detail.attendance.onTime}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Опозданий"
                    value={unit === 'pct'
                      ? pct(detail.attendance.late, detail.attendance.workdays)
                      : detail.attendance.late}
                    valueStyle={{ color: detail.attendance.late > 0 ? '#ff4d4f' : undefined }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Нет отметки"
                    value={unit === 'pct'
                      ? pct(Math.max(detail.attendance.workdays - detail.attendance.days, 0), detail.attendance.workdays)
                      : Math.max(detail.attendance.workdays - detail.attendance.days, 0)}
                  />
                </Col>
              </Row>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Считаем от рабочих дней месяца (пн–пт), суббота и воскресенье исключены.
                {' '}Суммарное опоздание: <Text strong>{fmtMinutes(detail.attendance.lateMinutes)}</Text>.
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
              fixedSalary: v.fixedSalary ?? null,
            });
          }}
        >
          <Form.Item
            name="fixedSalary"
            label="Оклад за месяц (сум)"
            extra={planFor?.salary.carriedFrom
              ? `Сейчас перенесён с ${dayjs().year(planFor.salary.carriedFrom.year).month(planFor.salary.carriedFrom.month - 1).format('MMMM YYYY')}`
              : undefined}
          >
            <InputNumber style={{ width: '100%' }} min={0} step={100000} />
          </Form.Item>
          <Form.Item name="revenueTarget" label="План по выручке (сум)">
            <InputNumber style={{ width: '100%' }} min={0} step={1000000} />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            План и оклад задаются на выбранный месяц отдельно для каждого сотрудника.
            Если на новый месяц оклад не задать, действует последний заданный ранее.
          </Text>
        </Form>
      </Modal>

      <BonusSchemeModal open={schemeOpen} onClose={() => setSchemeOpen(false)} />
    </>
  );
}
