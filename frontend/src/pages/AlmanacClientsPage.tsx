import { Typography } from 'antd';
import { TeamOutlined } from '@ant-design/icons';

export default function AlmanacClientsPage() {
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={3}>
        <TeamOutlined style={{ marginRight: 10 }} />
        Альманах — Клиенты
      </Typography.Title>
      <Typography.Text type="secondary">Страница в разработке</Typography.Text>
    </div>
  );
}
