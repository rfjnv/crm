import { Card, Col, Row, Typography, Button, Space } from 'antd';
import { UserOutlined, MessageOutlined, TeamOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function AdminDashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Панель администратора
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Управление сайтом и учётными записями. Операционный CRM (сделки, склад) — вкладка «Сотрудники» на странице входа.
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} lg={8}>
          <Card>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <UserOutlined style={{ fontSize: 28, color: '#22609A' }} />
              <Typography.Title level={5} style={{ margin: 0 }}>Пользователи</Typography.Title>
              <Typography.Text type="secondary">
                Создание и удаление аккаунтов для входа по email.
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
              <MessageOutlined style={{ fontSize: 28, color: '#22609A' }} />
              <Typography.Title level={5} style={{ margin: 0 }}>Заявки</Typography.Title>
              <Typography.Text type="secondary">
                Входящие обращения с формы на сайте.
              </Typography.Text>
              <Link to="/admin/inquiries">
                <Button type="primary">Открыть</Button>
              </Link>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12} lg={8}>
          <Card>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <TeamOutlined style={{ fontSize: 28, color: '#22609A' }} />
              <Typography.Title level={5} style={{ margin: 0 }}>CRM для сотрудников</Typography.Title>
              <Typography.Text type="secondary">
                Менеджеры и склад — отдельный вход «Сотрудники» на polygraphbusinesscrm.app
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Вы: {user?.login}
              </Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
