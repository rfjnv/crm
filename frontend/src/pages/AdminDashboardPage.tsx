import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Typography, Button, Space, Alert, Modal, message } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
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
  const [seeding, setSeeding] = useState(false);

  const { data: cmsStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['cms-schema-check'],
    queryFn: siteCmsApi.status,
    staleTime: 30_000,
  });

  const schemaOk = cmsStatus?.ok === true;

  return (
    <div>
      {schemaOk === false ? <CmsSchemaAlert /> : null}

      {cmsStatus?.siteUsesFallback ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Сайт на проде ещё показывает встроенные тексты (dictionaries.ts)"
          description="В Supabase почти нет данных — публичный сайт их не подхватывает. Нажмите «Импорт с сайта» ниже, затем правьте тексты и сохраняйте секцию."
        />
      ) : cmsStatus ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="Supabase подключён, сайт может читать CMS"
          description={
            <>
              Записей: тексты {cmsStatus.counts.content}, продукция {cmsStatus.counts.products}, услуги{' '}
              {cmsStatus.counts.services}, блог {cmsStatus.counts.blog_posts}.
              {cmsStatus.lastContentUpdate
                ? ` Последнее изменение текстов: ${new Date(cmsStatus.lastContentUpdate).toLocaleString('ru-RU')}.`
                : null}{' '}
              После правок откройте сайт с полным обновлением (Ctrl+F5).
            </>
          }
        />
      ) : null}
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

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Почему админка пустая, а сайт с текстами?"
        description={
          <>
            Публичный сайт по умолчанию берёт тексты из встроенного файла <code>dictionaries.ts</code>, а не из
            пустой базы. Админка CRM показывает только то, что уже в Supabase. Нажмите «Импорт с сайта» один раз —
            появятся все тексты и каталог; дальше правки здесь будут видны на сайте.
          </>
        }
        action={
          <Button
            icon={<DatabaseOutlined />}
            loading={seeding}
            onClick={() => {
              Modal.confirm({
                title: 'Импорт контента с сайта',
                content:
                  'Скопировать все тексты, продукцию, услуги и блог из dictionaries.ts в Supabase? Существующие записи в этих таблицах будут перезаписаны.',
                okText: 'Импортировать',
                cancelText: 'Отмена',
                onOk: async () => {
                  setSeeding(true);
                  try {
                    const result = await siteCmsApi.seedFromDictionaries();
                    message.success(result.message);
                    void refetchStatus();
                  } catch (err: unknown) {
                    message.error(
                      (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                        'Ошибка импорта',
                    );
                  } finally {
                    setSeeding(false);
                  }
                },
              });
            }}
          >
            Импорт с сайта
          </Button>
        }
      />

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
