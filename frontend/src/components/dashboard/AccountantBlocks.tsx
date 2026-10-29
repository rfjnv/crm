import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Col, Input, Row, Skeleton, Typography, theme, type CardProps } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined, DollarOutlined, HistoryOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { accountingChangesApi } from '../../api/accountingChanges.api';
import { cashboxV2Api } from '../../api/cashboxV2.api';
import AccountingChangeLines from '../AccountingChangeLines';
import { formatCount, formatUZS } from '../../utils/currency';

function dealsWord(n: number): string {
  const abs = n % 100;
  const last = n % 10;
  if (abs > 10 && abs < 20) return 'сделок';
  if (last === 1) return 'сделка';
  if (last >= 2 && last <= 4) return 'сделки';
  return 'сделок';
}

/**
 * Дашборд бухгалтера: «Изменения в сделках» (что сверить с документами) и быстрый
 * вход в «Кассу 2.0». Остальной дашборд у бухгалтера почти пустой — продажи ему не нужны.
 */
export default function AccountantBlocks({ cardStyle, showCashbox }: { cardStyle: CardProps['style']; showCashbox: boolean }) {
  const { token } = theme.useToken();
  const navigate = useNavigate();

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

  const open = changes?.open ?? 0;
  const pendingReceipts = receipts?.deals.length ?? 0;

  return (
    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
      <Col xs={24} lg={showCashbox ? 14 : 24} style={{ display: 'flex' }}>
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
                {' '}{dealsWord(open)} на перечисление {open % 10 === 1 && open % 100 !== 11 ? 'изменилась' : 'изменились'} — проверьте счёт-фактуру, акт сверки и договор
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
                    <div style={{ marginTop: 4 }}><AccountingChangeLines lines={c.changes} limit={2} /></div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>
      </Col>
      {showCashbox && (
        <Col xs={24} lg={10} style={{ display: 'flex' }}>
          <Card bordered={false} style={{ ...cardStyle, width: '100%' }} styles={{ body: { padding: '16px 20px' } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Typography.Text strong style={{ fontSize: 15 }}>
                <DollarOutlined style={{ marginRight: 8 }} />
                Касса 2.0
              </Typography.Text>
              <Link to="/finance/cashbox-v2">Открыть <ArrowRightOutlined /></Link>
            </div>
            {cashLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            ) : (
              <>
                <Input.Search
                  placeholder="Клиент или сделка — принять оплату"
                  allowClear
                  enterButton
                  onSearch={(q) => navigate(q.trim() ? `/finance/cashbox-v2?q=${encodeURIComponent(q.trim())}` : '/finance/cashbox-v2')}
                  style={{ marginBottom: 14 }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Принято сегодня</Typography.Text>
                    <div style={{ fontSize: 17, fontWeight: 500 }}>{formatUZS(toPay?.totals.todayReceived ?? 0)}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatCount(toPay?.totals.todayCount ?? 0)} оплат</Typography.Text>
                  </div>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>К оплате</Typography.Text>
                    <div style={{ fontSize: 17, fontWeight: 500 }}>{formatUZS(toPay?.totals.remaining ?? 0)}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatCount(toPay?.totals.clientCount ?? 0)} клиентов</Typography.Text>
                  </div>
                </div>
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
    </Row>
  );
}
