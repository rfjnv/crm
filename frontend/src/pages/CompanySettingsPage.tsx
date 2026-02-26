import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography, Form, Input, Button, Card, Upload, message, Spin, Space, Divider, Image,
} from 'antd';
import { UploadOutlined, SaveOutlined } from '@ant-design/icons';
import { settingsApi } from '../api/settings.api';
import type { CompanySettings } from '../types';

const BACKEND_URL = import.meta.env.VITE_API_URL
  ? new URL(import.meta.env.VITE_API_URL).origin
  : '';

export default function CompanySettingsPage() {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.getCompanySettings,
  });

  const updateMut = useMutation({
    mutationFn: (data: Partial<CompanySettings>) => settingsApi.updateCompanySettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      message.success('Настройки сохранены');
    },
    onError: () => message.error('Ошибка сохранения'),
  });

  const logoMut = useMutation({
    mutationFn: (file: File) => settingsApi.uploadLogo(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      message.success('Логотип загружен');
    },
    onError: () => message.error('Ошибка загрузки логотипа'),
  });

  const handleSave = (values: Record<string, string>) => {
    updateMut.mutate(values);
  };

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div style={{ maxWidth: 800 }}>
      <Typography.Title level={4}>Настройки компании</Typography.Title>

      <Card style={{ marginBottom: 24 }}>
        <Typography.Title level={5} style={{ marginBottom: 16 }}>Логотип</Typography.Title>
        <Space direction="vertical" size="middle">
          {settings?.logoPath && (
            <Image
              src={`${BACKEND_URL}/${settings.logoPath}`}
              alt="Логотип"
              style={{ maxHeight: 100, maxWidth: 300 }}
              preview={false}
            />
          )}
          <Upload
            beforeUpload={(file) => {
              logoMut.mutate(file);
              return false;
            }}
            showUploadList={false}
            accept=".jpg,.jpeg,.png,.svg"
          >
            <Button icon={<UploadOutlined />} loading={logoMut.isPending}>
              {settings?.logoPath ? 'Заменить логотип' : 'Загрузить логотип'}
            </Button>
          </Upload>
        </Space>
      </Card>

      <Card>
        <Form
          form={form}
          layout="vertical"
          initialValues={settings || {}}
          onFinish={handleSave}
        >
          <Typography.Title level={5} style={{ marginBottom: 16 }}>Реквизиты компании</Typography.Title>

          <Form.Item label="Название компании" name="companyName">
            <Input placeholder="ООО Polygraph Business" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item label="ИНН" name="inn">
              <Input placeholder="123456789" />
            </Form.Item>
            <Form.Item label="Директор" name="director">
              <Input placeholder="Иванов И.И." />
            </Form.Item>
          </div>

          <Form.Item label="Адрес" name="address">
            <Input placeholder="г. Ташкент, ул. ..." />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item label="Телефон" name="phone">
              <Input placeholder="+998 ..." />
            </Form.Item>
            <Form.Item label="Email" name="email">
              <Input placeholder="info@company.uz" />
            </Form.Item>
          </div>

          <Divider />
          <Typography.Title level={5} style={{ marginBottom: 16 }}>Банковские реквизиты</Typography.Title>

          <Form.Item label="Название банка" name="bankName">
            <Input placeholder="АКБ ..." />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item label="Расчётный счёт" name="bankAccount">
              <Input placeholder="20208000..." />
            </Form.Item>
            <Form.Item label="МФО" name="mfo">
              <Input placeholder="00000" />
            </Form.Item>
          </div>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={updateMut.isPending}
              size="large"
            >
              Сохранить
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
