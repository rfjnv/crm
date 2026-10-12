import { useMemo } from 'react';
import { Collapse, Empty, Progress, Space, Tag, Typography } from 'antd';
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

function fmtQty(qty: number | null, unit?: string): string {
  if (qty === null) return '';
  const n = Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100;
  return ` × ${n.toLocaleString('ru-RU')} ${unit ?? ''}`.trimEnd();
}

/**
 * Продажи за день по менеджерам: только те, у кого есть выручка, по убыванию.
 * Внутри — сделки менеджера и что именно продано.
 */
export default function RevenueByManagers({ payments, total }: { payments: RevenueTodayPayment[]; total: number }) {
  const managers = useMemo<ManagerGroup[]>(() => {
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
  }, [payments]);

  if (managers.length === 0) {
    return <Empty description="За этот день продаж нет" />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        Продавали: {managers.length} · итого {formatUZS(total)}
      </Typography.Text>
      <Collapse
        items={managers.map((m, i) => {
          const share = total > 0 ? Math.round((m.total / total) * 100) : 0;
          return {
            key: m.id,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Typography.Text strong style={{ minWidth: 140 }}>
                  {i + 1}. {getFirstName(m.fullName) || m.fullName}
                </Typography.Text>
                <Typography.Text strong style={{ color: '#52c41a', minWidth: 140 }}>{formatUZS(m.total)}</Typography.Text>
                <Progress percent={share} size="small" style={{ width: 140, margin: 0 }} format={(v) => `${v}%`} />
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
    </Space>
  );
}
