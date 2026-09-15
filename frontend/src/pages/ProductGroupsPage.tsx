import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Typography, Input, Space, Card, Segmented, Button } from 'antd';
import { ArrowLeftOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { inventoryApi } from '../api/warehouse.api';
import { matchesSearch } from '../utils/translit';
import ProductHierarchyPanel from '../components/ProductHierarchyPanel';
import { useAuthStore } from '../store/authStore';

const { Title } = Typography;

/**
 * Отдельная страница-редактор группировок товаров (категория → тип), чтобы менеджеры/склад
 * сами перераспределяли товары по группам в проде, без правок кода под каждый случай.
 */
export default function ProductGroupsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canManage = isSuperAdmin || (user?.permissions ?? []).includes('manage_products');

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'active' | 'all'>('active');

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const filtered = useMemo(() => {
    let list = products ?? [];
    if (activeFilter === 'active') list = list.filter((p) => p.isActive);
    const q = search.trim();
    if (q) list = list.filter((p) => matchesSearch(p.name, q) || matchesSearch(p.sku, q));
    return list;
  }, [products, activeFilter, search]);

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
        <Title level={4} style={{ margin: 0 }}>Группировки товаров</Title>
      </Space>

      <Typography.Paragraph type="secondary">
        Категория и тип каждого товара — это то, по чему аналитика «Клиенты по иерархии» строит фильтры и графики.
        Здесь можно переименовывать группы, снимать их с товаров и переносить несколько товаров сразу — изменения
        применяются немедленно, без деплоя.
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Поиск по названию или артикулу"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
          />
          <Segmented
            value={activeFilter}
            onChange={(v) => setActiveFilter(v as 'active' | 'all')}
            options={[
              { label: 'Активные', value: 'active' },
              { label: 'Все товары', value: 'all' },
            ]}
          />
        </Space>
      </Card>

      {!canManage && (
        <Typography.Paragraph type="warning">
          У вас нет прав на изменение группировок — страница открыта только для просмотра.
        </Typography.Paragraph>
      )}

      <ProductHierarchyPanel
        products={filtered}
        loading={isLoading}
        canManage={canManage}
        searchHint={search || activeFilter !== 'active' ? 'Показаны товары по текущим фильтрам и поиску.' : undefined}
        onEditProduct={(p) => navigate(`/inventory/products/${p.id}`)}
      />
    </div>
  );
}
