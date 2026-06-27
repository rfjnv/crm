import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Collapse,
  Table,
  Typography,
  Tag,
  Input,
  Spin,
  Badge,
  Space,
} from 'antd';
import { AppstoreOutlined, SearchOutlined, FolderOutlined } from '@ant-design/icons';
import { inventoryApi } from '../api/warehouse.api';
import { formatUZS } from '../utils/currency';
import { matchesSearch } from '../utils/translit';
import type { Product } from '../types';

const { Title, Text } = Typography;

export default function AlmanacProductsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const grouped = useMemo(() => {
    const filtered = products.filter(
      (p) => p.isActive && (!search || matchesSearch(p.name, search) || matchesSearch(p.sku, search)),
    );

    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const cat = p.category?.trim() || 'Без категории';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => {
        if (a === 'Без категории') return 1;
        if (b === 'Без категории') return -1;
        return a.localeCompare(b, 'ru');
      })
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      }));
  }, [products, search]);

  const columns = [
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: 'Артикул',
      dataIndex: 'sku',
      key: 'sku',
      width: 120,
      render: (sku: string) => <Text type="secondary" style={{ fontSize: 12 }}>{sku}</Text>,
    },
    {
      title: 'Единица',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
      render: (unit: string) => <Tag>{unit}</Tag>,
    },
    {
      title: 'Остаток',
      dataIndex: 'stock',
      key: 'stock',
      width: 100,
      render: (stock: number, record: Product) => (
        <Text type={stock <= record.minStock ? 'danger' : undefined}>
          {stock}
        </Text>
      ),
    },
    {
      title: 'Цена продажи',
      dataIndex: 'salePrice',
      key: 'salePrice',
      width: 140,
      render: (price: string | null) =>
        price ? <Text>{formatUZS(parseFloat(price))}</Text> : <Text type="secondary">—</Text>,
    },
  ];

  const collapseItems = grouped.map(({ category, items }) => ({
    key: category,
    label: (
      <Space>
        <FolderOutlined />
        <Text strong>{category}</Text>
        <Badge count={items.length} color="blue" showZero style={{ fontSize: 11 }} />
      </Space>
    ),
    children: (
      <Table<Product>
        dataSource={items}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={items.length > 20 ? { pageSize: 20, size: 'small' } : false}
        scroll={{ x: 700 }}
        onRow={(record) => ({
          onClick: () => navigate(`/almanac/products/${record.id}`),
          style: { cursor: 'pointer' },
        })}
      />
    ),
  }));

  if (isLoading) {
    return (
      <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <Title level={3} style={{ margin: 0 }}>
          <AppstoreOutlined style={{ marginRight: 10 }} />
          Альманах — Товары
        </Title>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Поиск по названию или артикулу..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ width: 280 }}
        />
      </div>

      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        {grouped.length} категор{grouped.length === 1 ? 'ия' : grouped.length < 5 ? 'ии' : 'ий'} · {products.filter((p) => p.isActive).length} активных товаров
      </Text>

      {grouped.length === 0 ? (
        <Text type="secondary">Товары не найдены</Text>
      ) : (
        <Collapse
          items={collapseItems}
          defaultActiveKey={grouped.length <= 5 ? grouped.map((g) => g.category) : []}
        />
      )}
    </div>
  );
}
