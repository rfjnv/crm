import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Table, Typography, Tag, Badge, Card, Pagination,
} from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import DealStatusTag from '../components/DealStatusTag';
import type { Deal } from '../types';
import dayjs from 'dayjs';
import BackButton from '../components/BackButton';

const deliveryLabels: Record<string, string> = { SELF_PICKUP: 'Самовывоз', YANDEX: 'Яндекс', DELIVERY: 'Доставка' };

export default function ShipmentPage() {
  const isMobile = useIsMobile();
  const [closedPage, setClosedPage] = useState(1);

  const { data: closedResult, isLoading: closedLoading } = useQuery({
    queryKey: ['closed-deals', closedPage],
    queryFn: () => dealsApi.closedDeals(closedPage, 20),
    refetchInterval: 30_000,
  });

  const closedDeals = closedResult?.data ?? [];
  const closedPagination = closedResult?.pagination;

  const renderClosedCard = (r: Deal) => (
    <Card size="small" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/deals/${r.id}`}>
            <Typography.Text strong>{r.title}</Typography.Text>
          </Link>
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {(r as any).client?.companyName}
            </Typography.Text>
          </div>
          <div style={{ marginTop: 2 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Менеджер: {(r as any).manager?.fullName}
            </Typography.Text>
          </div>
          <div style={{ marginTop: 4 }}>
            <DealStatusTag status={r.status} />
            {r.deliveryType && (
              <Tag color={r.deliveryType === 'DELIVERY' ? 'orange' : r.deliveryType === 'YANDEX' ? 'purple' : 'blue'} style={{ marginLeft: 4 }}>
                {deliveryLabels[r.deliveryType] || r.deliveryType}
              </Tag>
            )}
          </div>
          {r.deliveryDriver && (
            <div style={{ marginTop: 2, fontSize: 12 }}>
              <Tag color="green" style={{ fontSize: 11 }}>Водитель: {r.deliveryDriver.fullName}</Tag>
            </div>
          )}
          {(r as any).loadingAssignee && (
            <div style={{ marginTop: 2, fontSize: 12 }}>
              <Tag color="cyan" style={{ fontSize: 11 }}>Грузил: {(r as any).loadingAssignee.fullName}</Tag>
            </div>
          )}
          <div style={{ marginTop: 4 }}>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
              {r.items?.map((it: any) => (
                <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
              ))}
            </ul>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography.Text strong>{formatUZS(Number(r.amount))}</Typography.Text>
          <div style={{ marginTop: 4, fontSize: 11, color: '#999' }}>
            {dayjs(r.updatedAt).format('DD.MM.YYYY')}
          </div>
          <div style={{ marginTop: 4 }}>
            <Tag icon={<CheckCircleOutlined />} color="success">Закрыта</Tag>
          </div>
        </div>
      </div>
    </Card>
  );

  const closedColumns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Клиент', dataIndex: ['client', 'companyName'] },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    {
      title: 'Доставка', dataIndex: 'deliveryType', width: 110,
      render: (v: string) => v ? <Tag color={v === 'DELIVERY' ? 'orange' : v === 'YANDEX' ? 'purple' : 'blue'}>{deliveryLabels[v] || v}</Tag> : '—',
    },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    {
      title: 'Водитель', key: 'driver', width: 140,
      render: (_: unknown, r: Deal) => r.deliveryDriver ? <Tag color="green">{r.deliveryDriver.fullName}</Tag> : '—',
    },
    {
      title: 'Грузил', key: 'loader', width: 140,
      render: (_: unknown, r: Deal) => (r as any).loadingAssignee ? <Tag color="cyan">{(r as any).loadingAssignee.fullName}</Tag> : '—',
    },
    {
      title: 'Товары', key: 'items',
      render: (_: unknown, r: Deal) => <Badge count={r.items?.length ?? 0} showZero style={{ backgroundColor: '#52c41a' }} />,
    },
    { title: 'Закрыта', dataIndex: 'updatedAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
  ];

  return (
    <div style={{ padding: isMobile ? 12 : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Накладные {closedPagination ? `(${closedPagination.total})` : ''}
        </Typography.Title>
      </div>

      {isMobile ? (
        closedLoading ? <Card loading /> : closedDeals.length === 0
          ? <Card><Typography.Text type="secondary">Нет закрытых сделок</Typography.Text></Card>
          : (
            <div>
              {closedDeals.map((d) => <div key={d.id}>{renderClosedCard(d)}</div>)}
              {closedPagination && closedPagination.pages > 1 && (
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                  <Pagination
                    current={closedPage}
                    total={closedPagination.total}
                    pageSize={20}
                    onChange={(p) => setClosedPage(p)}
                    size="small"
                  />
                </div>
              )}
            </div>
          )
      ) : (
        <>
          <Table
            dataSource={closedDeals}
            columns={closedColumns}
            rowKey="id"
            loading={closedLoading}
            pagination={false}
            size="middle"
            scroll={{ x: 900 }}
            locale={{ emptyText: 'Нет закрытых сделок' }}
            expandable={{
              expandedRowRender: (record: Deal) => {
                const items = record.items ?? [];
                if (items.length === 0) return <Typography.Text type="secondary">Нет позиций</Typography.Text>;
                return (
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {items.map((it: any) => (
                      <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
                    ))}
                  </ul>
                );
              },
            }}
          />
          {closedPagination && closedPagination.pages > 1 && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Pagination
                current={closedPage}
                total={closedPagination.total}
                pageSize={20}
                onChange={(p) => setClosedPage(p)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
