import { useMemo } from 'react';
import { Card, Col, Collapse, Empty, Progress, Row, Space, Statistic, Tag, Typography, theme } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from '@ant-design/icons';
import { Bar } from '@ant-design/charts';
import { Link } from 'react-router-dom';
import { formatUZS } from '../utils/currency';
import { getFirstName } from '../lib/name-utils';
import { ClientCompanyDisplay } from './ClientCompanyDisplay';
import ReceiptPunchedTag from './ReceiptPunchedTag';
import type { RevenueTodayPayment } from '../types';

interface DealGroup {
  key: string;
  dealId: string | null;
  title: string;
  isReceiptPunched?: boolean;
  client: RevenueTodayPayment['client'];
  total: number;
  lines: { name: string; qty: number | null; unit?: string; amount: number }[];
}

interface ManagerGroup {
  id: string;
  fullName: string;
  total: number;
  deals: DealGroup[];
  clients: number;
}

/**
 * Цвета сравнения: выбранный день — синий, прошлый — оранжевый. Пара прошла
 * проверку палитры (различимость при дальтонизме, контраст) в обеих темах.
 */
const COLOR_CUR = { light: '#2a78d6', dark: '#3987e5' };
const COLOR_PREV = { light: '#eb6834', dark: '#d95926' };

function fmtQty(qty: number | null, unit?: string): string {
  if (qty === null) return '';
  const n = Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100;
  return ` × ${n.toLocaleString('ru-RU')} ${unit ?? ''}`.trimEnd();
}

/** Короткая подпись оси: «12,5 млн». */
function fmtShort(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(Math.round(v / 1e5) / 10).toLocaleString('ru-RU')} млн`;
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3).toLocaleString('ru-RU')} тыс`;
  return String(v);
}

function groupByManager(payments: RevenueTodayPayment[]): ManagerGroup[] {
  const map = new Map<string, ManagerGroup & { dealMap: Map<string, DealGroup>; clientSet: Set<string> }>();
  for (const p of payments) {
    let m = map.get(p.creator.id);
    if (!m) {
      m = { id: p.creator.id, fullName: p.creator.fullName, total: 0, deals: [], clients: 0, dealMap: new Map(), clientSet: new Set() };
      map.set(p.creator.id, m);
    }
    const amount = Number(p.amount) || 0;
    m.total += amount;
    m.clientSet.add(p.client.id);
    const key = p.deal.id ?? `${p.deal.title}|${p.client.id}`;
    let d = m.dealMap.get(key);
    if (!d) {
      d = { key, dealId: p.deal.id, title: p.deal.title, isReceiptPunched: p.deal.isReceiptPunched, client: p.client, total: 0, lines: [] };
      m.dealMap.set(key, d);
    }
    d.total += amount;
    d.lines.push({ name: p.productName ?? '—', qty: p.qty ?? null, unit: p.unit, amount });
  }
  return [...map.values()]
    .map(({ dealMap, clientSet, ...m }) => ({
      ...m,
      clients: clientSet.size,
      deals: [...dealMap.values()].sort((a, b) => b.total - a.total),
    }))
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Изменение к прошлому дню: стрелка + текст, а не только цвет. */
function Delta({ cur, prev, money }: { cur: number; prev: number; money?: boolean }) {
  const diff = cur - prev;
  if (diff === 0) {
    return <Typography.Text type="secondary" style={{ fontSize: 12 }}><MinusOutlined /> как вчера</Typography.Text>;
  }
  const up = diff > 0;
  const pct = prev > 0 ? `${up ? '+' : '−'}${Math.round((Math.abs(diff) / prev) * 100)}%` : null;
  const abs = money ? formatUZS(Math.abs(diff)) : Math.abs(diff).toLocaleString('ru-RU');
  return (
    <Typography.Text type={up ? 'success' : 'danger'} style={{ fontSize: 12 }}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {up ? '+' : '−'}{abs}{pct ? ` (${pct})` : ''}
    </Typography.Text>
  );
}

interface Props {
  payments: RevenueTodayPayment[];
  total: number;
  /** Продажи предыдущего дня; undefined — ещё грузятся. */
  prevPayments?: RevenueTodayPayment[];
  curLabel: string;
  prevLabel: string;
}

/**
 * Продажи за день по менеджерам: только те, у кого есть выручка, по убыванию.
 * Сверху — сравнение с прошлым днём и график «кто сколько сделал».
 */
export default function RevenueByManagers({ payments, total, prevPayments, curLabel, prevLabel }: Props) {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const mode = isDark ? 'dark' : 'light';

  const managers = useMemo(() => groupByManager(payments), [payments]);
  const prevManagers = useMemo(() => groupByManager(prevPayments ?? []), [prevPayments]);
  const prevById = useMemo(() => new Map(prevManagers.map((m) => [m.id, m])), [prevManagers]);
  const prevTotal = prevManagers.reduce((s, m) => s + m.total, 0);
  const deals = managers.reduce((s, m) => s + m.deals.length, 0);
  const prevDeals = prevManagers.reduce((s, m) => s + m.deals.length, 0);
  const hasPrev = prevPayments !== undefined;

  /** Вчера продавали, сегодня нет — их тоже видно на графике (с нулём). */
  const droppedOut = prevManagers.filter((p) => !managers.some((m) => m.id === p.id));

  const chartConfig = useMemo(() => {
    const rows = [...managers, ...droppedOut];
    if (rows.length === 0) return null;
    const data = rows.flatMap((m) => {
      const name = getFirstName(m.fullName) || m.fullName;
      const cur = managers.find((x) => x.id === m.id)?.total ?? 0;
      return [
        { name, period: curLabel, value: cur },
        ...(hasPrev ? [{ name, period: prevLabel, value: prevById.get(m.id)?.total ?? 0 }] : []),
      ];
    });
    return {
      data,
      xField: 'name',
      yField: 'value',
      colorField: 'period',
      group: true,
      height: Math.max(180, rows.length * (hasPrev ? 52 : 34) + 70),
      theme: isDark ? 'classicDark' : 'classic',
      scale: {
        color: {
          domain: hasPrev ? [curLabel, prevLabel] : [curLabel],
          range: hasPrev ? [COLOR_CUR[mode], COLOR_PREV[mode]] : [COLOR_CUR[mode]],
        },
      },
      style: { radiusTopLeft: 4, radiusTopRight: 4, inset: 1 },
      axis: {
        x: { labelFill: token.colorText, title: false, tick: false },
        y: {
          labelFill: token.colorTextSecondary,
          labelFormatter: (v: number) => fmtShort(v),
          labelAutoRotate: false,
          labelAutoHide: true,
          title: false,
          grid: true,
          gridStroke: token.colorBorderSecondary,
          gridLineDash: [0, 0],
        },
      },
      // Подпись суммы только у выбранного дня — прошлый виден по длине и в подсказке.
      label: {
        text: (d: { period: string; value: number }) => (d.period === curLabel && d.value > 0 ? fmtShort(d.value) : ''),
        position: 'right' as const,
        textAlign: 'start' as const,
        textBaseline: 'middle' as const,
        dx: 6,
        fill: token.colorText,
        fontSize: 11,
      },
      legend: { color: { itemLabelFill: token.colorText, position: 'top' as const } },
      tooltip: {
        title: 'name',
        items: [{ field: 'value', channel: 'y', valueFormatter: (v: number) => formatUZS(v) }],
      },
      interaction: { elementHighlightByX: true },
    };
  }, [managers, droppedOut, prevById, hasPrev, curLabel, prevLabel, isDark, mode, token]);

  if (managers.length === 0 && droppedOut.length === 0) {
    return <Empty description="За этот день продаж нет" />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* ── Сводка: день против прошлого ── */}
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="Выручка" value={total} formatter={(v) => formatUZS(Number(v))} />
            {hasPrev && (
              <Space size={6} wrap>
                <Delta cur={total} prev={prevTotal} money />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{prevLabel.toLowerCase()}: {formatUZS(prevTotal)}</Typography.Text>
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small">
            <Statistic title="Продавали менеджеров" value={managers.length} />
            {hasPrev && (
              <Space size={6} wrap>
                <Delta cur={managers.length} prev={prevManagers.length} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{prevLabel.toLowerCase()}: {prevManagers.length}</Typography.Text>
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small">
            <Statistic title="Сделок" value={deals} />
            {hasPrev && (
              <Space size={6} wrap>
                <Delta cur={deals} prev={prevDeals} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{prevLabel.toLowerCase()}: {prevDeals}</Typography.Text>
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      {/* ── График: кто сколько сделал ── */}
      {chartConfig && (
        <Card size="small" title={hasPrev ? `Кто сколько продал: ${curLabel.toLowerCase()} и ${prevLabel.toLowerCase()}` : 'Кто сколько продал'}>
          <Bar {...chartConfig} />
          {droppedOut.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {prevLabel} продавали, {curLabel.toLowerCase()} пока нет: {droppedOut.map((m) => getFirstName(m.fullName) || m.fullName).join(', ')}
            </Typography.Text>
          )}
        </Card>
      )}

      {/* ── Сделки по менеджерам ── */}
      {managers.length > 0 && (
        <Collapse
          items={managers.map((m, i) => {
            const share = total > 0 ? Math.round((m.total / total) * 100) : 0;
            const prev = prevById.get(m.id)?.total ?? 0;
            return {
              key: m.id,
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Typography.Text strong style={{ minWidth: 140 }}>
                    {i + 1}. {getFirstName(m.fullName) || m.fullName}
                  </Typography.Text>
                  <Typography.Text strong style={{ minWidth: 140 }}>{formatUZS(m.total)}</Typography.Text>
                  <Progress percent={share} size="small" style={{ width: 140, margin: 0 }} format={(v) => `${v}%`} />
                  {hasPrev && <Delta cur={m.total} prev={prev} money />}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    сделок {m.deals.length} · клиентов {m.clients}
                  </Typography.Text>
                </div>
              ),
              children: (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {m.deals.map((d) => (
                    <div key={d.key} style={{ borderBottom: '1px solid var(--ant-color-split, #f0f0f0)', paddingBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <Space size={6} wrap>
                          <ClientCompanyDisplay client={d.client} link />
                          {d.dealId ? <Link to={`/deals/${d.dealId}`}>{d.title}</Link> : <span>{d.title}</span>}
                          <ReceiptPunchedTag isReceiptPunched={d.isReceiptPunched} />
                        </Space>
                        <Typography.Text strong>{formatUZS(d.total)}</Typography.Text>
                      </div>
                      <Space size={[4, 4]} wrap style={{ marginTop: 4 }}>
                        {d.lines.map((l, idx) => (
                          <Tag key={idx} style={{ marginInlineEnd: 0 }}>
                            {l.name}{fmtQty(l.qty, l.unit)}
                          </Tag>
                        ))}
                      </Space>
                    </div>
                  ))}
                </Space>
              ),
            };
          })}
        />
      )}
    </Space>
  );
}
