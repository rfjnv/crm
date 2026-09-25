import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, Col, Empty, Row, Select, Space, Spin, Table, Tag, Tooltip, Typography, message, theme,
} from 'antd';
import { ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { Bar, Column } from '@ant-design/charts';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import dayjs from 'dayjs';
import BackButton from '../components/BackButton';
import DealStatusTag from '../components/DealStatusTag';
import { HIDDEN_MONEY, formatShortNumber, formatUZS, isMoneyHidden } from '../utils/currency';
import { ropAgentApi, type RopAlert, type RopDigestData, type RopVerdict } from '../api/ropAgent.api';
import type { DealStatus } from '../types';

const { Text, Title } = Typography;

const VERDICT: Record<RopVerdict, { label: string; color: string }> = {
  ok: { label: 'Всё хорошо', color: 'success' },
  in_progress: { label: 'В работе', color: 'processing' },
  behind: { label: 'Отстаёт', color: 'warning' },
  no_touch: { label: 'Не начато', color: 'error' },
};

function errorMessage(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Не удалось выполнить запрос';
}

/** Изменение к прошлому значению: ▲12% зелёным, ▼5% красным. Без базы — ничего. */
function Delta({ now, before, suffix }: { now: number; before: number; suffix: string }) {
  const { token } = theme.useToken();
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  const color = pct > 0 ? token.colorSuccess : pct < 0 ? token.colorError : token.colorTextSecondary;
  return (
    <div style={{ fontSize: 12 }}>
      <span style={{ color }}>{pct > 0 ? '▲' : pct < 0 ? '▼' : '±'}{Math.abs(pct)}%</span>
      <Text type="secondary" style={{ fontSize: 12 }}> {suffix}</Text>
    </div>
  );
}

/**
 * Итоговая фраза агента идёт строкой сразу после списка — markdown склеил бы её
 * с последним пунктом. Отделяем пустой строкой всё, что не пункт списка.
 */
const separateTrailingText = (md: string) => md.replace(/\n(?![-*•\s])/g, '\n\n');

/** Коротко для плиток и осей: «48,2 млн сум». Полная сумма — в подсказке и таблицах. */
const shortMoney = (v: number) => (isMoneyHidden() ? HIDDEN_MONEY : `${formatShortNumber(v)} сум`);
const axisMoney = (v: number) => (isMoneyHidden() ? HIDDEN_MONEY : formatShortNumber(v));

function Tile({ title, value, full, children }: { title: string; value: string; full?: string; children?: React.ReactNode }) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
      <Tooltip title={full}>
        <div style={{ fontSize: 'clamp(17px, 4.6vw, 22px)', fontWeight: 600, lineHeight: 1.3, whiteSpace: 'nowrap' }}>{value}</div>
      </Tooltip>
      {children}
    </Card>
  );
}

const ALERT_STATUS: Record<RopAlert['status'], { label: string; color: string }> = {
  SENT: { label: 'ждёт решения', color: 'processing' },
  ACCEPTED: { label: 'задача поставлена', color: 'success' },
  DECLINED: { label: 'не надо', color: 'default' },
};

/**
 * Сигналы, которые агент сам прислал в Telegram: крупная просрочка, пропал ценный
 * клиент, срывается задача. Решить можно и здесь — тем же действием, что кнопкой в боте.
 */
function AlertsCard() {
  const queryClient = useQueryClient();
  const { data: alerts = [], isLoading } = useQuery({ queryKey: ['rop-agent', 'alerts'], queryFn: ropAgentApi.listAlerts });
  const decide = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      (accept ? ropAgentApi.acceptAlert(id) : ropAgentApi.declineAlert(id)),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ['rop-agent', 'alerts'] });
      if (v.accept) message.success('Задача поставлена');
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  if (isLoading || alerts.length === 0) return null;
  return (
    <Card size="small" title="Сигналы агента">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {alerts.slice(0, 10).map((a) => (
          <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <div>{a.message}</div>
              {a.proposal && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Задача для {a.proposal.managerName} до {dayjs(a.proposal.dueDate).format('DD.MM')}: «{a.proposal.title}»
                </Text>
              )}
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(a.createdAt).format('DD.MM HH:mm')} </Text>
                <Tag color={ALERT_STATUS[a.status].color} style={{ marginLeft: 4 }}>{ALERT_STATUS[a.status].label}</Tag>
              </div>
            </div>
            {a.status === 'SENT' && (
              <Space>
                {a.proposal && (
                  <Button size="small" type="primary" loading={decide.isPending && decide.variables?.id === a.id && decide.variables.accept}
                    onClick={() => decide.mutate({ id: a.id, accept: true })}>
                    Поставить задачу
                  </Button>
                )}
                <Button size="small" loading={decide.isPending && decide.variables?.id === a.id && !decide.variables.accept}
                  onClick={() => decide.mutate({ id: a.id, accept: false })}>
                  {a.proposal ? 'Не надо' : 'Понял'}
                </Button>
              </Space>
            )}
          </div>
        ))}
      </Space>
    </Card>
  );
}

function DigestBody({ d }: { d: RopDigestData }) {
  const { token } = theme.useToken();
  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';
  const axisStyle = {
    labelFill: token.colorTextSecondary,
    grid: true,
    gridStroke: token.colorBorderSecondary,
    gridLineDash: [4, 4],
  };

  const dailyData = useMemo(
    () => d.revenue.daily.map((x) => ({ day: dayjs(x.day).format('DD.MM'), value: x.revenue })),
    [d.revenue.daily],
  );
  const managerData = useMemo(
    () => d.managers.filter((m) => m.revenueMtd > 0).map((m) => ({ name: m.name, value: m.revenueMtd })),
    [d.managers],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={8} xl={4}>
          <Tile title="Выручка за день" value={shortMoney(d.revenue.day)} full={formatUZS(d.revenue.day)}>
            <Delta now={d.revenue.day} before={d.revenue.prevDay} suffix="к пред. дню" />
            <Delta now={d.revenue.day} before={d.revenue.sameWeekdayLastWeek} suffix="к прошлой неделе" />
          </Tile>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile title="С начала месяца" value={shortMoney(d.revenue.mtd)} full={formatUZS(d.revenue.mtd)}>
            <Delta now={d.revenue.mtd} before={d.revenue.prevMtd} suffix="к тому же периоду" />
          </Tile>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile title="Сделки за день" value={`${d.deals.closedDay} закрыто`}>
            <Text type="secondary" style={{ fontSize: 12 }}>новых: {d.deals.newDay}</Text>
          </Tile>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile title="Просроченные долги" value={shortMoney(d.debts.overdue)} full={formatUZS(d.debts.overdue)}>
            <Text type="secondary" style={{ fontSize: 12 }}>{d.debts.overdueDeals} сд. · всего долгов {shortMoney(d.debts.total)}</Text>
          </Tile>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile title="Пропавшие клиенты" value={String(d.clients.overdue)}>
            <Text type="secondary" style={{ fontSize: 12 }}>пора покупать: {d.clients.dueSoon}</Text>
          </Tile>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile title="Залежалый товар" value={shortMoney(d.slowStock.frozen)} full={formatUZS(d.slowStock.frozen)}>
            <Text type="secondary" style={{ fontSize: 12 }}>{d.slowStock.count} позиций, по закупке</Text>
          </Tile>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={14}>
          <Card size="small" title="Выручка за 30 дней">
            <Column
              data={dailyData}
              xField="day"
              yField="value"
              height={280}
              style={{ fill: token.colorPrimary, radiusTopLeft: 4, radiusTopRight: 4, maxWidth: 18 }}
              axis={{ y: { ...axisStyle, labelFormatter: axisMoney }, x: { labelFill: token.colorTextSecondary, labelAutoRotate: false } }}
              tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => formatUZS(v) }] }}
              theme={chartTheme}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title="Менеджеры: выручка с начала месяца">
            {managerData.length ? (
              <Bar
                data={managerData}
                xField="name"
                yField="value"
                height={280}
                style={{ fill: token.colorPrimary, radiusTopRight: 4, radiusBottomRight: 4, maxWidth: 18 }}
                axis={{ x: { labelFill: token.colorTextSecondary }, y: { ...axisStyle, labelFormatter: axisMoney, labelAutoRotate: false } }}
                tooltip={{ title: 'name', items: [{ field: 'value', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => formatUZS(v) }] }}
                theme={chartTheme}
              />
            ) : <Empty description="Продаж в этом месяце нет" />}
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Менеджеры">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              scroll={{ x: true }}
              dataSource={d.managers}
              columns={[
                { title: 'Менеджер', dataIndex: 'name' },
                { title: 'За день', dataIndex: 'revenueDay', align: 'right', render: (v: number) => formatUZS(v) },
                { title: 'С начала месяца', dataIndex: 'revenueMtd', align: 'right', render: (v: number) => formatUZS(v) },
                { title: 'Сделок', dataIndex: 'dealsMtd', align: 'right' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Розданные задачи (30 дней)">
            {d.plans.length ? (
              <Table
                size="small"
                rowKey={(r) => `${r.planId}-${r.manager}`}
                pagination={false}
                scroll={{ x: true }}
                dataSource={d.plans}
                columns={[
                  { title: 'Менеджер', dataIndex: 'manager' },
                  { title: 'План', dataIndex: 'title', ellipsis: true },
                  { title: 'Отработано', align: 'right', render: (_, r) => `${r.touched} из ${r.clients}` },
                  {
                    title: 'Итог',
                    render: (_, r) => (
                      <Space size={4} wrap>
                        <Tag color={VERDICT[r.verdict]?.color}>{VERDICT[r.verdict]?.label ?? r.verdict}</Tag>
                        {r.overdue && <Tag color="error">срок прошёл</Tag>}
                      </Space>
                    ),
                  },
                ]}
              />
            ) : <Empty description="Розданных планов нет" />}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Должники">
            <Table
              size="small"
              rowKey="clientId"
              pagination={false}
              scroll={{ x: true }}
              dataSource={d.debts.topDebtors}
              columns={[
                { title: 'Клиент', dataIndex: 'client', render: (v: string, r) => <Link to={`/clients/${r.clientId}`}>{v}</Link> },
                { title: 'Менеджер', dataIndex: 'manager' },
                { title: 'Просрочено', dataIndex: 'overdueDebt', align: 'right', render: (v: number) => formatUZS(v) },
                { title: 'Дней', dataIndex: 'maxOverdueDays', align: 'right' },
                { title: 'Весь долг', dataIndex: 'debt', align: 'right', render: (v: number) => formatUZS(v) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Пропавшие постоянные клиенты">
            <Table
              size="small"
              rowKey="clientId"
              pagination={false}
              scroll={{ x: true }}
              dataSource={d.clients.topOverdue}
              columns={[
                { title: 'Клиент', dataIndex: 'client', render: (v: string, r) => <Link to={`/clients/${r.clientId}`}>{v}</Link> },
                { title: 'Менеджер', dataIndex: 'manager' },
                { title: 'Тишина / обычно', align: 'right', render: (_, r) => `${r.daysSince} / ${Math.round(r.cycleDays)} дн.` },
                { title: 'За год', dataIndex: 'revenue12m', align: 'right', render: (v: number) => formatUZS(v) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Залежалый товар">
            <Table
              size="small"
              rowKey="productId"
              pagination={false}
              scroll={{ x: true }}
              dataSource={d.slowStock.top}
              columns={[
                { title: 'Товар', dataIndex: 'product' },
                { title: 'Без продаж', dataIndex: 'daysSinceSale', align: 'right', render: (v: number | null) => (v == null ? 'не продавался' : `${v} дн.`) },
                { title: 'По закупке', dataIndex: 'frozen', align: 'right', render: (v: number) => formatUZS(v) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Открытые сделки по этапам">
            <Table
              size="small"
              rowKey="status"
              pagination={false}
              scroll={{ x: true }}
              dataSource={d.deals.pipeline}
              columns={[
                { title: 'Этап', dataIndex: 'status', render: (v: string) => <DealStatusTag status={v as DealStatus} /> },
                { title: 'Сделок', dataIndex: 'count', align: 'right' },
                { title: 'Сумма', dataIndex: 'amount', align: 'right', render: (v: number) => formatUZS(v) },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

/**
 * Ежедневная сводка РОП-агента. Утром она собирается сама и уходит в Telegram;
 * здесь — полная версия с графиками и история по дням.
 */
export default function RopDigestPage() {
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const { data: list, isLoading: listLoading } = useQuery({ queryKey: ['rop-agent', 'digests'], queryFn: ropAgentApi.listDigests });
  const date = params.get('date') || list?.digests[0]?.date || list?.latestDate || null;

  const digestQuery = useQuery({
    queryKey: ['rop-agent', 'digest', date],
    queryFn: () => ropAgentApi.getDigest(date!),
    enabled: !!date,
    retry: false,
  });
  const notFound = (digestQuery.error as { response?: { status?: number } } | null)?.response?.status === 404;

  const buildMutation = useMutation({
    mutationFn: () => ropAgentApi.buildDigest(date!),
    onSuccess: (d) => {
      queryClient.setQueryData(['rop-agent', 'digest', date], d);
      queryClient.invalidateQueries({ queryKey: ['rop-agent', 'digests'] });
      message.success('Сводка собрана');
    },
    onError: (err) => message.error(errorMessage(err)),
  });
  const sendMutation = useMutation({
    mutationFn: () => ropAgentApi.sendDigestToMe(date!),
    onSuccess: () => message.success('Отправлено в Telegram'),
    onError: (err) => message.error(errorMessage(err)),
  });

  const dateOptions = useMemo(() => {
    const dates = new Set((list?.digests ?? []).map((x) => x.date));
    if (list?.latestDate) dates.add(list.latestDate);
    if (date) dates.add(date);
    return [...dates].sort().reverse().map((d) => ({ value: d, label: dayjs(d).format('DD.MM.YYYY, dd') }));
  }, [list, date]);

  const digest = digestQuery.data;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <BackButton fallback="/rop-agent" />
        <Title level={4} style={{ margin: 0 }}>Сводка РОП-агента</Title>
        <Select
          style={{ width: 170 }}
          value={date ?? undefined}
          options={dateOptions}
          onChange={(v) => setParams({ date: v })}
          placeholder="День"
        />
        <div style={{ flex: 1 }} />
        <Button icon={<ReloadOutlined />} loading={buildMutation.isPending} disabled={!date} onClick={() => buildMutation.mutate()}>
          {digest ? 'Собрать заново' : 'Собрать'}
        </Button>
        <Button icon={<SendOutlined />} loading={sendMutation.isPending} disabled={!digest} onClick={() => sendMutation.mutate()}>
          Прислать мне в Telegram
        </Button>
      </div>

      {/* Пока не знаем, какой день показать, запрос сводки выключен — это тоже загрузка, а не «нет сводки». */}
      {listLoading || digestQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
      ) : notFound || !digest ? (
        <Empty description="Сводки за этот день ещё нет">
          <Button type="primary" loading={buildMutation.isPending} disabled={!date} onClick={() => buildMutation.mutate()}>Собрать сейчас</Button>
        </Empty>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {digest.commentary ? (
            <Card size="small" title="На что обратить внимание" style={{ borderColor: token.colorPrimaryBorder }}>
              <div className="rop-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{separateTrailingText(digest.commentary)}</ReactMarkdown></div>
            </Card>
          ) : (
            <Alert type="info" showIcon message="Комментария агента нет — Claude был недоступен при сборке. Нажмите «Собрать заново»." />
          )}
          <AlertsCard />
          <DigestBody d={digest.data} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Собрано {dayjs(digest.updatedAt).format('DD.MM HH:mm')}
            {digest.sentAt ? ` · отправлено в Telegram ${dayjs(digest.sentAt).format('DD.MM HH:mm')}` : ''}
          </Text>
        </Space>
      )}

      <style>{`
        .rop-markdown { font-size: 14px; line-height: 1.65; }
        .rop-markdown p { margin: 0 0 6px; }
        .rop-markdown ul { margin: 0; padding-left: 20px; }
        .rop-markdown li { margin-bottom: 4px; }
      `}</style>
    </div>
  );
}
