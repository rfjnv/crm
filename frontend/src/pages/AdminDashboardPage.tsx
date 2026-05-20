import { Card, Col, Row, Typography, Button, Space } from 'antd';
import { UserOutlined, GlobalOutlined, TeamOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const SITE_ADMIN_URL = import.meta.env.VITE_MARKETING_SITE_ADMIN_URL || 'https://polygraph.uz/admin';

export default function AdminDashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Панель администратора
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Здесь управление учётными записями входа по email. Операционный CRM (сделки, склад, клиенты) — для сотрудников через вкладку «Сотрудники» на странице входа.
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} lg={8}>
          <Card>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <UserOutlined style={{ fontSize: 28, color: '#22609A' }} />
              <Typography.Title level={5} style={{ margin: 0 }}>Пользователи</Typography.Title>
              <Typography.Text type="secondary">
                Создание и удаление аккаунтов для входа по email (Supabase Auth).
              </Typography.Text>
              <Link to="/admin/users">
                <Button type="primary">Открыть</Button>
              </Link>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12} lg={8}>
          <Card>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <GlobalOutlined style={{ fontSize: 28, color: '#22609A' }} />
              <Typography.Title level={5} style={{ margin: 0 }}>Контент сайта</Typography.Title>
              <Typography.Text type="secondary">
                Тексты, продукция, услуги, блог и заявки — в админке маркетингового сайта.
              </Typography.Text>
              <Button type="default" href={SITE_ADMIN_URL} target="_blank" rel="noreferrer">
                Открыть админку сайта
              </Button>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12} lg={8}>
          <Card>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <TeamOutlined style={{ fontSize: 28, color: '#22609A' }} />
              <Typography.Title level={5} style={{ margin: 0 }}>CRM для сотрудников</Typography.Title>
              <Typography.Text type="secondary">
                Менеджеры и склад работают в полном CRM под своими логинами, не через эту панель.
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Вы вошли как: {user?.login}
              </Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
