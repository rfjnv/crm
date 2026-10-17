import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Empty, Form, Input, Modal, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { AimOutlined, DeleteOutlined, EditOutlined, EnvironmentOutlined, PlusOutlined } from '@ant-design/icons';
import { clientsApi, type ClientLocationData } from '../api/clients.api';
import { geocodeAddress, type LatLng } from '../lib/vedMapGeo';
import { yandexToPointUrl } from '../lib/clientsMapRoute';
import { validateClientPhone } from '../utils/translit';
import type { ClientLocation } from '../types';

interface Props {
  clientId: string;
  /** Основной адрес из карточки клиента — первая точка, её правят через «Редактировать». */
  mainAddress: string | null | undefined;
  locations: ClientLocation[];
  canEdit: boolean;
}

interface FormValues {
  name: string;
  address?: string;
  contactName?: string;
  phone?: string;
  notes?: string;
}

function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

/**
 * Филиалы и другие точки доставки клиента. Каждая точка — отдельная остановка
 * на карте доставки, и в сделке можно выбрать, в какую из них везти.
 */
export default function ClientLocationsCard({ clientId, mainAddress, locations, canEdit }: Props) {
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [editing, setEditing] = useState<ClientLocation | 'new' | null>(null);
  // Координаты в форме: null — стереть, undefined — не трогать
  const [coords, setCoords] = useState<LatLng | null | undefined>(undefined);
  const [geocoding, setGeocoding] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['client', clientId] });
    void qc.invalidateQueries({ queryKey: ['client-locations', clientId] });
    void qc.invalidateQueries({ queryKey: ['clients-map'] });
  };

  const saveMut = useMutation({
    mutationFn: (data: ClientLocationData & { name: string }) => (editing && editing !== 'new'
      ? clientsApi.updateLocation(clientId, editing.id, data)
      : clientsApi.createLocation(clientId, data)),
    onSuccess: () => {
      message.success(editing === 'new' ? 'Точка доставки добавлена' : 'Сохранено');
      setEditing(null);
      refresh();
    },
    onError: (err) => message.error(errorText(err, 'Не удалось сохранить')),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => clientsApi.deleteLocation(clientId, id),
    onSuccess: () => {
      message.success('Точка удалена');
      refresh();
    },
    onError: (err) => message.error(errorText(err, 'Не удалось удалить')),
  });

  const open = (loc: ClientLocation | 'new') => {
    setEditing(loc);
    setCoords(undefined);
  };

  const current = editing && editing !== 'new' ? editing : null;
  const initialValues: FormValues = {
    name: current?.name ?? '',
    address: current?.address ?? '',
    contactName: current?.contactName ?? '',
    phone: current?.phone ?? '',
    notes: current?.notes ?? '',
  };
  const shownCoords: LatLng | null = coords !== undefined
    ? coords
    : current?.latitude != null && current.longitude != null ? [current.latitude, current.longitude] : null;

  const findByAddress = async () => {
    const address = form.getFieldValue('address') as string | undefined;
    if (!address?.trim()) {
      message.warning('Сначала введите адрес');
      return;
    }
    setGeocoding(true);
    try {
      const hit = await geocodeAddress(address, 'Uzbekistan');
      if (hit) {
        setCoords([Math.round(hit[0] * 1e6) / 1e6, Math.round(hit[1] * 1e6) / 1e6]);
        message.success('Нашли — точнее поправить можно на карте доставки');
      } else {
        message.warning('По адресу не нашлось — отметьте точку на карте доставки');
      }
    } finally {
      setGeocoding(false);
    }
  };

  const submit = (v: FormValues) => {
    saveMut.mutate({
      name: v.name.trim(),
      address: v.address?.trim() ?? '',
      contactName: v.contactName?.trim() ?? '',
      phone: v.phone?.trim() ?? '',
      notes: v.notes?.trim() ?? '',
      ...(coords !== undefined ? { latitude: coords?.[0] ?? null, longitude: coords?.[1] ?? null } : {}),
    });
  };

  return (
    <Card
      title="Адреса доставки"
      bordered={false}
      extra={canEdit && (
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => open('new')}>
          Добавить точку
        </Button>
      )}
    >
      <div style={{ display: 'flex', gap: 8, padding: '6px 0' }}>
        <Tag color="blue" style={{ margin: 0, height: 'fit-content' }}>Основной</Tag>
        <Typography.Text type={mainAddress ? undefined : 'secondary'}>
          {mainAddress || 'адрес не указан'}
        </Typography.Text>
      </div>
      {locations.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ margin: '8px 0' }}
          description="Других точек нет. Если клиент просит везти в филиал или на другой склад — добавьте точку."
        />
      ) : locations.map((loc) => {
        const onMap = loc.latitude != null && loc.longitude != null;
        return (
          <div
            key={loc.id}
            style={{
              display: 'flex', gap: 8, padding: '8px 0', alignItems: 'flex-start',
              borderTop: '1px solid var(--ant-color-split, #f0f0f0)',
            }}
          >
            <EnvironmentOutlined style={{ marginTop: 4, color: onMap ? '#1677ff' : '#bfbfbf' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text strong>{loc.name}</Typography.Text>
              {!onMap && <Tag color="orange" style={{ marginLeft: 8 }}>нет точки на карте</Tag>}
              <div><Typography.Text type="secondary">{loc.address || 'адрес не указан'}</Typography.Text></div>
              {(loc.contactName || loc.phone) && (
                <div style={{ fontSize: 13 }}>{[loc.contactName, loc.phone].filter(Boolean).join(' · ')}</div>
              )}
              {loc.notes && <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary, #8c8c8c)' }}>{loc.notes}</div>}
            </div>
            <Space size={0}>
              {onMap && (
                <Button
                  size="small"
                  type="text"
                  icon={<AimOutlined />}
                  title="Открыть в Яндекс Картах"
                  href={yandexToPointUrl([loc.latitude!, loc.longitude!])}
                  target="_blank"
                />
              )}
              {canEdit && <Button size="small" type="text" icon={<EditOutlined />} onClick={() => open(loc)} />}
              {canEdit && (
                <Popconfirm
                  title="Удалить точку доставки?"
                  description="Сделки, которые туда везли, останутся — без привязки к точке."
                  okText="Удалить"
                  okButtonProps={{ danger: true }}
                  cancelText="Отмена"
                  onConfirm={() => deleteMut.mutate(loc.id)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )}
            </Space>
          </div>
        );
      })}
      {locations.some((l) => l.latitude == null || l.longitude == null) && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Точку без координат не добавить в маршрут — отметьте её на <Link to="/clients/map">карте доставки</Link>.
        </Typography.Paragraph>
      )}

      <Modal
        open={editing != null}
        title={editing === 'new' ? 'Новая точка доставки' : 'Точка доставки'}
        okText="Сохранить"
        cancelText="Отмена"
        onOk={() => form.submit()}
        onCancel={() => setEditing(null)}
        confirmLoading={saveMut.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={submit} initialValues={initialValues} preserve={false}>
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, whitespace: true, message: 'Например: «Филиал Чиланзар»' }]}
          >
            <Input placeholder="Филиал Чиланзар, склад на Сергели…" maxLength={200} />
          </Form.Item>
          <Form.Item name="address" label="Адрес">
            <Input placeholder="Город, улица, дом, ориентир" maxLength={500} />
          </Form.Item>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -12, marginBottom: 16, flexWrap: 'wrap' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {shownCoords ? `На карте: ${shownCoords[0]}, ${shownCoords[1]}` : 'На карте не отмечена'}
            </Typography.Text>
            <Button size="small" loading={geocoding} onClick={() => void findByAddress()}>Найти по адресу</Button>
            {shownCoords && <Button size="small" type="link" danger onClick={() => setCoords(null)}>Убрать точку</Button>}
          </div>
          <Space style={{ width: '100%' }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="contactName" label="Контакт на месте">
              <Input placeholder="Если не тот, что в карточке" maxLength={200} />
            </Form.Item>
            <Form.Item
              name="phone"
              label="Телефон"
              rules={[{ validator: (_, v) => { const err = validateClientPhone(v); return err ? Promise.reject(new Error(err)) : Promise.resolve(); } }]}
            >
              <Input placeholder="+998 …" />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="Примечание для водителя">
            <Input.TextArea rows={2} placeholder="Въезд со двора, разгрузка до 17:00…" maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
