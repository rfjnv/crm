import { useRef, useState } from 'react';
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
  Segmented,
  Popconfirm,
  Select,
  DatePicker,
} from 'antd';
import {
  ArrowLeftOutlined,
  CameraOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  LoadingOutlined,
  PlusOutlined,
  DownloadOutlined,
  DeleteOutlined,
  CopyOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { productsApi } from '../api/products.api';
import { inventoryApi } from '../api/warehouse.api';
import { formatUZS } from '../utils/currency';
import { useAuthStore } from '../store/authStore';
import { API_URL } from '../api/client';
import { uploadsUrl } from '../lib/uploadsUrl';
import { PRODUCT_BADGE_LABELS, type ProductBadge } from '../types';
import dayjs from 'dayjs';

async function downloadFile(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

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
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [postLang, setPostLang] = useState<'ru' | 'uz'>('ru');
  const [editingPost, setEditingPost] = useState(false);
  const [postValue, setPostValue] = useState('');
  const photosInputRef = useRef<HTMLInputElement>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const product = products.find((p) => p.id === id);

  const updateMut = useMutation({
    mutationFn: (data: {
      description?: string;
      postTextRu?: string;
      postTextUz?: string;
      badge?: ProductBadge | null;
      badgeUntil?: string | null;
    }) => productsApi.update(id!, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Сохранено');
    },
    onError: () => message.error('Не удалось сохранить'),
  });

  const uploadPhotosMut = useMutation({
    mutationFn: (files: File[]) => productsApi.uploadPosterPhotos(id!, files),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Фото добавлены');
    },
    onError: (err) => message.error(err instanceof Error ? err.message : 'Не удалось загрузить фото'),
    onSettled: () => setUploadingPhotos(false),
  });

  const deletePhotoMut = useMutation({
    mutationFn: (photoId: string) => productsApi.deletePosterPhoto(id!, photoId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Фото удалено');
    },
    onError: () => message.error('Не удалось удалить фото'),
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

  const imageSrc = uploadsUrl(product.imageUrl);
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
            {imageSrc ? (
              <img
                src={imageSrc}
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
                    if (!res.ok) {
                      const body = await res.json().catch(() => null);
                      throw new Error(body?.message || `Ошибка загрузки фото (HTTP ${res.status})`);
                    }
                    await queryClient.invalidateQueries({ queryKey: ['products'] });
                    message.success('Фото обновлено');
                    onSuccess?.({});
                  } catch (err) {
                    message.error(err instanceof Error ? err.message : 'Ошибка загрузки фото');
                    onError?.(err instanceof Error ? err : new Error('upload failed'));
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

          {/* Ярлык витрины — виден клиентам в боте и мини-аппе */}
          {isAdmin && (
            <div style={{ marginTop: 20 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Ярлык в магазине</Text>
              <Select
                style={{ width: '100%' }}
                placeholder="Без ярлыка"
                allowClear
                value={product.badge ?? undefined}
                onChange={(value?: ProductBadge) =>
                  updateMut.mutate({ badge: value ?? null, ...(value ? {} : { badgeUntil: null }) })
                }
                options={(Object.keys(PRODUCT_BADGE_LABELS) as ProductBadge[]).map((key) => ({
                  value: key,
                  label: PRODUCT_BADGE_LABELS[key],
                }))}
              />
              {product.badge && (
                <>
                  <DatePicker
                    style={{ width: '100%', marginTop: 8 }}
                    placeholder="Показывать до (необязательно)"
                    format="DD.MM.YYYY"
                    value={product.badgeUntil ? dayjs(product.badgeUntil) : null}
                    onChange={(date) =>
                      updateMut.mutate({ badgeUntil: date ? date.endOf('day').toISOString() : null })
                    }
                  />
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                    {product.badge === 'SOON'
                      ? 'Товар показывается в магазине даже при нулевом остатке, но заказать его нельзя.'
                      : 'Ярлык виден клиентам на карточке товара в боте и мини-аппе.'}
                  </Text>
                </>
              )}
            </div>
          )}
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

          {/* Post text (RU/UZ) */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <Text strong>Текст для поста</Text>
              <Segmented
                size="small"
                value={postLang}
                onChange={(v) => setPostLang(v as 'ru' | 'uz')}
                options={[
                  { label: 'RU', value: 'ru' },
                  { label: 'UZ', value: 'uz' },
                ]}
              />
              {isAdmin && !editingPost && (
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setPostValue((postLang === 'ru' ? product.postTextRu : product.postTextUz) ?? '');
                    setEditingPost(true);
                  }}
                />
              )}
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                disabled={!(postLang === 'ru' ? product.postTextRu : product.postTextUz)}
                onClick={async () => {
                  const text = (postLang === 'ru' ? product.postTextRu : product.postTextUz) ?? '';
                  await navigator.clipboard.writeText(text);
                  message.success('Текст скопирован');
                }}
              >
                Копировать
              </Button>
            </div>

            {editingPost ? (
              <div>
                <Input.TextArea
                  value={postValue}
                  onChange={(e) => setPostValue(e.target.value)}
                  rows={5}
                  placeholder={`Введите текст для поста (${postLang.toUpperCase()})...`}
                  autoFocus
                />
                <Space style={{ marginTop: 8 }}>
                  <Button
                    type="primary"
                    size="small"
                    icon={<CheckOutlined />}
                    loading={updateMut.isPending}
                    onClick={() => {
                      updateMut.mutate(
                        postLang === 'ru' ? { postTextRu: postValue } : { postTextUz: postValue },
                      );
                      setEditingPost(false);
                    }}
                  >
                    Сохранить
                  </Button>
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => setEditingPost(false)}
                  >
                    Отмена
                  </Button>
                </Space>
              </div>
            ) : (
              <Paragraph
                style={{
                  color: (postLang === 'ru' ? product.postTextRu : product.postTextUz) ? tk.colorText : tk.colorTextQuaternary,
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}
              >
                {(postLang === 'ru' ? product.postTextRu : product.postTextUz) || 'Текст для поста не добавлен'}
              </Paragraph>
            )}
          </div>
        </div>
      </div>

      {/* Poster photos gallery */}
      <div style={{ marginTop: 32 }}>
        <Text strong style={{ display: 'block', marginBottom: 12 }}>Постерные фото</Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {(product.posterPhotos ?? []).map((photo, idx) => (
            <div
              key={photo.id}
              style={{
                width: 160,
                aspectRatio: '4 / 3',
                borderRadius: tk.borderRadiusLG,
                overflow: 'hidden',
                position: 'relative',
                border: `1px solid ${tk.colorBorderSecondary}`,
              }}
            >
              <img
                src={uploadsUrl(photo.url) ?? ''}
                alt={`${product.name} poster ${idx + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <Space size={4} style={{ position: 'absolute', bottom: 6, right: 6 }}>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() => downloadFile(uploadsUrl(photo.url) ?? '', `${product.sku}-poster-${idx + 1}.jpg`)}
                />
                {isAdmin && (
                  <Popconfirm
                    title="Удалить фото?"
                    onConfirm={() => deletePhotoMut.mutate(photo.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} loading={deletePhotoMut.isPending} />
                  </Popconfirm>
                )}
              </Space>
            </div>
          ))}

          {isAdmin && (
            <>
              <input
                ref={photosInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (!files.length) return;
                  setUploadingPhotos(true);
                  uploadPhotosMut.mutate(files);
                }}
              />
              <div
                onClick={() => !uploadingPhotos && photosInputRef.current?.click()}
                style={{
                  width: 160,
                  aspectRatio: '4 / 3',
                  borderRadius: tk.borderRadiusLG,
                  border: `1px dashed ${tk.colorBorder}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: uploadingPhotos ? 'default' : 'pointer',
                  color: tk.colorTextTertiary,
                }}
              >
                {uploadingPhotos ? <LoadingOutlined style={{ fontSize: 24 }} /> : <PlusOutlined style={{ fontSize: 24 }} />}
                <Text type="secondary" style={{ marginTop: 6, fontSize: 12 }}>Добавить фото</Text>
              </div>
            </>
          )}

          {!isAdmin && !(product.posterPhotos ?? []).length && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: tk.colorTextQuaternary }}>
              <PictureOutlined style={{ fontSize: 20 }} />
              <Text type="secondary">Постерные фото не добавлены</Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
