import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography,
  Tag,
  Spin,
  Button,
  Input,
  message,
  Descriptions,
  theme,
  Space,
  Upload,
} from 'antd';
import {
  ArrowLeftOutlined,
  CameraOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { productsApi } from '../api/products.api';
import { inventoryApi } from '../api/warehouse.api';
import { formatUZS } from '../utils/currency';
import { useAuthStore } from '../store/authStore';
import { API_URL } from '../api/client';

const { Title, Text, Paragraph } = Typography;

export default function AlmanacProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token: tk } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const product = products.find((p) => p.id === id);

  const updateMut = useMutation({
    mutationFn: (data: { description?: string }) =>
      productsApi.update(id!, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Сохранено');
    },
    onError: () => message.error('Не удалось сохранить'),
  });

  if (isLoading) {
    return (
      <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!product) {
    return (
      <div style={{ padding: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/almanac/products')} style={{ marginBottom: 16 }}>
          Назад
        </Button>
        <Text type="secondary">Товар не найден</Text>
      </div>
    );
  }

  const stock = Number(product.stock);
  const minStock = Number(product.minStock);
  const stockLow = stock <= minStock;

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/almanac/products')}
        style={{ marginBottom: 20, paddingLeft: 0 }}
      >
        Назад к товарам
      </Button>

      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* LEFT — Photo 4:3 */}
        <div style={{ flex: '0 0 340px', maxWidth: 340 }}>
          <div
            style={{
              width: '100%',
              aspectRatio: '4 / 3',
              background: tk.colorFillSecondary,
              borderRadius: tk.borderRadiusLG,
              overflow: 'hidden',
              position: 'relative',
              border: `1px solid ${tk.colorBorderSecondary}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: tk.colorTextQuaternary }}>
                <CameraOutlined style={{ fontSize: 48, display: 'block', marginBottom: 8 }} />
                <Text type="secondary">Нет фото</Text>
              </div>
            )}

            {isAdmin && (
              <Upload
                accept="image/*"
                showUploadList={false}
                customRequest={async ({ file, onSuccess, onError }) => {
                  setUploadingImage(true);
                  const token = useAuthStore.getState().accessToken;
                  const formData = new FormData();
                  formData.append('image', file as File);
                  try {
                    const res = await fetch(`${API_URL}/inventory/products/${id}/image`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` },
                      body: formData,
                    });
                    if (!res.ok) throw new Error();
                    await queryClient.invalidateQueries({ queryKey: ['products'] });
                    message.success('Фото обновлено');
                    onSuccess?.({});
                  } catch {
                    message.error('Ошибка загрузки фото');
                    onError?.(new Error('upload failed'));
                  } finally {
                    setUploadingImage(false);
                  }
                }}
              >
                <Button
                  size="small"
                  icon={uploadingImage ? <LoadingOutlined /> : <CameraOutlined />}
                  disabled={uploadingImage}
                  style={{ position: 'absolute', bottom: 10, right: 10, opacity: 0.9 }}
                >
                  {product.imageUrl ? 'Заменить фото' : 'Добавить фото'}
                </Button>
              </Upload>
            )}
          </div>

          <Space wrap style={{ marginTop: 12 }}>
            {product.category && <Tag color="blue">{product.category}</Tag>}
            {product.countryOfOrigin && <Tag>{product.countryOfOrigin}</Tag>}
            {product.format && <Tag color="purple">{product.format}</Tag>}
            <Tag color={product.isActive ? 'green' : 'red'}>
              {product.isActive ? 'Активен' : 'Неактивен'}
            </Tag>
          </Space>
        </div>

        {/* RIGHT — Info */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <Title level={3} style={{ marginBottom: 4 }}>{product.name}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>Артикул: {product.sku}</Text>

          <Descriptions
            column={1}
            size="small"
            style={{ marginTop: 20 }}
            styles={{ label: { color: tk.colorTextSecondary, width: 140 } }}
          >
            <Descriptions.Item label="Единица">
              <Tag>{product.unit}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Остаток">
              <Text style={{ color: stockLow ? tk.colorError : tk.colorSuccess, fontWeight: 600 }}>
                {stock} {product.unit}
              </Text>
              {stockLow && <Tag color="red" style={{ marginLeft: 8 }}>Мало</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Мин. остаток">
              {minStock} {product.unit}
            </Descriptions.Item>
            {product.salePrice && (
              <Descriptions.Item label="Цена продажи">
                <Text strong style={{ color: tk.colorPrimary }}>
                  {formatUZS(parseFloat(product.salePrice))}
                </Text>
              </Descriptions.Item>
            )}
          </Descriptions>

          {/* Description */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text strong>Описание</Text>
              {isAdmin && !editingDesc && (
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setDescValue(product.description ?? '');
                    setEditingDesc(true);
                  }}
                />
              )}
            </div>

            {editingDesc ? (
              <div>
                <Input.TextArea
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  rows={5}
                  placeholder="Введите описание товара..."
                  autoFocus
                />
                <Space style={{ marginTop: 8 }}>
                  <Button
                    type="primary"
                    size="small"
                    icon={<CheckOutlined />}
                    loading={updateMut.isPending}
                    onClick={() => {
                      updateMut.mutate({ description: descValue });
                      setEditingDesc(false);
                    }}
                  >
                    Сохранить
                  </Button>
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => setEditingDesc(false)}
                  >
                    Отмена
                  </Button>
                </Space>
              </div>
            ) : (
              <Paragraph
                style={{
                  color: product.description ? tk.colorText : tk.colorTextQuaternary,
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}
              >
                {product.description || 'Описание не добавлено'}
              </Paragraph>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
