import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography, Descriptions, Tag, Table, Card, Statistic, Row, Col, Space,
  Timeline, Button, Upload, message, Popconfirm, Spin, Empty, Divider, Modal, Input, Dropdown,
} from 'antd';
import {
  FilePdfOutlined, UploadOutlined, DeleteOutlined,
  FileTextOutlined, FileImageOutlined, FileZipOutlined,
  ArrowLeftOutlined, ExclamationCircleOutlined, DownOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { contractsApi } from '../api/contracts.api';
import { formatUZS, moneyFormatter } from '../utils/currency';
import DealStatusTag from '../components/DealStatusTag';
import { useAuthStore } from '../store/authStore';
import type { ContractAttachment, DealStatus } from '../types';

const BACKEND_URL = import.meta.env.VITE_API_URL
  ? new URL(import.meta.env.VITE_API_URL).origin
  : '';

function fileIcon(mimeType: string) {
  if (mimeType === 'application/pdf') return <FilePdfOutlined />;
  if (mimeType.startsWith('image/')) return <FileImageOutlined />;
  if (mimeType.includes('zip')) return <FileZipOutlined />;
  return <FileTextOutlined />;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function canPreview(mimeType: string) {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/');
}

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';
  const canDelete = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');

  const { data: contract, isLoading } = useQuery({
    queryKey: ['contract-detail', id],
    queryFn: () => contractsApi.getById(id!),
    enabled: !!id,
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => contractsApi.uploadAttachment(id!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-detail', id] });
      message.success('Файл загружен');
    },
    onError: () => message.error('Ошибка загрузки файла'),
  });

  const deleteAttMut = useMutation({
    mutationFn: (attachmentId: string) => contractsApi.deleteAttachment(id!, attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-detail', id] });
      message.success('Файл удалён');
    },
    onError: () => message.error('Ошибка удаления'),
  });

  const softDeleteMut = useMutation({
    mutationFn: ({ contractId, reason }: { contractId: string; reason: string }) =>
      contractsApi.softDelete(contractId, reason),
    onSuccess: () => {
      message.success('Договор удалён');
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      navigate('/contracts');
    },
    onError: () => message.error('Ошибка удаления договора'),
  });

  const hardDeleteMut = useMutation({
    mutationFn: (contractId: string) => contractsApi.hardDelete(contractId),
    onSuccess: () => {
      message.success('Договор удалён безвозвратно');
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      navigate('/contracts');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка удаления';
      message.error(msg);
    },
  });

  function handlePrint(docType?: string) {
    const printUrl = contractsApi.getPrintUrl(id!, docType);
    const token = useAuthStore.getState().accessToken;
    // Open PDF in new tab with auth
    fetch(printUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('PDF generation failed');
        return r.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      })
      .catch(() => message.error('Ошибка генерации PDF'));
  }

  function handleSoftDelete() {
    if (!deleteReason.trim()) {
      message.warning('Укажите причину удаления');
      return;
    }
    softDeleteMut.mutate({ contractId: id!, reason: deleteReason.trim() });
  }

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!contract) return <Empty description="Договор не найден" />;

  const dealsCount = contract.deals?.length || 0;
  const isAnnual = contract.contractType === 'ANNUAL';

  const pdfMenuItems = [
    ...(isAnnual ? [{ key: 'CONTRACT', label: 'Договор' }] : []),
    { key: 'SPECIFICATION', label: 'Спецификация' },
    { key: 'INVOICE', label: 'Счёт-фактура' },
    { key: 'POWER_OF_ATTORNEY', label: 'Доверенность' },
    { type: 'divider' as const },
    { key: 'PACKAGE', label: 'Полный комплект' },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Link to="/contracts"><Button icon={<ArrowLeftOutlined />}>Договоры</Button></Link>
        <Dropdown.Button
          icon={<DownOutlined />}
          type="primary"
          onClick={() => handlePrint('PACKAGE')}
          menu={{
            items: pdfMenuItems,
            onClick: ({ key }) => handlePrint(key),
          }}
        >
          <FilePdfOutlined /> Скачать комплект
        </Dropdown.Button>
        {canDelete && (
          <Button danger onClick={() => setDeleteModalOpen(true)} icon={<DeleteOutlined />}>
            Удалить
          </Button>
        )}
      </Space>

      <div>
        <Typography.Title level={4} style={{ marginBottom: 16 }}>
          Договор {contract.contractNumber}
        </Typography.Title>

        <Descriptions column={2} bordered size="small" style={{ marginBottom: 24 }}>
          <Descriptions.Item label="Клиент">
            <Link to={`/clients/${contract.clientId}`}>{contract.client?.companyName}</Link>
          </Descriptions.Item>
          <Descriptions.Item label="Статус">
            <Tag color={contract.isActive ? 'green' : 'red'}>{contract.isActive ? 'Активен' : 'Закрыт'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Тип договора">
            <Tag color={contract.contractType === 'ANNUAL' ? 'blue' : 'default'}>
              {contract.contractType === 'ANNUAL' ? 'Годовой' : 'Разовый'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Дата начала">{dayjs(contract.startDate).format('DD.MM.YYYY')}</Descriptions.Item>
          <Descriptions.Item label="Дата окончания">{contract.endDate ? dayjs(contract.endDate).format('DD.MM.YYYY') : '—'}</Descriptions.Item>
          {contract.notes && <Descriptions.Item label="Примечание" span={2}>{contract.notes}</Descriptions.Item>}
        </Descriptions>

        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Сумма договора" value={Number(contract.amount)} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Сумма сделок" value={contract.totalAmount} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Оплачено" value={contract.totalPaid} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" valueStyle={{ color: '#52c41a' }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Остаток" value={contract.remaining} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" valueStyle={{ color: contract.remaining > 0 ? '#ff4d4f' : '#52c41a' }} />
            </Card>
          </Col>
        </Row>

        {/* Deals */}
        <Typography.Title level={5}>Сделки ({dealsCount})</Typography.Title>
        <Table
          dataSource={contract.deals || []}
          rowKey="id"
          size="small"
          pagination={false}
          style={{ marginBottom: 24 }}
          columns={[
            { title: 'Сделка', dataIndex: 'title', render: (v: string, r) => <Link to={`/deals/${r.id}`}>{v || r.id.slice(0, 8)}</Link> },
            { title: 'Статус', dataIndex: 'status', width: 140, render: (v: DealStatus) => <DealStatusTag status={v} /> },
            { title: 'Сумма', dataIndex: 'amount', width: 120, align: 'right' as const, render: (v: string) => formatUZS(v) },
            { title: 'Оплачено', dataIndex: 'paidAmount', width: 120, align: 'right' as const, render: (v: string) => formatUZS(v) },
            {
              title: 'Статус оплаты', dataIndex: 'paymentStatus', width: 120, render: (v: string) => {
                const cfg: Record<string, { color: string; label: string }> = {
                  UNPAID: { color: 'default', label: 'Не оплачено' },
                  PARTIAL: { color: 'orange', label: 'Частично' },
                  PAID: { color: 'green', label: 'Оплачено' },
                };
                const c = cfg[v] || { color: 'default', label: v };
                return <Tag color={c.color}>{c.label}</Tag>;
              }
            },
          ]}
        />

        {/* Payments */}
        <Typography.Title level={5}>История платежей ({contract.payments?.length || 0})</Typography.Title>
        {(!contract.payments || contract.payments.length === 0) ? (
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>Нет платежей</Typography.Text>
        ) : (
          <Timeline
            style={{ marginBottom: 24 }}
            items={contract.payments.map((p) => ({
              color: 'green',
              children: (
                <div key={p.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{formatUZS(p.amount)}</strong>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(p.paidAt).format('DD.MM.YYYY HH:mm')}
                    </Typography.Text>
                  </div>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    <span>Сделка: {p.deal?.title || p.dealId}</span>
                    {p.method && <span> · {p.method}</span>}
                    <span> · {p.creator?.fullName}</span>
                  </div>
                  {p.note && <div style={{ fontSize: 12, color: '#999' }}>{p.note}</div>}
                </div>
              ),
            }))}
          />
        )}
      </div>

      <Divider />

      {/* Attachments */}
      <Typography.Title level={5}>
        Вложения ({contract.attachments?.length || 0})
      </Typography.Title>

      {canManage && (
        <Upload
          beforeUpload={(file) => {
            uploadMut.mutate(file);
            return false;
          }}
          showUploadList={false}
          accept=".pdf,.jpg,.jpeg,.png,.zip"
        >
          <Button icon={<UploadOutlined />} loading={uploadMut.isPending} style={{ marginBottom: 12 }}>
            Загрузить файл
          </Button>
        </Upload>
      )}

      {(!contract.attachments || contract.attachments.length === 0) ? (
        <Typography.Text type="secondary">Нет вложений</Typography.Text>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contract.attachments.map((att: ContractAttachment) => (
            <Card key={att.id} size="small" style={{ maxWidth: 700 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  {fileIcon(att.mimeType)}
                  <div>
                    <div>
                      {canPreview(att.mimeType) ? (
                        <a href={`${BACKEND_URL}/${att.path}`} target="_blank" rel="noopener noreferrer">
                          {att.filename}
                        </a>
                      ) : (
                        <a href={`${BACKEND_URL}/${att.path}`} download>{att.filename}</a>
                      )}
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {formatSize(att.size)} · {att.uploader?.fullName} · {dayjs(att.createdAt).format('DD.MM.YYYY HH:mm')}
                    </Typography.Text>
                  </div>
                </Space>
                {canManage && (
                  <Popconfirm title="Удалить вложение?" onConfirm={() => deleteAttMut.mutate(att.id)}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Contract Modal */}
      <Modal
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
            Удаление договора
          </Space>
        }
        open={deleteModalOpen}
        onCancel={() => { setDeleteModalOpen(false); setDeleteReason(''); }}
        footer={[
          <Button key="cancel" onClick={() => { setDeleteModalOpen(false); setDeleteReason(''); }}>
            Отмена
          </Button>,
          <Button
            key="soft"
            danger
            loading={softDeleteMut.isPending}
            onClick={handleSoftDelete}
            disabled={!deleteReason.trim()}
          >
            Удалить (мягкое)
          </Button>,
          ...(isSuperAdmin && dealsCount === 0 ? [
            <Popconfirm
              key="hard"
              title="Безвозвратное удаление. Вы уверены?"
              onConfirm={() => hardDeleteMut.mutate(id!)}
            >
              <Button danger type="primary" loading={hardDeleteMut.isPending}>
                Удалить навсегда
              </Button>
            </Popconfirm>,
          ] : []),
        ]}
      >
        <Typography.Paragraph>
          Договор <strong>{contract.contractNumber}</strong> будет помечен как удалённый.
        </Typography.Paragraph>
        {isSuperAdmin && dealsCount === 0 && (
          <Typography.Paragraph type="warning">
            Как SUPER_ADMIN, вы также можете удалить договор безвозвратно (нет привязанных сделок).
          </Typography.Paragraph>
        )}
        {dealsCount > 0 && (
          <Typography.Paragraph type="secondary">
            Безвозвратное удаление недоступно: привязано {dealsCount} сделок.
          </Typography.Paragraph>
        )}
        <Input.TextArea
          rows={3}
          placeholder="Причина удаления (обязательно)"
          value={deleteReason}
          onChange={(e) => setDeleteReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
