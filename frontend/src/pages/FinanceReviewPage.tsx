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
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import BackButton from '../components/BackButton';
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

  const renderTransferInfo = (deal: FinanceDeal, compact = false) => {
    if (deal.paymentMethod !== 'TRANSFER') {
      return <Typography.Text type="secondary" style={{ fontSize: compact ? 12 : 13 }}>Нет доп. данных</Typography.Text>;
    }

    const documents = Array.isArray(deal.transferDocuments) ? deal.transferDocuments : [];

    return (
      <div style={{ display: 'grid', gap: compact ? 4 : 6, minWidth: compact ? 0 : 220 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography.Text type="secondary" style={{ fontSize: compact ? 11 : 12 }}>ИНН</Typography.Text>
          <Typography.Text code style={{ fontSize: compact ? 11 : 12 }}>
            {deal.transferInn || '—'}
          </Typography.Text>
          {deal.transferType && (
            <Tag color="magenta" style={{ marginInlineEnd: 0 }}>
              {transferTypeLabels[deal.transferType] ?? deal.transferType}
            </Tag>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {documents.length > 0 ? documents.map((doc) => (
            <Tag key={doc} color="cyan" style={{ marginInlineEnd: 0 }}>
              {doc}
            </Tag>
          )) : (
            <Typography.Text type="secondary" style={{ fontSize: compact ? 11 : 12 }}>Документы не выбраны</Typography.Text>
          )}
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
            <ClientCompanyDisplay client={deal.client} link secondary />
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {deal.paymentType && <Tag style={{ marginInlineEnd: 0 }}>{paymentTypeLabels[deal.paymentType] ?? deal.paymentType}</Tag>}
            {deal.paymentMethod && <Tag color="blue" style={{ marginInlineEnd: 0 }}>{paymentMethodLabels[deal.paymentMethod] ?? deal.paymentMethod}</Tag>}
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
          <div style={{ marginTop: 4 }}>
            <Typography.Text
              style={{
                color: deal.clientDebt > 0 ? token.colorError : token.colorTextSecondary,
                fontWeight: deal.clientDebt > 0 ? 600 : 400,
                fontSize: 13,
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
      title: 'Менеджер',
      key: 'meta',
      render: (_: unknown, deal: FinanceDeal) => (
        <div style={{ minWidth: 140 }}>
          <div>{deal.manager?.fullName || '—'}</div>
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="secondary">
              {dayjs(deal.createdAt).format('DD.MM.YYYY')}
            </Typography.Text>
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
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Финансы на проверке
          {list.length > 0 && <Tag style={{ marginLeft: 8, fontSize: 14 }}>{list.length}</Tag>}
        </Typography.Title>
      </div>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Здесь только обзор. Полную проверку и решение удобнее делать внутри самой сделки.
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
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    <ClientCompanyDisplay client={deal.client} link secondary />
                  </div>
                </div>
                <Typography.Text strong>{formatUZS(deal.amount)}</Typography.Text>
              </div>

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                {deal.paymentType && <Tag style={{ marginInlineEnd: 0 }}>{paymentTypeLabels[deal.paymentType] ?? deal.paymentType}</Tag>}
                {deal.paymentMethod && <Tag color="blue" style={{ marginInlineEnd: 0 }}>{paymentMethodLabels[deal.paymentMethod] ?? deal.paymentMethod}</Tag>}
              </div>

              <div style={{ marginTop: 10 }}>
                {renderTransferInfo(deal, true)}
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
          scroll={{ x: 980 }}
          locale={{ emptyText: 'Нет сделок на проверке' }}
          summary={() => {
            if (list.length === 0) return null;
            const total = list.reduce((sum, deal) => sum + Number(deal.amount), 0);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>
                  <Typography.Text strong>Итого: {list.length} сделок</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Typography.Text strong>{formatUZS(total)}</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} colSpan={3} />
              </Table.Summary.Row>
            );
          }}
        />
      )}
    </div>
  );
}
