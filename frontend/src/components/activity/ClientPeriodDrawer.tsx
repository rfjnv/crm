import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, Drawer, Empty, Spin, Table, Typography } from 'antd';
import { analyticsApi } from '../../api/analytics.api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { HIDDEN_MONEY } from '../../utils/currency';
import type { ActivityBucket } from '../../utils/activityPeriods';
import type { HistoryClientPeriodItem } from '../../types';

export type ClientPeriodTarget = { clientId: string; clientName: string; bucket: ActivityBucket };

const money = (v: number | null | undefined) => (v == null ? HIDDEN_MONEY : Number(v).toLocaleString('ru-RU'));

/** Что клиент купил за выбранную ячейку матрицы: месяц, неделю или день. */
export default function ClientPeriodDrawer({ target, onClose }: { target: ClientPeriodTarget | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  const { data, isLoading } = useQuery({
    queryKey: ['manager-client-activity', 'period', target?.clientId, target?.bucket.start, target?.bucket.end],
    queryFn: () => analyticsApi.getHistoryClientPeriod(target!.clientId, target!.bucket.start, target!.bucket.end),
    enabled: !!target,
    staleTime: 120_000,
  });
  const singleDay = target?.bucket.start === target?.bucket.end;

  return (
    <Drawer
      open={!!target}
      onClose={onClose}
      width={isMobile ? '100%' : 860}
      title={target ? (
        <div>
          <div>{target.clientName}</div>
          <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>{target.bucket.title}</Typography.Text>
        </div>
      ) : ''}
      extra={target && <Link to={`/clients/${target.clientId}`}><Button size="small">Карточка клиента</Button></Link>}
    >
      {isLoading ? <Spin /> : !data?.items.length ? <Empty description="Покупок нет" /> : (
        <>
          <div style={{ marginBottom: 16, fontSize: 16, fontWeight: 600 }}>
            Итого: {money(data.totalRevenue)}
            <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400, marginLeft: 12 }}>
              {new Set(data.items.map((i) => i.dealId)).size} сдел. · {data.items.length} поз.
            </Typography.Text>
          </div>
          <Table<HistoryClientPeriodItem>
            dataSource={data.items}
            rowKey="id"
            size="small"
            pagination={data.items.length > 50 ? { pageSize: 50 } : false}
            scroll={{ x: 720 }}
            columns={[
              ...(singleDay ? [] : [{
                title: 'Дата', dataIndex: 'soldOn', key: 'soldOn', width: 96,
                render: (v: string) => v.split('-').reverse().join('.'),
              }]),
              { title: 'Товар', dataIndex: 'productName', key: 'productName', ellipsis: true },
              {
                title: 'Кол-во', dataIndex: 'qty', key: 'qty', width: 110, align: 'right' as const,
                render: (v: number, r: HistoryClientPeriodItem) => `${v.toLocaleString('ru-RU')} ${r.unit || ''}`,
              },
              { title: 'Цена', dataIndex: 'price', key: 'price', width: 110, align: 'right' as const, render: money },
              { title: 'Сумма', dataIndex: 'total', key: 'total', width: 130, align: 'right' as const, render: money },
              {
                title: 'Сделка', dataIndex: 'dealTitle', key: 'dealTitle', ellipsis: true,
                render: (v: string, r: HistoryClientPeriodItem) => <Link to={`/deals/${r.dealId}`}>{v}</Link>,
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
