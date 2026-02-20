import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Select, Typography, Tag, Space } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { inventoryApi } from '../api/warehouse.api';
import dayjs from 'dayjs';

export default function MovementsPage() {
  const [productFilter, setProductFilter] = useState<string | undefined>();

  const { data: movements, isLoading } = useQuery({
    queryKey: ['movements', productFilter],
    queryFn: () => inventoryApi.listMovements(productFilter),
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const columns = [
    {
      title: 'Тип',
      dataIndex: 'type',
      width: 80,
      render: (v: string) =>
        v === 'IN' ? (
          <Tag color="green" icon={<ArrowUpOutlined />}>Приход</Tag>
        ) : (
          <Tag color="red" icon={<ArrowDownOutlined />}>Расход</Tag>
        ),
    },
    { title: 'Товар', dataIndex: ['product', 'name'] },
    { title: 'Артикул', dataIndex: ['product', 'sku'], render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Кол-во', dataIndex: 'quantity', align: 'right' as const, width: 80 },
    { title: 'Сделка', dataIndex: ['deal', 'title'], render: (v: string | undefined) => v || '—' },
    { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
    { title: 'Дата', dataIndex: 'createdAt', width: 140, render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm') },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>Движение склада</Typography.Title>
          <Select
            allowClear
            placeholder="Фильтр по товару"
            style={{ width: 250 }}
            value={productFilter}
            onChange={(v) => setProductFilter(v)}
            showSearch
            optionFilterProp="label"
            options={(products ?? []).map((p) => ({ label: `${p.name} (${p.sku})`, value: p.id }))}
          />
        </Space>
      </div>

      <Table
        dataSource={movements}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
        size="middle"
        bordered={false}
      />
    </div>
  );
}
