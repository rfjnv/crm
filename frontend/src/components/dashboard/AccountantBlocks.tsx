import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { AutoComplete, Button, Card, Col, Input, Row, Skeleton, Typography, theme, type CardProps } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined, DollarOutlined, HistoryOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { accountingChangesApi } from '../../api/accountingChanges.api';
import { cashboxV2Api } from '../../api/cashboxV2.api';
import { usersApi } from '../../api/users.api';
import AccountingChangeLines from '../AccountingChangeLines';
import AccountingDealDocs from '../AccountingDealDocs';
import { formatCount, formatUZS } from '../../utils/currency';
import { matchesSearch } from '../../utils/translit';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

// Панель оплаты «Кассы 2.0» — грузим, только когда бухгалтер начал принимать деньги
const PaymentPanel = lazy(() => import('../../pages/CashboxV2Page').then((m) => ({ default: m.PaymentPanel })));

function dealsWord(n: number): string {
  const abs = n % 100;
  const last = n % 10;
  if (abs > 10 && abs < 20) return 'сделок';
  if (last === 1) return 'сделка';
  if (last >= 2 && last <= 4) return 'сделки';
  return 'сделок';
}

interface Debtor {
  clientId: string;
  clientName: string;
  debt: number;
  deals: number;
}

/**
 * Дашборд бухгалтера: «Изменения в сделках» (что сверить с документами) и «Касса 2.0»,
 * где оплату можно принять прямо отсюда. Остальной дашборд у бухгалтера почти пустой.
 */
export default function AccountantBlocks({ cardStyle, showCashbox }: { cardStyle: CardProps['style']; showCashbox: boolean }) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<{ clientId: string } | null>(null);
  const [panelLoaded, setPanelLoaded] = useState(false);

  const { data: changes, isLoading: changesLoading } = useQuery({
    queryKey: ['accounting-changes-summary'],
    queryFn: accountingChangesApi.summary,
    refetchInterval: 60_000,
  });
  const { data: toPay, isLoading: cashLoading } = useQuery({
    queryKey: ['cashbox2-to-pay', undefined],
    queryFn: () => cashboxV2Api.toPay(),
    enabled: showCashbox,
    refetchInterval: 60_000,
  });
  const { data: receipts } = useQuery({
    queryKey: ['cashbox2-receipts'],
    queryFn: cashboxV2Api.receipts,
    enabled: showCashbox,
    refetchInterval: 120_000,
  });
  const { data: users } = useQuery({ queryKey: ['users-list'], queryFn: () => usersApi.list(), enabled: panelLoaded });
  const staff = useMemo(() => (users ?? [])
    .filter((u: { isActive: boolean }) => u.isActive)
    .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName })), [users]);

  const debtors = useMemo<Debtor[]>(() => {
    const map = new Map<string, Debtor>();
    for (const d of toPay?.deals ?? []) {
      const row = map.get(d.clientId) ?? { clientId: d.clientId, clientName: d.clientName, debt: 0, deals: 0 };
      row.debt += d.remaining;
      row.deals += 1;
      map.set(d.clientId, row);
    }
    return [...map.values()].sort((a, b) => b.debt - a.debt);
  }, [toPay]);

  // Клиент без долга (предоплата) есть только в серверном поиске — как в самой кассе
  const q = search.trim();
  const debounced = useDebouncedValue(q, 300);
  const { data: hits } = useQuery({
    queryKey: ['cashbox2-client-search', debounced],
    queryFn: () => cashboxV2Api.searchClients(debounced),
    enabled: showCashbox && debounced.length >= 2,
    staleTime: 30_000,
  });
  const options = useMemo(() => {
    if (!q) return [];
    const withDebt = debtors.filter((d) => matchesSearch(d.clientName, q)
      || (toPay?.deals ?? []).some((x) => x.clientId === d.clientId && (matchesSearch(x.title, q) || matchesSearch(x.contractNumber, q))));
    const seen = new Set(withDebt.map((d) => d.clientId));
    const noDebt = (hits ?? []).filter((h) => !seen.has(h.clientId));
    return [
      ...withDebt.slice(0, 8).map((d) => ({
        value: d.clientId,
        label: (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.clientName}</span>
            <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{formatUZS(d.debt)}</Typography.Text>
          </div>
        ),
      })),
      ...noDebt.slice(0, 5).map((h) => ({
        value: h.clientId,
        label: (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.clientName}</span>
            <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>без долга</Typography.Text>
          </div>
        ),
      })),
    ];
  }, [q, debtors, hits, toPay]);

  const openPayment = (clientId: string) => {
    setPanelLoaded(true);
    setPanel({ clientId });
    setSearch('');
  };

  const open = changes?.open ?? 0;
  const pendingReceipts = receipts?.deals.length ?? 0;

  return (
    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
      <Col xs={24} lg={showCashbox ? 13 : 24} style={{ display: 'flex' }}>
        <Card
          bordered={false}
          style={{ ...cardStyle, width: '100%', ...(open > 0 ? { borderColor: token.colorWarningBorder } : {}) }}
          styles={{ body: { padding: '16px 20px' } }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Typography.Text strong style={{ fontSize: 15 }}>
              <HistoryOutlined style={{ marginRight: 8 }} />
              Изменения в сделках
            </Typography.Text>
            <Link to="/finance/deal-changes">Все <ArrowRightOutlined /></Link>
          </div>
          {changesLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          ) : open === 0 ? (
            <Typography.Text type="secondary">
              <CheckCircleOutlined style={{ color: token.colorSuccess, marginRight: 6 }} />
              Все изменения сверены с документами
            </Typography.Text>
          ) : (
            <>
              <Typography.Paragraph style={{ marginBottom: 12 }}>
                <Typography.Text strong style={{ color: token.colorWarning }}>{formatCount(open)}</Typography.Text>
                {' '}{dealsWord(open)} по договору {open % 10 === 1 && open % 100 !== 11 ? 'изменилась' : 'изменились'} — проверьте счёт-фактуру, акт сверки и договор
              </Typography.Paragraph>
              <div style={{ display: 'grid', gap: 10 }}>
                {(changes?.latest ?? []).map((c) => (
                  <Link
                    key={c.id}
                    to={`/finance/deal-changes?deal=${c.dealId}`}
                    style={{ display: 'block', color: 'inherit', padding: '8px 10px', borderRadius: 8, background: token.colorFillQuaternary }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <Typography.Text strong ellipsis>
                        {c.deal?.client?.companyName ?? c.deal?.title ?? 'Сделка'}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {dayjs(c.lastChangedAt).format('DD.MM HH:mm')}
                      </Typography.Text>
                    </div>
                    {c.deal && <AccountingDealDocs deal={c.deal} compact />}
                    <div style={{ marginTop: 6 }}><AccountingChangeLines lines={c.changes} limit={2} /></div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>
      </Col>
      {showCashbox && (
        <Col xs={24} lg={11} style={{ display: 'flex' }}>
          <Card bordered={false} style={{ ...cardStyle, width: '100%' }} styles={{ body: { padding: '16px 20px' } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Typography.Text strong style={{ fontSize: 15 }}>
                <DollarOutlined style={{ marginRight: 8 }} />
                Касса 2.0 — принять оплату
              </Typography.Text>
              <Link to="/finance/cashbox-v2">Открыть <ArrowRightOutlined /></Link>
            </div>
            {cashLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            ) : (
              <>
                <AutoComplete
                  value={search}
                  options={options}
                  onChange={setSearch}
                  onSelect={(clientId: string) => openPayment(clientId)}
                  style={{ width: '100%', marginBottom: 12 }}
                  notFoundContent={q.length >= 2 ? 'Клиент не найден' : null}
                >
                  <Input prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />} placeholder="Клиент, сделка или № договора" allowClear />
                </AutoComplete>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Принято сегодня</Typography.Text>
                    <div style={{ fontSize: 17, fontWeight: 500, color: token.colorSuccess }}>{formatUZS(toPay?.totals.todayReceived ?? 0)}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatCount(toPay?.totals.todayCount ?? 0)} оплат</Typography.Text>
                  </div>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>К оплате</Typography.Text>
                    <div style={{ fontSize: 17, fontWeight: 500 }}>{formatUZS(toPay?.totals.remaining ?? 0)}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatCount(toPay?.totals.clientCount ?? 0)} клиентов</Typography.Text>
                  </div>
                </div>
                {debtors.length > 0 && (
                  <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Больше всех должны</Typography.Text>
                    {debtors.slice(0, 4).map((d) => (
                      <div key={d.clientId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>{d.clientName}</Typography.Text>
                        <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{formatUZS(d.debt)}</Typography.Text>
                        <Button size="small" type="primary" onClick={() => openPayment(d.clientId)}>Принять</Button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                  <Button onClick={() => navigate('/finance/cashbox-v2?tab=journal')}>Журнал</Button>
                  <Button onClick={() => navigate('/finance/cashbox-v2?tab=receipts')}>
                    Чеки{pendingReceipts > 0 ? ` · ${pendingReceipts}` : ''}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </Col>
      )}
      {panelLoaded && (
        <Suspense fallback={null}>
          <PaymentPanel target={panel} staff={staff} onClose={() => setPanel(null)} />
        </Suspense>
      )}
    </Row>
  );
}
