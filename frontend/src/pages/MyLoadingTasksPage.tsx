import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Typography, Button, Card, Popconfirm, message, Tag, Descriptions } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { formatUZS } from '../utils/currency';
import type { Deal } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuthStore } from '../store/authStore';
import BackButton from '../components/BackButton';

const deliveryLabels: Record<string, string> = { SELF_PICKUP: 'Самовывоз', YANDEX: 'Яндекс', DELIVERY: 'Доставка' };

export default function MyLoadingTasksPage() {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['my-loading-tasks'],
    queryFn: dealsApi.myLoadingTasks,
    refetchInterval: 10_000,
  });

  const markLoadedMut = useMutation({
    mutationFn: (dealId: string) => dealsApi.markLoaded(dealId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-loading-tasks'] }); message.success('Отгружено!'); },
  });

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={3} style={{ margin: 0 }}>Мои отгрузки ({deals.length})</Typography.Title>
      </div>
      <Card>
        <Table
          dataSource={deals}
          rowKey="id"
          loading={isLoading}
          size="small"
          pagination={false}
          scroll={{ x: 600 }}
          expandable={{
            expandedRowRender: (r: Deal) => (
              <Descriptions size="small" column={isMobile ? 1 : 2} bordered>
                <Descriptions.Item label="Позиции">
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {(r as any).items?.map((it: any) => (
                      <li key={it.id}>{it.product?.name} — {Number(it.requestedQty)} {it.product?.unit || ''}</li>
                    ))}
                  </ul>
                </Descriptions.Item>
                {r.deliveryType === 'DELIVERY' && r.deliveryDriver && (
                  <Descriptions.Item label="Загрузить в машину">
                    <Tag color="blue">{r.deliveryDriver.fullName}</Tag>
                    {r.vehicleNumber && <> — {r.vehicleType} {r.vehicleNumber}</>}
                  </Descriptions.Item>
                )}
              </Descriptions>
            ),
          }}
          columns={[
            { title: 'Сделка', dataIndex: 'title', render: (v: string, r: Deal) => <Link to={`/deals/${r.id}`}>{v}</Link> },
            { title: 'Клиент', dataIndex: ['client', 'companyName'] },
            { title: 'Сумма', dataIndex: 'amount', render: (v: string) => formatUZS(Number(v)), width: 130 },
            {
              title: 'Доставка', dataIndex: 'deliveryType', width: 110,
              render: (v: string) => {
                const cfg = deliveryLabels[v];
                const colors: Record<string, string> = { SELF_PICKUP: 'blue', YANDEX: 'purple', DELIVERY: 'orange' };
                return cfg ? <Tag color={colors[v]}>{cfg}</Tag> : <Tag>—</Tag>;
              },
            },
            ...(isAdmin ? [{
              title: 'Исполнитель', key: 'assignee', width: 140,
              render: (_: unknown, r: Deal) => r.loadingAssignee ? <Tag color="cyan">{(r as any).loadingAssignee.fullName}</Tag> : '—',
            }] : []),
            {
              title: 'Куда грузить', key: 'target', width: 180,
              render: (_: unknown, r: Deal) => {
                if (r.deliveryType !== 'DELIVERY') return <Tag color="blue">Клиенту</Tag>;
                if (r.deliveryDriver) return <Tag color="green">Машина: {r.deliveryDriver.fullName}</Tag>;
                return '—';
              },
            },
            {
              title: '', key: 'actions', width: 140,
              render: (_: unknown, r: Deal) => (
                isAdmin ? <Tag>Наблюдение</Tag> : (
                  <Popconfirm title="Подтвердить отгрузку?" onConfirm={() => markLoadedMut.mutate(r.id)}>
                    <Button type="primary" size="small" icon={<CheckCircleOutlined />} loading={markLoadedMut.isPending}>
                      Отгружено
                    </Button>
                  </Popconfirm>
                )
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
