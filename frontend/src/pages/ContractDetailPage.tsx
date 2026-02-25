import { useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography, Descriptions, Tag, Table, Card, Statistic, Row, Col, Space,
  Timeline, Button, Upload, message, Popconfirm, Spin, Empty, Divider,
} from 'antd';
import {
  PrinterOutlined, UploadOutlined, DeleteOutlined,
  FileTextOutlined, FilePdfOutlined, FileImageOutlined, FileZipOutlined,
  DollarOutlined, ArrowLeftOutlined,
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
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';

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

  const deleteMut = useMutation({
    mutationFn: (attachmentId: string) => contractsApi.deleteAttachment(id!, attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-detail', id] });
      message.success('Файл удалён');
    },
    onError: () => message.error('Ошибка удаления'),
  });

  function handlePrint() {
    window.print();
  }

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!contract) return <Empty description="Договор не найден" />;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Link to="/contracts"><Button icon={<ArrowLeftOutlined />}>Договоры</Button></Link>
        <Button icon={<PrinterOutlined />} onClick={handlePrint}>Печать</Button>
      </Space>

      <div ref={printRef}>
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
        <Typography.Title level={5}>Сделки ({contract.deals?.length || 0})</Typography.Title>
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
                  <Popconfirm title="Удалить вложение?" onConfirm={() => deleteMut.mutate(att.id)}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
