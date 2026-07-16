import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Drawer, Descriptions, Table, Tabs, Spin, Button, Space } from 'antd';
import { PhoneOutlined, SendOutlined, ExportOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import ClientNotesPanel from './ClientNotesPanel';
import { formatUZS } from '../utils/currency';
import { telegramLinkFromPhone } from '../utils/phone';

/**
 * Быстрый просмотр клиента поверх текущего экрана: контакты (с click-to-call), последние сделки,
 * товары и заметки менеджеров (кто и когда уже связывался). Данные — тот же эндпоинт, что у
 * «Реанимации», плюс общая панель заметок, чтобы факт контакта был виден всем менеджерам.
 */
export default function ClientQuickViewDrawer({
  clientId,
  onClose,
}: {
  clientId: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['client-quick-view', clientId],
    queryFn: () => analyticsApi.getReanimationClientDetail(clientId!),
    enabled: !!clientId,
  });

  const client = data?.client;

  return (
    <Drawer
      title={client?.companyName ?? 'Клиент'}
      open={!!clientId}
      onClose={onClose}
      width="100%"
      styles={{ body: { maxWidth: 900, margin: '0 auto', width: '100%' } }}
      extra={
        clientId ? (
          <Button icon={<ExportOutlined />} onClick={() => navigate(`/clients/${clientId}`)}>
            Открыть карточку
          </Button>
        ) : undefined
      }
    >
      {isLoading || !client ? (
        <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />
      ) : (
        <>
          <Descriptions column={2} size="small" bordered style={{ marginBottom: 20 }}>
            <Descriptions.Item label="Контакт">{client.contactName || '—'}</Descriptions.Item>
            <Descriptions.Item label="Телефон">
              {client.phone ? (
                <Space size={12}>
                  <a href={`tel:${client.phone}`}>
                    <PhoneOutlined /> {client.phone}
                  </a>
                  <a href={telegramLinkFromPhone(client.phone)} target="_blank" rel="noreferrer" title="Написать в Telegram">
                    <SendOutlined style={{ color: '#229ED9' }} />
                  </a>
                </Space>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Email">{client.email || '—'}</Descriptions.Item>
            <Descriptions.Item label="Адрес">{client.address || '—'}</Descriptions.Item>
            <Descriptions.Item label="Менеджер">{client.managerName}</Descriptions.Item>
            <Descriptions.Item label="Долг">{formatUZS(client.currentDebt)}</Descriptions.Item>
            <Descriptions.Item label="Выручка всего">{formatUZS(client.totalRevenue)}</Descriptions.Item>
            <Descriptions.Item label="Последняя покупка">
              {dayjs(client.lastPurchaseAt).format('DD.MM.YYYY')}
            </Descriptions.Item>
          </Descriptions>

          <Tabs
            items={[
              {
                key: 'deals',
                label: 'Сделки',
                children: (
                  <Table
                    dataSource={data?.recentDeals}
                    rowKey="dealId"
                    size="small"
                    pagination={false}
                    locale={{ emptyText: 'Сделок нет' }}
                    columns={[
                      { title: 'Сделка', dataIndex: 'title', key: 'title', ellipsis: true },
                      {
                        title: 'Дата',
                        dataIndex: 'effectiveAt',
                        key: 'effectiveAt',
                        width: 110,
                        render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
                      },
                      {
                        title: 'Сумма',
                        dataIndex: 'amount',
                        key: 'amount',
                        width: 130,
                        align: 'right' as const,
                        render: (v: number) => formatUZS(v),
                      },
                      {
                        title: 'Оплачено',
                        dataIndex: 'paidAmount',
                        key: 'paidAmount',
                        width: 130,
                        align: 'right' as const,
                        render: (v: number) => formatUZS(v),
                      },
                      { title: 'Статус', dataIndex: 'paymentStatus', key: 'paymentStatus', width: 110 },
                    ]}
                  />
                ),
              },
              {
                key: 'products',
                label: 'Товары',
                children: (
                  <Table
                    dataSource={data?.productStats}
                    rowKey="productId"
                    size="small"
                    pagination={false}
                    locale={{ emptyText: 'Покупок нет' }}
                    columns={[
                      { title: 'Товар', dataIndex: 'productName', key: 'productName', ellipsis: true },
                      { title: 'Кол-во', dataIndex: 'totalQty', key: 'totalQty', width: 90, align: 'right' as const },
                      {
                        title: 'Выручка',
                        dataIndex: 'totalRevenue',
                        key: 'totalRevenue',
                        width: 130,
                        align: 'right' as const,
                        render: (v: number) => formatUZS(v),
                      },
                      {
                        title: 'Посл. покупка',
                        dataIndex: 'lastPurchasedAt',
                        key: 'lastPurchasedAt',
                        width: 110,
                        render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
                      },
                    ]}
                  />
                ),
              },
              {
                key: 'notes',
                label: 'Заметки',
                children: clientId ? <ClientNotesPanel clientId={clientId} /> : null,
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
