import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Table, Typography, Tag, theme, Card, Button,
} from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import type { Deal } from '../types';
import dayjs from 'dayjs';

const paymentTypeLabels: Record<string, string> = {
  FULL: 'Полная',
  PARTIAL: 'Частичная',
  INSTALLMENT: 'Рассрочка',
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'Наличные',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  TRANSFER: 'Перечисление',
  INSTALLMENT: 'Рассрочка',
};

const transferTypeLabels: Record<'ONE_TIME' | 'ANNUAL', string> = {
  ONE_TIME: 'Разовый',
  ANNUAL: 'Годовой',
};

type FinanceDeal = Deal & { clientDebt: number };

export default function FinanceReviewPage() {
  const isMobile = useIsMobile();
  const { token } = theme.useToken();

  const { data: deals, isLoading } = useQuery({
    queryKey: ['finance-queue'],
    queryFn: dealsApi.financeQueue,
    refetchInterval: 10_000,
  });

  const list = deals ?? [];

  const renderTransferInfo = (deal: FinanceDeal) => {
    if (deal.paymentMethod !== 'TRANSFER') {
      return <Typography.Text type="secondary">Доп. данные не требуются</Typography.Text>;
    }

    const documents = Array.isArray(deal.transferDocuments) ? deal.transferDocuments : [];

    return (
      <div
        style={{
          display: 'grid',
          gap: 8,
          minWidth: 260,
          padding: 10,
          borderRadius: 10,
          background: token.colorFillAlter,
        }}
      >
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>ИНН</Typography.Text>
          <div>
            <Typography.Text code>{deal.transferInn || '—'}</Typography.Text>
          </div>
        </div>

        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Тип документа</Typography.Text>
          <div style={{ marginTop: 4 }}>
            {deal.transferType ? (
              <Tag color="magenta">{transferTypeLabels[deal.transferType] ?? deal.transferType}</Tag>
            ) : (
              <Typography.Text>—</Typography.Text>
            )}
          </div>
        </div>

        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Документы</Typography.Text>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {documents.length > 0 ? documents.map((doc) => (
              <Tag key={doc} color="cyan">{doc}</Tag>
            )) : <Typography.Text>—</Typography.Text>}
          </div>
        </div>
      </div>
    );
  };

  const columns = [
    {
      title: 'Сделка',
      key: 'deal',
      render: (_: unknown, deal: FinanceDeal) => (
        <div style={{ minWidth: 220 }}>
          <Link to={`/deals/${deal.id}`}>
            <Typography.Text strong>{deal.title}</Typography.Text>
          </Link>
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="secondary">{deal.client?.companyName || '—'}</Typography.Text>
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {deal.paymentType && <Tag>{paymentTypeLabels[deal.paymentType] ?? deal.paymentType}</Tag>}
            {deal.paymentMethod && <Tag color="blue">{paymentMethodLabels[deal.paymentMethod] ?? deal.paymentMethod}</Tag>}
          </div>
        </div>
      ),
    },
    {
      title: 'Сумма',
      key: 'money',
      render: (_: unknown, deal: FinanceDeal) => (
        <div style={{ minWidth: 160, textAlign: 'right' }}>
          <div>
            <Typography.Text strong>{formatUZS(deal.amount)}</Typography.Text>
          </div>
          <div style={{ marginTop: 6 }}>
            <Typography.Text
              style={{
                color: deal.clientDebt > 0 ? token.colorError : token.colorTextSecondary,
                fontWeight: deal.clientDebt > 0 ? 600 : 400,
              }}
            >
              Долг: {formatUZS(deal.clientDebt)}
            </Typography.Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Для бухгалтера',
      key: 'transfer',
      render: (_: unknown, deal: FinanceDeal) => renderTransferInfo(deal),
    },
    {
      title: 'Договор',
      key: 'contract',
      render: (_: unknown, deal: FinanceDeal) => (
        <div style={{ minWidth: 150 }}>
          <div>{deal.contract?.contractNumber || '—'}</div>
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="secondary">
              Срок: {deal.dueDate ? dayjs(deal.dueDate).format('DD.MM.YYYY') : '—'}
            </Typography.Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Менеджер',
      key: 'meta',
      render: (_: unknown, deal: FinanceDeal) => (
        <div style={{ minWidth: 140 }}>
          <div>{deal.manager?.fullName || '—'}</div>
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="secondary">{dayjs(deal.createdAt).format('DD.MM.YYYY')}</Typography.Text>
          </div>
        </div>
      ),
    },
    {
      title: '',
      key: 'open',
      width: 110,
      render: (_: unknown, deal: FinanceDeal) => (
        <Button type="link" icon={<ArrowRightOutlined />}>
          <Link to={`/deals/${deal.id}`}>Открыть</Link>
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 8 }}>
        Финансы на проверке
        {list.length > 0 && <Tag style={{ marginLeft: 8, fontSize: 14 }}>{list.length}</Tag>}
      </Typography.Title>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Здесь только обзор. Одобрение и отклонение лучше делать внутри самой сделки, где виден полный контекст.
      </Typography.Text>

      {isMobile ? (
        <MobileCardList
          data={list}
          rowKey="id"
          loading={isLoading}
          renderCard={(deal: FinanceDeal) => (
            <Card size="small" bordered>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/deals/${deal.id}`}>
                    <Typography.Text strong>{deal.title}</Typography.Text>
                  </Link>
                  <div style={{ marginTop: 4 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {deal.client?.companyName || '—'}
                    </Typography.Text>
                  </div>
                </div>
                <Typography.Text strong>{formatUZS(deal.amount)}</Typography.Text>
              </div>

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                {deal.paymentType && <Tag>{paymentTypeLabels[deal.paymentType] ?? deal.paymentType}</Tag>}
                {deal.paymentMethod && <Tag color="blue">{paymentMethodLabels[deal.paymentMethod] ?? deal.paymentMethod}</Tag>}
                {deal.contract?.contractNumber && <Tag color="gold">{deal.contract.contractNumber}</Tag>}
              </div>

              <div style={{ marginTop: 10 }}>
                {renderTransferInfo(deal)}
              </div>

              <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
                <Typography.Text style={{ color: deal.clientDebt > 0 ? token.colorError : token.colorTextSecondary }}>
                  Долг клиента: {formatUZS(deal.clientDebt)}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Менеджер: {deal.manager?.fullName || '—'} • {dayjs(deal.createdAt).format('DD.MM.YYYY')}
                </Typography.Text>
              </div>

              <div style={{ marginTop: 10 }}>
                <Link to={`/deals/${deal.id}`}>Открыть сделку</Link>
              </div>
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={list}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          size="middle"
          bordered={false}
          scroll={{ x: 1200 }}
          locale={{ emptyText: 'Нет сделок на проверке' }}
          summary={() => {
            if (list.length === 0) return null;
            const total = list.reduce((sum, deal) => sum + Number(deal.amount), 0);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={1}>
                  <Typography.Text strong>Итого: {list.length} сделок</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Typography.Text strong>{formatUZS(total)}</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} colSpan={4} />
              </Table.Summary.Row>
            );
          }}
        />
      )}
    </div>
  );
}
