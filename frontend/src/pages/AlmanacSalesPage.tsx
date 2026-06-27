import { Typography } from 'antd';
import { ShoppingOutlined } from '@ant-design/icons';

export default function AlmanacSalesPage() {
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={3}>
        <ShoppingOutlined style={{ marginRight: 10 }} />
        Альманах — Продажи
      </Typography.Title>
      <Typography.Text type="secondary">Страница в разработке</Typography.Text>
    </div>
  );
}
