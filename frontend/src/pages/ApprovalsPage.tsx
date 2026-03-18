import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography, Card } from 'antd';
import DealStatusTag from '../components/DealStatusTag';
import { formatUZS } from '../utils/currency';
import { dealsApi } from '../api/deals.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import type { Deal, DealStatus } from '../types';
import dayjs from 'dayjs';

export default function ApprovalsPage() {
  const isMobile = useIsMobile();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  let filterStatus: DealStatus | undefined;
  let title = 'Ожидающие действий';
  let description = '';

  if (role === 'WAREHOUSE') {
    filterStatus = 'WAITING_STOCK_CONFIRMATION';
    title = 'Ожидает подтв. склада';
    description = 'Сделки, ожидающие подтверждения наличия на складе.';
  } else if (role === 'ACCOUNTANT') {
    filterStatus = 'WAITING_FINANCE';
    title = 'Финансовое одобрение';
    description = 'Сделки, ожидающие финансового одобрения.';
  } else if (role === 'WAREHOUSE_MANAGER') {
    filterStatus = 'READY_FOR_SHIPMENT';
    title = 'Отгрузка';
    description = 'Сделки, готовые к отгрузке.';
  }

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', 'approvals', role, filterStatus],
    queryFn: () => (role === 'ACCOUNTANT' ? dealsApi.financeQueue() : dealsApi.list(filterStatus)),
  });

  const columns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Статус', dataIndex: 'status', render: (s: Deal['status']) => <DealStatusTag status={s} /> },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    { title: 'Позиций', dataIndex: ['_count', 'items'], align: 'center' as const },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    { title: 'Дата', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>{title}</Typography.Title>
      {description && (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          {description}
        </Typography.Text>
      )}

      {isMobile ? (
        <MobileCardList
          data={deals ?? []}
          rowKey="id"
          loading={isLoading}
          renderCard={(deal: Deal) => (
            <Card size="small" bordered>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/deals/${deal.id}`}><Typography.Text strong>{deal.title}</Typography.Text></Link>
                  <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{deal.client?.companyName}</Typography.Text></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Typography.Text strong>{formatUZS(deal.amount)}</Typography.Text>
                  <div><DealStatusTag status={deal.status} /></div>
                </div>
              </div>
              <div style={{ marginTop: 4 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{deal.manager?.fullName} · {dayjs(deal.createdAt).format('DD.MM.YYYY')}</Typography.Text>
              </div>
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={deals}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          size="middle"
          bordered={false}
          scroll={{ x: 600 }}
          locale={{ emptyText: 'Нет сделок, ожидающих действий' }}
        />
      )}
    </div>
  );
}
