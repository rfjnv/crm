import { Typography } from 'antd';
import { DollarOutlined } from '@ant-design/icons';

export default function AlmanacDebtsPage() {
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={3}>
        <DollarOutlined style={{ marginRight: 10 }} />
        Альманах — Долги
      </Typography.Title>
      <Typography.Text type="secondary">Страница в разработке</Typography.Text>
    </div>
  );
}
