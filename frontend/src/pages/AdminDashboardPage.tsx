import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Typography, Button, Space } from 'antd';
import { siteCmsApi } from '../api/siteCms.api';
import CmsSchemaAlert from '../components/site-admin/CmsSchemaAlert';
import {
  UserOutlined,
  MessageOutlined,
  FileTextOutlined,
  ShoppingOutlined,
  AppstoreOutlined,
  ReadOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MARKETING_SITE_URL } from '../lib/marketingSite';
import { useAuthStore } from '../store/authStore';

const sections = [
  { to: '/admin/content', icon: FileTextOutlined, title: 'Тексты', desc: 'Заголовки, контакты, RU / UZ / EN' },
  { to: '/admin/products', icon: ShoppingOutlined, title: 'Продукция', desc: 'Каталог и фото товаров' },
  { to: '/admin/services', icon: AppstoreOutlined, title: 'Услуги', desc: 'Позиции каталога услуг' },
  { to: '/admin/blog', icon: ReadOutlined, title: 'Блог', desc: 'Статьи на сайте' },
  { to: '/admin/inquiries', icon: MessageOutlined, title: 'Заявки', desc: 'Форма контактов' },
  { to: '/admin/users', icon: UserOutlined, title: 'Пользователи', desc: 'Вход по email в админку' },
];

export default function AdminDashboardPage() {
  const user = useAuthStore((s) => s.user);

  const { data: schemaOk } = useQuery({
    queryKey: ['cms-schema-check'],
    queryFn: async () => {
      try {
        await siteCmsApi.status();
        return true;
      } catch {
        return false;
      }
    },
    staleTime: 60_000,
  });

  return (
    <div>
      {schemaOk === false ? <CmsSchemaAlert /> : null}
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Панель администратора
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Управление сайтом{' '}
        <a href={MARKETING_SITE_URL} target="_blank" rel="noreferrer">
          {MARKETING_SITE_URL}
        </a>
        . Операционный CRM — отдельный вход «Сотрудники».
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        {sections.map(({ to, icon: Icon, title, desc }) => (
          <Col xs={24} sm={12} lg={8} key={to}>
            <Card>
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Icon style={{ fontSize: 28, color: '#22609A' }} />
                <Typography.Title level={5} style={{ margin: 0 }}>{title}</Typography.Title>
                <Typography.Text type="secondary">{desc}</Typography.Text>
                <Link to={to}>
                  <Button type="primary">Открыть</Button>
                </Link>
              </Space>
            </Card>
          </Col>
        ))}
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <GlobalOutlined style={{ fontSize: 28, color: '#22609A' }} />
              <Typography.Title level={5} style={{ margin: 0 }}>Публичный сайт</Typography.Title>
              <Typography.Text type="secondary">Как видят посетители</Typography.Text>
              <Button href={MARKETING_SITE_URL} target="_blank" rel="noreferrer">
                Открыть сайт
              </Button>
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
