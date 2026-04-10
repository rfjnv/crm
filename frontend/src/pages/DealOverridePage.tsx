import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Spin, Typography, Tag, Space } from 'antd';
import { dealsApi } from '../api/deals.api';
import BackButton from '../components/BackButton';
import { inventoryApi } from '../api/warehouse.api';
import { usersApi } from '../api/users.api';
import { clientsApi } from '../api/clients.api';
import SuperOverridePanel from '../components/SuperOverridePanel';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { mobileMainContentBottomPadding } from '../config/mobileBottomNav';
import type { UserRole } from '../types';
import dayjs from 'dayjs';

export default function DealOverridePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = user?.role as UserRole | undefined;
  const isMobile = useIsMobile();

  const canSuperOverride = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const { data: deal, isLoading, isError } = useQuery({
    queryKey: ['deal', id],
    queryFn: () => dealsApi.getById(id!),
    enabled: !!id,
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  const { data: dealPayments } = useQuery({
    queryKey: ['deal-payments', id],
    queryFn: () => dealsApi.getDealPayments(id!),
    enabled: !!id,
  });

  const back = () => navigate(id ? `/deals/${id}` : '/deals');

  const invalidateDeal = () => {
    if (!id) return;
    queryClient.invalidateQueries({ queryKey: ['deal', id] });
    queryClient.invalidateQueries({ queryKey: ['deal-logs', id] });
    queryClient.invalidateQueries({ queryKey: ['deal-history', id] });
    queryClient.invalidateQueries({ queryKey: ['deal-payments', id] });
  };

  if (!canSuperOverride) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!id) {
    return <Navigate to="/deals" replace />;
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isError || !deal) {
    return (
      <div style={{ padding: 24 }}>
        <Typography.Text type="danger">Сделка не найдена.</Typography.Text>
        <div style={{ marginTop: 16 }}>
          <Button onClick={back}>Назад к сделке</Button>
        </div>
      </div>
    );
  }

  const bottomPad = isMobile ? mobileMainContentBottomPadding() : 88;

  return (
    <div
      style={{
        width: '100%',
        paddingBottom: bottomPad,
        boxSizing: 'border-box',
      }}
    >
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            rowGap: 8,
          }}
        >
          <BackButton fallback="/deals" />
          <Typography.Title level={3} style={{ margin: 0, flex: '1 1 240px' }}>
            Override сделки от {dayjs(deal.createdAt).format('DD.MM.YYYY')}
          </Typography.Title>
          <Tag color="red">SUPER ADMIN</Tag>
        </div>

        <SuperOverridePanel
          deal={deal}
          payments={dealPayments ?? []}
          products={products ?? []}
          users={users ?? []}
          clients={(clients ?? []).map((c) => ({ id: c.id, companyName: c.companyName, isSvip: c.isSvip }))}
          onCancel={back}
          onSuccess={() => {
            invalidateDeal();
            back();
          }}
        />
      </Space>
    </div>
  );
}
