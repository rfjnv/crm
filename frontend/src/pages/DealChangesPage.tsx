import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Input, Modal, Segmented, Table, Tag, Typography, message, theme } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { accountingChangesApi, type AccountingChange } from '../api/accountingChanges.api';
import AccountingChangeLines from '../components/AccountingChangeLines';
import BackButton from '../components/BackButton';
import DealStatusTag from '../components/DealStatusTag';
import AccountingDealDocs from '../components/AccountingDealDocs';
import MobileCardList from '../components/MobileCardList';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { useIsMobile } from '../hooks/useIsMobile';
import { getFirstName } from '../lib/name-utils';
import { formatUZS } from '../utils/currency';

/**
 * «Изменения в сделках»: сделки на перечисление, которые поменялись после того, как
 * попали к бухгалтеру (скидка, количество, товары). Бухгалтер сверяет свои документы —
 * счёт-фактуру, акт сверки, договор — и отмечает «Проверил».
 */
export default function DealChangesPage() {
  const isMobile = useIsMobile();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('tab') === 'reviewed' ? 'reviewed' : 'open';
  const dealFilter = searchParams.get('deal') ?? undefined;
  const [reviewing, setReviewing] = useState<AccountingChange | null>(null);
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['accounting-changes', status, dealFilter ?? null],
    queryFn: () => accountingChangesApi.list(status, dealFilter),
    refetchInterval: 60_000,
  });
  const list = data ?? [];

  const review = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => accountingChangesApi.review(id, note),
    onSuccess: () => {
      message.success('Отмечено: документы проверены');
      setReviewing(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['accounting-changes'] });
      qc.invalidateQueries({ queryKey: ['accounting-changes-summary'] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) => message.error(e.response?.data?.error ?? 'Не удалось отметить'),
  });

  const setTab = (tab: string) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    if (tab === 'open') next.delete('tab'); else next.set('tab', tab);
    return next;
  }, { replace: true });
  const clearDeal = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.delete('deal');
    return next;
  }, { replace: true });

  const dealCell = (r: AccountingChange) => (
    <div style={{ minWidth: 200 }}>
      {r.deal ? (
        <>
          <Link to={`/deals/${r.dealId}`}><Typography.Text strong>{r.deal.title}</Typography.Text></Link>
          {r.deal.client && (
            <div style={{ marginTop: 2 }}>
              <ClientCompanyDisplay client={r.deal.client} link secondary />
            </div>
          )}
          <AccountingDealDocs deal={r.deal} />
          <div style={{ marginTop: 6 }}>
            <DealStatusTag status={r.deal.status} />
          </div>
        </>
      ) : (
        <Typography.Text type="secondary">Сделка удалена</Typography.Text>
      )}
    </div>
  );

  const whoCell = (r: AccountingChange) => (
    <div style={{ minWidth: 130 }}>
      <div>{getFirstName(r.changedBy.fullName) || r.changedBy.fullName}</div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {dayjs(r.lastChangedAt).format('DD.MM.YYYY HH:mm')}
        {r.editCount > 1 ? ` · правок: ${r.editCount}` : ''}
      </Typography.Text>
    </div>
  );

  const actionCell = (r: AccountingChange) => (status === 'open' ? (
    <Button type="primary" icon={<CheckOutlined />} onClick={() => setReviewing(r)}>Проверил</Button>
  ) : (
    <div style={{ minWidth: 140 }}>
      <Typography.Text type="success">
        {r.reviewedBy ? getFirstName(r.reviewedBy.fullName) || r.reviewedBy.fullName : 'Автоматически'}
      </Typography.Text>
      <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.reviewedAt ? dayjs(r.reviewedAt).format('DD.MM.YYYY HH:mm') : ''}</Typography.Text></div>
      {r.reviewNote && <div style={{ fontSize: 12 }}>{r.reviewNote}</div>}
    </div>
  ));

  const columns = [
    { title: 'Сделка', key: 'deal', render: (_: unknown, r: AccountingChange) => dealCell(r) },
    { title: 'Что изменилось', key: 'changes', render: (_: unknown, r: AccountingChange) => <AccountingChangeLines lines={r.changes} /> },
    {
      title: 'Сумма сейчас',
      key: 'amount',
      align: 'right' as const,
      render: (_: unknown, r: AccountingChange) => (r.deal ? <Typography.Text strong>{formatUZS(r.deal.amount)}</Typography.Text> : '—'),
    },
    { title: 'Кто изменил', key: 'who', render: (_: unknown, r: AccountingChange) => whoCell(r) },
    { title: status === 'open' ? '' : 'Проверил', key: 'action', width: 150, render: (_: unknown, r: AccountingChange) => actionCell(r) },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Изменения в сделках
          {status === 'open' && list.length > 0 && <Tag color="orange" style={{ marginLeft: 8, fontSize: 14 }}>{list.length}</Tag>}
        </Typography.Title>
      </div>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Сделки на перечисление, в которых после передачи бухгалтеру поменялись цены, количество, товары, скидка или НДС.
        Сверьте счёт-фактуру, акт сверки и договор и отметьте «Проверил».
      </Typography.Text>

      <Segmented
        value={status}
        onChange={(v) => setTab(String(v))}
        options={[{ label: 'Нужно проверить', value: 'open' }, { label: 'Проверено', value: 'reviewed' }]}
        style={{ marginBottom: 16 }}
      />

      {dealFilter && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Показаны изменения одной сделки"
          action={<Button size="small" onClick={clearDeal}>Показать все</Button>}
        />
      )}

      {isMobile ? (
        <MobileCardList
          data={list}
          rowKey="id"
          loading={isLoading}
          emptyText={status === 'open' ? 'Всё проверено — изменений нет' : 'Пока ничего не проверяли'}
          renderCard={(r: AccountingChange) => (
            <Card size="small" bordered style={{ borderColor: status === 'open' ? token.colorWarningBorder : undefined }}>
              {dealCell(r)}
              <div style={{ marginTop: 10 }}><AccountingChangeLines lines={r.changes} /></div>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-end' }}>
                {whoCell(r)}
                {r.deal && <Typography.Text strong>{formatUZS(r.deal.amount)}</Typography.Text>}
              </div>
              <div style={{ marginTop: 10 }}>{actionCell(r)}</div>
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={list}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={list.length > 50 ? { pageSize: 50 } : false}
          size="middle"
          scroll={{ x: 980 }}
          locale={{ emptyText: status === 'open' ? 'Всё проверено — изменений нет' : 'Пока ничего не проверяли' }}
        />
      )}

      <Modal
        open={!!reviewing}
        title="Документы проверены?"
        okText="Да, проверил"
        cancelText="Отмена"
        confirmLoading={review.isPending}
        onCancel={() => { setReviewing(null); setNote(''); }}
        onOk={() => reviewing && review.mutate({ id: reviewing.id, note: note.trim() || undefined })}
      >
        {reviewing && (
          <>
            <Typography.Paragraph>
              <Typography.Text strong>{reviewing.deal?.title}</Typography.Text>
              {reviewing.deal?.client ? ` — ${reviewing.deal.client.companyName}` : ''}
            </Typography.Paragraph>
            <AccountingChangeLines lines={reviewing.changes} />
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 8 }}>
              Убедитесь, что счёт-фактура, акт сверки и договор совпадают со сделкой.
            </Typography.Paragraph>
            <Input.TextArea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Комментарий (необязательно): например, «счёт-фактура переделана»"
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={500}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
