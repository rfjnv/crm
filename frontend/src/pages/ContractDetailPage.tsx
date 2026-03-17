import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography, Descriptions, Tag, Table, Card, Statistic, Row, Col, Space,
  Timeline, Button, Upload, message, Popconfirm, Spin, Empty, Divider, Modal, Input, Dropdown,
  Form, DatePicker,
} from 'antd';
import {
  FilePdfOutlined, UploadOutlined, DeleteOutlined,
  FileTextOutlined, FileImageOutlined, FileZipOutlined,
  ArrowLeftOutlined, ExclamationCircleOutlined, DownOutlined,
  OrderedListOutlined, DollarOutlined, SolutionOutlined,
  CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined,
  CalculatorOutlined, PlusOutlined, PrinterOutlined, EditOutlined,
} from '@ant-design/icons';
import { theme } from 'antd';
import dayjs from 'dayjs';
import { contractsApi } from '../api/contracts.api';
import { poaApi } from '../api/power-of-attorney.api';
import type { PowerOfAttorney, CreatePoaData } from '../api/power-of-attorney.api';
import { formatUZS, moneyFormatter } from '../utils/currency';
import { VAT_RATE } from '../utils/vat';
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
  const { token: tk } = theme.useToken();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showVat, setShowVat] = useState(false);
  const [poaModalOpen, setPoaModalOpen] = useState(false);
  const [poaForm] = Form.useForm();

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

  const { data: poas } = useQuery({
    queryKey: ['poas', id],
    queryFn: () => poaApi.list(id!),
    enabled: !!id,
  });

  const createPoaMut = useMutation({
    mutationFn: (data: CreatePoaData) => poaApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['poas', id] });
      message.success('Доверенность создана');
      setPoaModalOpen(false);
      poaForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка создания';
      message.error(msg);
    },
  });

  const deletePoaMut = useMutation({
    mutationFn: (poaId: string) => poaApi.delete(poaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['poas', id] });
      message.success('Доверенность удалена');
    },
    onError: () => message.error('Ошибка удаления доверенности'),
  });

  function handlePoaPrint(poaId: string) {
    const printUrl = poaApi.getPrintUrl(poaId);
    const token = useAuthStore.getState().accessToken;
    fetch(printUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((blob) => { window.open(URL.createObjectURL(blob), '_blank'); })
      .catch(() => message.error('Ошибка генерации PDF'));
  }

  // Flatten all deal items for the items table
  const allItems = useMemo(() => {
    if (!contract?.deals) return [];
    return contract.deals.flatMap((d) =>
      (d.items ?? []).map((item) => {
        const qty = Number(item.requestedQty) || 0;
        const price = Number(item.price) || 0;
        const sum = qty * price;
        const vatAmount = Math.round(sum * VAT_RATE * 100) / 100;
        const sumWithVat = sum + vatAmount;
        return {
          key: `${d.id}-${item.id}`,
          dealTitle: d.title || d.id.slice(0, 8),
          name: item.product.name,
          sku: item.product.sku,
          unit: item.product.unit,
          qty,
          price,
          sum,
          vatAmount,
          sumWithVat,
        };
      })
    );
  }, [contract?.deals]);

  const itemsTotal = useMemo(() => allItems.reduce((s, i) => s + i.sum, 0), [allItems]);
  const vatTotal = useMemo(() => allItems.reduce((s, i) => s + i.vatAmount, 0), [allItems]);

  function handlePrint(docType?: string) {
    setPdfLoading(true);
    const printUrl = contractsApi.getPrintUrl(id!, docType);
    const token = useAuthStore.getState().accessToken;
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
      .catch(() => message.error('Ошибка генерации PDF'))
      .finally(() => setPdfLoading(false));
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

  const docCards = [
    ...(isAnnual ? [{ key: 'CONTRACT', label: 'Договор', icon: <FileTextOutlined />, ready: true }] : []),
    { key: 'SPECIFICATION', label: 'Спецификация', icon: <OrderedListOutlined />, ready: allItems.length > 0 },
    { key: 'INVOICE', label: 'Счёт-фактура', icon: <DollarOutlined />, ready: allItems.length > 0 },
    { key: 'POWER_OF_ATTORNEY', label: 'Доверенность', icon: <SolutionOutlined />, ready: true },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Link to="/contracts"><Button icon={<ArrowLeftOutlined />}>Договоры</Button></Link>
        <Dropdown.Button
          icon={<DownOutlined />}
          type="primary"
          loading={pdfLoading}
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

        <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small" style={{ marginBottom: 24 }}>
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
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic title="Сумма договора" value={Number(contract.amount)} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic title="Сумма сделок" value={contract.totalAmount} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic title="Оплачено" value={contract.totalPaid} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" valueStyle={{ color: '#52c41a' }} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
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
          scroll={{ x: 600 }}
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

        {/* Items / Products Table */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>Товары / услуги ({allItems.length})</Typography.Title>
          {canManage && (
            <Button size="small" type={showVat ? 'primary' : 'default'} icon={<CalculatorOutlined />} onClick={() => setShowVat(!showVat)}>НДС 12%</Button>
          )}
        </div>
        {allItems.length === 0 ? (
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>Нет товаров в сделках</Typography.Text>
        ) : (
          <Table
            dataSource={allItems}
            rowKey="key"
            size="small"
            pagination={false}
            style={{ marginBottom: 24 }}
            scroll={{ x: 600 }}
            columns={[
              { title: '#', width: 50, render: (_: unknown, __: unknown, i: number) => i + 1 },
              { title: 'Наименование', dataIndex: 'name' },
              { title: 'Артикул', dataIndex: 'sku', width: 120 },
              { title: 'Ед. изм.', dataIndex: 'unit', width: 80 },
              { title: 'Кол-во', dataIndex: 'qty', width: 80, align: 'right' as const },
              { title: 'Цена', dataIndex: 'price', width: 120, align: 'right' as const, render: (v: number) => formatUZS(v) },
              { title: 'Сумма', dataIndex: 'sum', width: 120, align: 'right' as const, render: (v: number) => formatUZS(v) },
              ...(showVat ? [
                { title: 'НДС %', width: 80, align: 'center' as const, render: () => '12%' },
                { title: 'Сумма НДС', dataIndex: 'vatAmount', width: 120, align: 'right' as const, render: (v: number) => formatUZS(v) },
                { title: 'С НДС', dataIndex: 'sumWithVat', width: 130, align: 'right' as const, render: (v: number) => formatUZS(v) },
              ] : []),
              { title: 'Сделка', dataIndex: 'dealTitle', width: 140, ellipsis: true },
            ]}
            summary={() => (
              <>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={showVat ? 8 : 6} align="right"><strong>Без НДС:</strong></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><strong>{formatUZS(itemsTotal)}</strong></Table.Summary.Cell>
                  {showVat && <Table.Summary.Cell index={2} />}
                </Table.Summary.Row>
                {showVat && (
                  <>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={8} align="right"><strong>НДС 12%:</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right"><strong>{formatUZS(vatTotal)}</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} />
                    </Table.Summary.Row>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={8} align="right"><strong>Итого с НДС:</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right"><strong>{formatUZS(itemsTotal + vatTotal)}</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} />
                    </Table.Summary.Row>
                  </>
                )}
              </>
            )}
          />
        )}

        {/* Documents Readiness */}
        <Typography.Title level={5}>Документы</Typography.Title>
        <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
          {docCards.map((doc) => (
            <Col key={doc.key} xs={12} sm={8} md={6}>
              <Card
                size="small"
                style={{ textAlign: 'center', borderColor: doc.ready ? tk.colorSuccessBorder : tk.colorErrorBorder }}
                styles={{ body: { padding: '12px 8px' } }}
              >
                <div style={{ fontSize: 24, color: doc.ready ? '#52c41a' : '#ff4d4f', marginBottom: 4 }}>
                  {doc.icon}
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{doc.label}</div>
                <div style={{ marginBottom: 8 }}>
                  {doc.ready ? (
                    <Tag color="success" icon={<CheckCircleOutlined />}>Готов</Tag>
                  ) : (
                    <Tag color="error" icon={<CloseCircleOutlined />}>Нет данных</Tag>
                  )}
                </div>
                <Button
                  type="link"
                  size="small"
                  icon={<DownloadOutlined />}
                  disabled={!doc.ready || pdfLoading}
                  loading={pdfLoading}
                  onClick={() => handlePrint(doc.key)}
                >
                  Скачать
                </Button>
              </Card>
            </Col>
          ))}
          <Col xs={12} sm={8} md={6}>
            <Card
              size="small"
              style={{ textAlign: 'center', borderColor: tk.colorInfoBorder }}
              styles={{ body: { padding: '12px 8px' } }}
            >
              <div style={{ fontSize: 24, color: tk.colorPrimary, marginBottom: 4 }}>
                <FilePdfOutlined />
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Полный комплект</div>
              <div style={{ marginBottom: 8 }}>
                <Tag color="processing">{isAnnual ? '4 документа' : '2 документа'}</Tag>
              </div>
              <Button
                type="link"
                size="small"
                icon={<DownloadOutlined />}
                disabled={pdfLoading}
                loading={pdfLoading}
                onClick={() => handlePrint('PACKAGE')}
              >
                Скачать
              </Button>
            </Card>
          </Col>
        </Row>

        {/* Powers of Attorney */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>Доверенности ({poas?.length || 0})</Typography.Title>
          {canManage && (
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setPoaModalOpen(true)}>
              Создать
            </Button>
          )}
        </div>
        {(!poas || poas.length === 0) ? (
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>Нет доверенностей</Typography.Text>
        ) : (
          <Table
            dataSource={poas}
            rowKey="id"
            size="small"
            pagination={false}
            style={{ marginBottom: 24 }}
            scroll={{ x: 600 }}
            columns={[
              { title: '№', dataIndex: 'poaNumber', width: 140 },
              { title: 'Тип', dataIndex: 'poaType', width: 100, render: (v: string) => <Tag color={v === 'ANNUAL' ? 'blue' : 'default'}>{v === 'ANNUAL' ? 'Годовая' : 'Разовая'}</Tag> },
              { title: 'Доверенное лицо', dataIndex: 'authorizedPersonName' },
              { title: 'Должность', dataIndex: 'authorizedPersonPosition', render: (v: string | null) => v || '—' },
              { title: 'С', dataIndex: 'validFrom', width: 110, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
              { title: 'По', dataIndex: 'validUntil', width: 110, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
              {
                title: 'Действия', width: 120, render: (_: unknown, r: PowerOfAttorney) => (
                  <Space size="small">
                    <Button type="link" size="small" icon={<PrinterOutlined />} onClick={() => handlePoaPrint(r.id)} />
                    {canDelete && (
                      <Popconfirm title="Удалить доверенность?" onConfirm={() => deletePoaMut.mutate(r.id)}>
                        <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}

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
                  <div style={{ fontSize: 12, color: tk.colorTextSecondary }}>
                    <span>Сделка: {p.deal?.title || p.dealId}</span>
                    {p.method && <span> · {p.method}</span>}
                    <span> · {p.creator?.fullName}</span>
                  </div>
                  {p.note && <div style={{ fontSize: 12, color: tk.colorTextTertiary }}>{p.note}</div>}
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

      {/* Create PoA Modal */}
      <Modal
        title="Новая доверенность"
        open={poaModalOpen}
        onCancel={() => { setPoaModalOpen(false); poaForm.resetFields(); }}
        onOk={() => poaForm.submit()}
        confirmLoading={createPoaMut.isPending}
        okText="Создать"
        cancelText="Отмена"
      >
        <Form
          form={poaForm}
          layout="vertical"
          onFinish={(v) => createPoaMut.mutate({
            contractId: id!,
            poaNumber: v.poaNumber,
            poaType: v.poaType || contract?.contractType || 'ANNUAL',
            authorizedPersonName: v.authorizedPersonName,
            authorizedPersonInn: v.authorizedPersonInn,
            authorizedPersonPosition: v.authorizedPersonPosition,
            validFrom: v.validFrom.format('YYYY-MM-DD'),
            validUntil: v.validUntil.format('YYYY-MM-DD'),
            notes: v.notes,
          })}
        >
          <Form.Item name="poaNumber" label="Номер доверенности" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input placeholder="ДВР-001" />
          </Form.Item>
          <Form.Item name="poaType" label="Тип" initialValue={contract?.contractType || 'ANNUAL'}>
            <Input disabled value={contract?.contractType === 'ANNUAL' ? 'Годовая' : 'Разовая'} />
          </Form.Item>
          <Form.Item name="authorizedPersonName" label="ФИО доверенного лица" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input placeholder="Иванов Иван Иванович" />
          </Form.Item>
          <Form.Item name="authorizedPersonPosition" label="Должность">
            <Input placeholder="Менеджер по закупкам" />
          </Form.Item>
          <Form.Item name="authorizedPersonInn" label="ИНН доверенного лица">
            <Input placeholder="123456789" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="validFrom" label="Действует с" rules={[{ required: true, message: 'Обязательное поле' }]} style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="validUntil" label="Действует до" rules={[{ required: true, message: 'Обязательное поле' }]} style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="Примечание">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
