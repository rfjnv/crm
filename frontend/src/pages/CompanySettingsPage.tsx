import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography, Form, Input, InputNumber, Button, Card, Upload, message, Spin, Space, Divider, Image, DatePicker, Tag, Alert,
} from 'antd';
import { UploadOutlined, SaveOutlined, SyncOutlined } from '@ant-design/icons';
import { settingsApi } from '../api/settings.api';
import { timepayApi } from '../api/timepay.api';
import { useIsMobile } from '../hooks/useIsMobile';
import type { CompanySettings } from '../types';
import dayjs from 'dayjs';

const BACKEND_URL = import.meta.env.VITE_API_URL
  ? new URL(import.meta.env.VITE_API_URL).origin
  : '';

export default function CompanySettingsPage() {
  const [form] = Form.useForm();
  const [timepayToken, setTimepayToken] = useState('');
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.getCompanySettings,
  });

  const { data: timepayStatus } = useQuery({
    queryKey: ['timepay-status'],
    queryFn: timepayApi.getStatus,
  });

  const setTimepayTokenMut = useMutation({
    mutationFn: timepayApi.setToken,
    onSuccess: () => {
      message.success('Токен TimePay сохранён');
      setTimepayToken('');
      queryClient.invalidateQueries({ queryKey: ['timepay-status'] });
    },
    onError: () => message.error('Не удалось сохранить токен'),
  });

  const syncTimepayMut = useMutation({
    mutationFn: () => timepayApi.sync(),
    onSuccess: (result) => {
      if (result.status === 'SUCCESS') {
        message.success(`Синхронизировано: ${result.matched}, не найдено по ФИО: ${result.unmatched}`);
      } else if (result.status === 'AUTH_ERROR') {
        message.error('Токен TimePay недействителен — обновите его ниже');
      } else if (result.status === 'NOT_CONFIGURED') {
        message.warning('Сначала укажите токен TimePay');
      } else {
        message.error(result.error || 'Ошибка синхронизации');
      }
      queryClient.invalidateQueries({ queryKey: ['timepay-status'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: () => message.error('Ошибка синхронизации'),
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

  const handleSave = (values: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { ...values };
    if (payload.balanceStartDate && dayjs.isDayjs(payload.balanceStartDate)) {
      payload.balanceStartDate = (payload.balanceStartDate as dayjs.Dayjs).format('YYYY-MM-DD');
    }
    updateMut.mutate(payload as Partial<CompanySettings>);
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

      <Card style={{ marginBottom: 24 }}>
        <Typography.Title level={5} style={{ marginBottom: 16 }}>Интеграция TimePay (посещаемость)</Typography.Title>

        {timepayStatus?.lastSyncStatus === 'ERROR' && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="Последняя синхронизация не удалась"
            description={timepayStatus.lastSyncError || 'Неизвестная ошибка'}
          />
        )}

        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Space wrap>
              <Typography.Text>Токен:</Typography.Text>
              {timepayStatus?.hasToken ? (
                <Tag color="green">настроен ({timepayStatus.tokenPreview})</Tag>
              ) : (
                <Tag color="red">не настроен</Tag>
              )}
              {timepayStatus?.lastSyncAt && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Последний синк: {dayjs(timepayStatus.lastSyncAt).format('DD.MM.YYYY HH:mm')}
                  {timepayStatus.lastSyncStatus === 'SUCCESS'
                    ? ` · сопоставлено ${timepayStatus.lastSyncMatched ?? 0}, не найдено ${timepayStatus.lastSyncUnmatched ?? 0}`
                    : ''}
                </Typography.Text>
              )}
            </Space>
          </div>

          <Space.Compact style={{ width: '100%', maxWidth: 560 }}>
            <Input.Password
              placeholder="Вставьте access_token из TimePay"
              value={timepayToken}
              onChange={(e) => setTimepayToken(e.target.value)}
            />
            <Button
              type="primary"
              loading={setTimepayTokenMut.isPending}
              disabled={!timepayToken.trim()}
              onClick={() => setTimepayTokenMut.mutate(timepayToken.trim())}
            >
              Сохранить токен
            </Button>
          </Space.Compact>

          <Button
            icon={<SyncOutlined />}
            loading={syncTimepayMut.isPending}
            disabled={!timepayStatus?.hasToken}
            onClick={() => syncTimepayMut.mutate()}
          >
            Синхронизировать сейчас
          </Button>
        </Space>
      </Card>

      <Card>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            ...(settings || {}),
            balanceStartDate: settings?.balanceStartDate ? dayjs(settings.balanceStartDate) : null,
          }}
          onFinish={handleSave}
        >
          <Typography.Title level={5} style={{ marginBottom: 16 }}>Реквизиты компании</Typography.Title>

          <Form.Item label="Название компании" name="companyName">
            <Input placeholder="ООО Polygraph Business" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            <Form.Item label="Телефон" name="phone">
              <Input placeholder="+998 ..." />
            </Form.Item>
            <Form.Item label="Email" name="email">
              <Input placeholder="info@company.uz" />
            </Form.Item>
          </div>

          <Divider />
          <Typography.Title level={5} style={{ marginBottom: 16 }}>KPI</Typography.Title>

          <Form.Item label="Цель выручки за месяц (сум)" name="monthlyRevenueGoal">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              step={10_000_000}
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
              parser={(v) => Number((v || '').replace(/\s/g, '')) as unknown as 0}
              placeholder="250 000 000"
            />
          </Form.Item>

          <Divider />
          <Typography.Title level={5} style={{ marginBottom: 16 }}>Баланс компании</Typography.Title>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            <Form.Item label="Дата начала учета баланса" name="balanceStartDate">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item label="Начальный баланс" name="initialBalance">
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                step={100000}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
                parser={(v) => Number((v || '').replace(/\s/g, '')) as unknown as 0}
              />
            </Form.Item>
          </div>

          <Divider />
          <Typography.Title level={5} style={{ marginBottom: 16 }}>Банковские реквизиты</Typography.Title>

          <Form.Item label="Название банка" name="bankName">
            <Input placeholder="АКБ ..." />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            <Form.Item label="Расчётный счёт" name="bankAccount">
              <Input placeholder="20208000..." />
            </Form.Item>
            <Form.Item label="МФО" name="mfo">
              <Input placeholder="00000" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            <Form.Item label="Рег. код НДС" name="vatRegCode">
              <Input placeholder="123456789012" />
            </Form.Item>
            <Form.Item label="ОКЭД" name="oked">
              <Input placeholder="12345" />
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
