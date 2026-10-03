import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag, Tooltip, Typography, message, theme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ru';
import { mobileApi, type MobileDeviceRow, type MobileSettings } from '../api/calls.api';
import { apiErrorMessage } from '../components/calls/callsUi';

dayjs.extend(relativeTime);

const WEEK_DAYS = [
  { value: 1, label: 'Пн' }, { value: 2, label: 'Вт' }, { value: 3, label: 'Ср' }, { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' }, { value: 6, label: 'Сб' }, { value: 7, label: 'Вс' },
];

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

/** Админка телефонов CallSync: кто на связи, очередь, разрешения, путь к папке записей. */
export default function MobileDevicesPage() {
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [pathFor, setPathFor] = useState<MobileDeviceRow | null>(null);
  const [pathValue, setPathValue] = useState('');
  const [modelPath, setModelPath] = useState<{ model: string; path: string } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['mobile-devices'], queryFn: mobileApi.devices, refetchInterval: 60_000 });
  const { data: models = [] } = useQuery({ queryKey: ['mobile-device-models'], queryFn: mobileApi.deviceModels });
  const { data: settings } = useQuery({ queryKey: ['mobile-settings'], queryFn: mobileApi.settings });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['mobile-devices'] });
    queryClient.invalidateQueries({ queryKey: ['mobile-device-models'] });
  };
  const onError = (err: unknown) => message.error(apiErrorMessage(err));

  const revoke = useMutation({ mutationFn: mobileApi.revoke, onSuccess: () => { message.success('Телефон отвязан'); refresh(); }, onError });
  const requestLogs = useMutation({
    mutationFn: mobileApi.requestLogs,
    onSuccess: () => { message.success('Лог запрошен — телефон пришлёт его при следующей синхронизации'); refresh(); },
    onError,
  });
  const savePath = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) => mobileApi.updateDevice(id, { recordingsPathOverride: path || null }),
    onSuccess: () => { message.success('Путь сохранён'); setPathFor(null); refresh(); },
    onError,
  });
  const saveModelPath = useMutation({
    mutationFn: ({ model, path }: { model: string; path: string }) => mobileApi.setModelPath(model, path),
    onSuccess: () => { message.success('Путь для модели сохранён'); setModelPath(null); refresh(); },
    onError,
  });
  const saveSettings = useMutation({
    mutationFn: (v: Partial<MobileSettings>) => mobileApi.updateSettings(v),
    onSuccess: () => { message.success('Настройки сохранены'); queryClient.invalidateQueries({ queryKey: ['mobile-settings'] }); },
    onError,
  });

  const downloadLog = async (id: string) => {
    try {
      const { url } = await mobileApi.logUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      onError(err);
    }
  };

  const columns: ColumnsType<MobileDeviceRow> = [
    {
      title: 'Сотрудник',
      key: 'user',
      render: (_, d) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{d.user.fullName}</Typography.Text>
          {!d.active && <Tag>Отвязан {d.revokedAt ? dayjs(d.revokedAt).format('DD.MM.YY') : ''}</Tag>}
        </Space>
      ),
    },
    {
      title: 'Телефон',
      key: 'model',
      render: (_, d) => (
        <Space direction="vertical" size={0}>
          <span>{d.model ?? '—'}</span>
          <Typography.Text type="secondary">Android {d.androidVersion ?? '?'} · CallSync {d.appVersion ?? '?'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Последняя связь',
      key: 'seen',
      render: (_, d) => (
        <Space direction="vertical" size={0}>
          <Typography.Text style={{ color: d.silent ? token.colorError : undefined }}>
            {d.lastSeenAt ? dayjs(d.lastSeenAt).locale('ru').fromNow() : 'не выходил на связь'}
          </Typography.Text>
          {d.silent && <Tag color="red">Молчит больше 2 ч в рабочее время</Tag>}
          {d.lastCallAt && <Typography.Text type="secondary">звонок {dayjs(d.lastCallAt).format('DD.MM HH:mm')}</Typography.Text>}
        </Space>
      ),
    },
    {
      title: 'Очередь',
      key: 'queue',
      render: (_, d) => (
        <Space direction="vertical" size={0}>
          <span>звонков {d.queueCalls}, файлов {d.queueFiles} ({formatBytes(d.queueBytes)})</span>
          {d.failedCalls > 0 && <Typography.Text type="danger">с ошибкой: {d.failedCalls}</Typography.Text>}
        </Space>
      ),
    },
    {
      title: 'Разрешения',
      key: 'perm',
      render: (_, d) => (d.problemsText ? <Tag color="red" style={{ whiteSpace: 'normal' }}>{d.problemsText}</Tag> : d.active ? <Tag color="green">Всё в порядке</Tag> : null),
    },
    {
      title: 'Папка записей',
      key: 'path',
      render: (_, d) => (
        <Space direction="vertical" size={0}>
          <Tooltip title={d.recordingsPathOverride ? 'Задан для этого телефона' : d.modelRecordingsPath ? 'Задан для модели' : 'Приложение ищет в стандартных папках'}>
            <span>{d.effectiveRecordingsPath ?? 'стандартная'}</span>
          </Tooltip>
          {d.active && (
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => { setPathFor(d); setPathValue(d.recordingsPathOverride ?? ''); }}>
              Изменить для телефона
            </Button>
          )}
        </Space>
      ),
    },
    {
      key: 'actions',
      render: (_, d) => (
        <Space wrap>
          {d.active && (
            <Popconfirm title="Отвязать телефон? Приложение перестанет отправлять звонки, пока сотрудник не войдёт снова." onConfirm={() => revoke.mutate(d.id)}>
              <Button size="small" danger>Отвязать</Button>
            </Popconfirm>
          )}
          {d.active && (
            <Button size="small" disabled={d.uploadLogsRequested} onClick={() => requestLogs.mutate(d.id)}>
              {d.uploadLogsRequested ? 'Лог запрошен' : 'Запросить лог'}
            </Button>
          )}
          {d.hasLog && <Button size="small" onClick={() => downloadLog(d.id)}>Скачать лог</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>Телефоны (CallSync)</Typography.Title>

      <Table<MobileDeviceRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={data?.devices ?? []}
        pagination={false}
        scroll={{ x: 1100 }}
        onRow={(d) => ({ style: { opacity: d.active ? 1 : 0.55, background: d.active && (d.silent || d.problems.length > 0) ? token.colorErrorBg : undefined } })}
        locale={{ emptyText: 'Телефоны ещё не привязаны. Сотрудник привязывает телефон в своём профиле.' }}
      />

      <Card size="small" title="Папка записей по модели телефона" style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Путь от корня памяти телефона, несколько — через «;». Пусто — приложение ищет в стандартных папках Samsung и MIUI.
          Путь для конкретного телефона главнее пути для модели.
        </Typography.Paragraph>
        <Table
          size="small"
          rowKey="model"
          pagination={false}
          dataSource={models}
          columns={[
            { title: 'Модель', dataIndex: 'model' },
            { title: 'Телефонов', dataIndex: 'devicesCount', width: 100 },
            { title: 'Папка записей', dataIndex: 'recordingsPath', render: (v: string | null) => v ?? <Typography.Text type="secondary">стандартная</Typography.Text> },
            {
              key: 'edit',
              width: 120,
              render: (_, m) => <Button size="small" onClick={() => setModelPath({ model: m.model, path: m.recordingsPath ?? '' })}>Изменить</Button>,
            },
          ]}
        />
      </Card>

      {settings && (
        <Card size="small" title="Настройки" style={{ marginTop: 16 }}>
          <Form
            layout="vertical"
            initialValues={settings}
            onFinish={(v) => saveSettings.mutate(v)}
            style={{ maxWidth: 640 }}
          >
            <Space wrap size={16}>
              <Form.Item name="workStartHour" label="Рабочий день с (час)"><InputNumber min={0} max={23} /></Form.Item>
              <Form.Item name="workEndHour" label="до (час)"><InputNumber min={1} max={24} /></Form.Item>
            </Space>
            <Form.Item name="workDays" label="Рабочие дни (алерты руководителю — только в рабочее время)">
              <Checkbox.Group options={WEEK_DAYS} />
            </Form.Item>
            <Space wrap size={16}>
              <Form.Item name="syncIntervalMin" label="Синхронизация, мин"><InputNumber min={15} max={1440} /></Form.Item>
              <Form.Item name="wifiOnlyAboveMb" label="Только по Wi-Fi файлы больше, МБ"><InputNumber min={0} max={1000} /></Form.Item>
              <Form.Item name="minAuditDurationSec" label="Анализировать звонки от, с"><InputNumber min={0} max={3600} /></Form.Item>
            </Space>
            <Form.Item name="autoAuditEnabled" label="Автоматический аудит записей" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={saveSettings.isPending}>Сохранить</Button>
          </Form>
        </Card>
      )}

      <Modal
        title={`Папка записей: ${pathFor?.user.fullName ?? ''}`}
        open={!!pathFor}
        onCancel={() => setPathFor(null)}
        onOk={() => pathFor && savePath.mutate({ id: pathFor.id, path: pathValue.trim() })}
        okButtonProps={{ loading: savePath.isPending }}
        okText="Сохранить"
      >
        <Typography.Paragraph type="secondary">
          Пусто — использовать путь для модели {pathFor?.model ? `«${pathFor.model}»` : ''} или стандартные папки.
        </Typography.Paragraph>
        <Input value={pathValue} onChange={(e) => setPathValue(e.target.value)} placeholder="Recordings/Call" />
      </Modal>

      <Modal
        title={`Папка записей для модели ${modelPath?.model ?? ''}`}
        open={!!modelPath}
        onCancel={() => setModelPath(null)}
        onOk={() => modelPath && saveModelPath.mutate({ model: modelPath.model, path: modelPath.path.trim() })}
        okButtonProps={{ loading: saveModelPath.isPending }}
        okText="Сохранить"
      >
        <Input
          value={modelPath?.path ?? ''}
          onChange={(e) => setModelPath((m) => (m ? { ...m, path: e.target.value } : m))}
          placeholder="Recordings/Call"
        />
      </Modal>
    </div>
  );
}
