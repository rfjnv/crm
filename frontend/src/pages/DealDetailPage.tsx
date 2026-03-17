import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Descriptions, Typography, Spin, Timeline, Tag, Space, Input, Button,
  List, Table, message, InputNumber, Form, Modal, Popconfirm, DatePicker, Tabs,
  Select, Alert, Radio, Tooltip, Collapse,
} from 'antd';
import {
  SendOutlined, PlusOutlined, DeleteOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ArrowRightOutlined, ArrowLeftOutlined, EditOutlined, DollarOutlined,
  FileTextOutlined, LinkOutlined, ThunderboltOutlined, AuditOutlined, CalculatorOutlined,
} from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { adminApi } from '../api/admin.api';
import { inventoryApi } from '../api/warehouse.api';
import { usersApi } from '../api/users.api';
import { clientsApi } from '../api/clients.api';
import { contractsApi } from '../api/contracts.api';
import DealStatusTag from '../components/DealStatusTag';
import DealPipeline from '../components/DealPipeline';
import SuperOverrideModal from '../components/SuperOverrideModal';
import AuditHistoryPanel from '../components/AuditHistoryPanel';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuthStore } from '../store/authStore';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { DealStatus, Deal, DealItem, PaymentStatus, DealHistoryEntry, UserRole, PaymentMethod, ContractListItem, PaymentRecord } from '../types';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'Наличные',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  TRANSFER: 'Перечисление',
  INSTALLMENT: 'Рассрочка',
};

/** Format qty: integers without .0, decimals up to 3 digits */
function formatQty(value: number | string | null | undefined): string {
  if (value == null) return '—';
  const n = Number(value);
  if (isNaN(n)) return '—';
  if (Number.isInteger(n)) return n.toString();
  return parseFloat(n.toFixed(3)).toString();
}

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [comment, setComment] = useState('');
  const [itemModal, setItemModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [warehouseResponseModal, setWarehouseResponseModal] = useState(false);
  const [setQuantitiesModal, setSetQuantitiesModal] = useState(false);
  const [shipmentModal, setShipmentModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [paymentRecordModal, setPaymentRecordModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState<{ id: string } | null>(null);
  const [sendToFinanceModal, setSendToFinanceModal] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);
  const [createContractModal, setCreateContractModal] = useState(false);
  const [attachContractModal, setAttachContractModal] = useState(false);
  const [overrideModal, setOverrideModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmModal, setDeleteConfirmModal] = useState(false);
  const [showVat, setShowVat] = useState(false);
  const [itemForm] = Form.useForm();
  const [paymentForm] = Form.useForm();
  const [paymentRecordForm] = Form.useForm();
  const [warehouseForm] = Form.useForm();
  const [quantitiesForm] = Form.useForm();
  const [shipmentForm] = Form.useForm();
  const [contractForm] = Form.useForm();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = user?.role as UserRole | undefined;
  const isMobile = useIsMobile();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['deal', id] });
    queryClient.invalidateQueries({ queryKey: ['deal-logs', id] });
    queryClient.invalidateQueries({ queryKey: ['deal-history', id] });
    queryClient.invalidateQueries({ queryKey: ['deal-payments', id] });
  };

  const { data: dealData, isLoading } = useQuery({
    queryKey: ['deal', id],
    queryFn: () => dealsApi.getById(id!),
    enabled: !!id,
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
    enabled: role === 'SUPER_ADMIN' || role === 'ADMIN',
  });

  const { data: history } = useQuery({
    queryKey: ['deal-history', id],
    queryFn: () => dealsApi.getHistory(id!),
    enabled: !!id,
  });

  const { data: dealPayments } = useQuery({
    queryKey: ['deal-payments', id],
    queryFn: () => dealsApi.getDealPayments(id!),
    enabled: !!id,
  });

  // Contracts for the deal's client (for attach modal)
  const needsContract = dealData?.paymentMethod === 'QR' || dealData?.paymentMethod === 'INSTALLMENT' || dealData?.paymentMethod === 'TRANSFER';
  const canManageContract = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'ACCOUNTANT';

  const isSuperAdmin = role === 'SUPER_ADMIN';

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
    enabled: isSuperAdmin,
  });

  const { data: clientContracts } = useQuery({
    queryKey: ['client-contracts', dealData?.clientId],
    queryFn: () => contractsApi.list(dealData!.clientId),
    enabled: !!dealData?.clientId && needsContract && canManageContract,
  });

  // ──── Mutations ────

  const statusMut = useMutation({
    mutationFn: (status: DealStatus) => dealsApi.update(id!, { status }),
    onMutate: async (newStatus: DealStatus) => {
      await queryClient.cancelQueries({ queryKey: ['deal', id] });
      const prev = queryClient.getQueryData<Deal>(['deal', id]);
      if (prev) {
        queryClient.setQueryData<Deal>(['deal', id], { ...prev, status: newStatus });
      }
      return { prev };
    },
    onError: (err: unknown, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['deal', id], context.prev);
      }
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка обновления статуса';
      message.error(msg);
    },
    onSettled: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ['deals'] }); },
    onSuccess: () => { message.success('Статус обновлён'); },
  });

  const commentMut = useMutation({
    mutationFn: (text: string) => dealsApi.addComment(id!, text),
    onSuccess: () => { invalidate(); setComment(''); message.success('Комментарий добавлен'); },
  });

  const addItemMut = useMutation({
    mutationFn: (data: { productId: string; requestComment?: string }) => dealsApi.addItem(id!, data),
    onSuccess: () => { invalidate(); setItemModal(false); itemForm.resetFields(); message.success('Товар добавлен'); },
    onError: () => message.error('Ошибка добавления товара'),
  });

  const removeItemMut = useMutation({
    mutationFn: (itemId: string) => dealsApi.removeItem(id!, itemId),
    onSuccess: () => { invalidate(); message.success('Товар удалён'); },
  });

  const paymentMut = useMutation({
    mutationFn: (data: { paidAmount: number; paymentType?: 'FULL' | 'PARTIAL' | 'INSTALLMENT'; dueDate?: string | null; terms?: string | null }) => dealsApi.updatePayment(id!, data),
    onSuccess: () => { invalidate(); setPaymentModal(false); message.success('Оплата обновлена'); },
    onError: () => message.error('Ошибка обновления оплаты'),
  });

  const warehouseResponseMut = useMutation({
    mutationFn: (items: { dealItemId: string; warehouseComment: string }[]) =>
      dealsApi.submitWarehouseResponse(id!, items),
    onSuccess: () => { invalidate(); setWarehouseResponseModal(false); warehouseForm.resetFields(); message.success('Ответ склада отправлен'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const setQuantitiesMut = useMutation({
    mutationFn: (data: {
      items: { dealItemId: string; requestedQty: number; price: number }[];
      discount?: number;
      paymentType?: 'FULL' | 'PARTIAL' | 'INSTALLMENT';
      paidAmount?: number;
      dueDate?: string;
      terms?: string;
    }) => dealsApi.setItemQuantities(id!, data),
    onSuccess: () => { invalidate(); setSetQuantitiesModal(false); quantitiesForm.resetFields(); message.success('Количества и цены установлены'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const sendToFinanceMut = useMutation({
    mutationFn: (paymentMethod: PaymentMethod) => dealsApi.sendToFinance(id!, paymentMethod),
    onSuccess: (result) => {
      invalidate();
      setSendToFinanceModal(false);
      setSelectedPaymentMethod(null);
      const skipped = result.status === 'ADMIN_APPROVED';
      message.success(skipped ? 'Отправлено на одобрение админа (финансы не требуются)' : 'Отправлено на проверку финансов');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const financeApproveMut = useMutation({
    mutationFn: () => dealsApi.approveFinance(id!),
    onSuccess: () => { invalidate(); message.success('Финансы одобрены'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const financeRejectMut = useMutation({
    mutationFn: (reason: string) => dealsApi.rejectFinance(id!, reason),
    onSuccess: () => { invalidate(); setRejectModal(false); setRejectReason(''); message.success('Сделка отклонена'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const adminApproveMut = useMutation({
    mutationFn: () => dealsApi.approveAdmin(id!),
    onSuccess: () => { invalidate(); message.success('Админ одобрил'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const shipmentMut = useMutation({
    mutationFn: (data: { vehicleType: string; vehicleNumber: string; driverName: string; departureTime: string; deliveryNoteNumber: string; shipmentComment?: string }) =>
      dealsApi.submitShipment(id!, data),
    onSuccess: () => { invalidate(); setShipmentModal(false); shipmentForm.resetFields(); message.success('Отгрузка оформлена, сделка закрыта'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка оформления отгрузки';
      message.error(msg);
    },
  });

  const releaseHoldMut = useMutation({
    mutationFn: () => dealsApi.releaseShipmentHold(id!),
    onSuccess: () => { invalidate(); message.success('Сделка возвращена в очередь на отгрузку'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const managerMut = useMutation({
    mutationFn: (managerId: string) => dealsApi.update(id!, { managerId }),
    onSuccess: () => { invalidate(); message.success('Менеджер изменён'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка смены менеджера';
      message.error(msg);
    },
  });

  const paymentRecordMut = useMutation({
    mutationFn: (data: { amount: number; method?: string; note?: string; paidAt?: string }) =>
      dealsApi.createPayment(id!, data),
    onSuccess: () => { invalidate(); setPaymentRecordModal(false); setEditingPayment(null); paymentRecordForm.resetFields(); message.success('Платёж добавлен'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка добавления платежа';
      message.error(msg);
    },
  });

  const updatePaymentRecordMut = useMutation({
    mutationFn: (data: { paymentId: string; amount?: number; method?: string | null; note?: string | null; paidAt?: string }) => {
      const { paymentId, ...rest } = data;
      return dealsApi.updatePayment_record(id!, paymentId, rest);
    },
    onSuccess: () => { invalidate(); setPaymentRecordModal(false); setEditingPayment(null); paymentRecordForm.resetFields(); message.success('Платёж обновлён'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка обновления платежа';
      message.error(msg);
    },
  });

  const deletePaymentRecordMut = useMutation({
    mutationFn: (paymentId: string) => dealsApi.deletePayment_record(id!, paymentId),
    onSuccess: () => { invalidate(); message.success('Платёж удалён'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка удаления платежа';
      message.error(msg);
    },
  });

  // Contract: create new and attach to deal
  const createContractMut = useMutation({
    mutationFn: async (data: { contractNumber: string; contractType?: 'ANNUAL' | 'ONE_TIME'; amount?: number; startDate: string; endDate?: string; notes?: string }) => {
      const contract = await contractsApi.create({ ...data, clientId: dealData!.clientId });
      await dealsApi.update(id!, { contractId: contract.id });
      return contract;
    },
    onSuccess: (contract) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['client-contracts'] });
      setCreateContractModal(false);
      contractForm.resetFields();
      message.success(`Договор ${contract.contractNumber} создан и прикреплён`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка создания договора';
      message.error(msg);
    },
  });

  // Contract: attach existing
  const attachContractMut = useMutation({
    mutationFn: (contractId: string) => dealsApi.update(id!, { contractId }),
    onSuccess: () => {
      invalidate();
      setAttachContractModal(false);
      message.success('Договор прикреплён к сделке');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка прикрепления договора';
      message.error(msg);
    },
  });

  // Contract: detach
  const detachContractMut = useMutation({
    mutationFn: () => dealsApi.update(id!, { contractId: null }),
    onSuccess: () => {
      invalidate();
      message.success('Договор откреплён');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  // SUPER_ADMIN: Hard delete deal
  const deleteDealMut = useMutation({
    mutationFn: (reason: string) => adminApi.deleteDeal(id!, reason),
    onSuccess: () => {
      message.success('Сделка удалена');
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      navigate('/deals');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка удаления';
      message.error(msg);
    },
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!dealData) return <Typography.Text>Сделка не найдена</Typography.Text>;
  const deal = dealData;

  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const isReadOnly = (deal.status === 'CLOSED' && !isAdmin) || deal.status === 'CANCELED';
  const canEditItems = ['NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION'].includes(deal.status) && (isAdmin || role === 'MANAGER');
  const canToggleVat = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';
  const hasQuantities = (deal.items ?? []).some((i) => i.requestedQty != null);

  // ──── Role-based action buttons ────

  function renderWorkflowActions() {
    const actions: React.ReactNode[] = [];

    // NEW → Send to warehouse (WAITING_STOCK_CONFIRMATION)
    if (deal.status === 'NEW' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Button key="to-warehouse" type="primary" icon={<ArrowRightOutlined />} loading={statusMut.isPending} onClick={() => statusMut.mutate('WAITING_STOCK_CONFIRMATION')}>
          Отправить на склад
        </Button>,
      );
    }

    // STOCK_CONFIRMED → Set quantities (opens modal, moves to IN_PROGRESS)
    if (deal.status === 'STOCK_CONFIRMED' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Button key="set-quantities" type="primary" icon={<EditOutlined />} onClick={() => {
          const initialValues = (deal.items ?? []).map((item) => ({
            dealItemId: item.id,
            productName: item.product?.name || 'Товар',
            unit: item.product?.unit || 'шт',
            warehouseComment: item.warehouseComment || '',
            requestedQty: Number(item.requestedQty) || 0,
            price: Number(item.price) || (item.product?.salePrice ? Number(item.product.salePrice) : 0),
          }));
          quantitiesForm.setFieldsValue({ items: initialValues, discount: 0, paymentType: 'FULL', paidAmount: 0 });
          setSetQuantitiesModal(true);
        }}>
          Указать количества и цены
        </Button>,
      );
      actions.push(
        <Popconfirm key="back-to-warehouse" title="Вернуть на склад?" onConfirm={() => statusMut.mutate('WAITING_STOCK_CONFIRMATION')}>
          <Button icon={<ArrowLeftOutlined />} loading={statusMut.isPending}>
            Назад на склад
          </Button>
        </Popconfirm>,
      );
    }

    // IN_PROGRESS without quantities → Set quantities
    if (deal.status === 'IN_PROGRESS' && (isAdmin || role === 'MANAGER') && !hasQuantities) {
      actions.push(
        <Button key="set-quantities-ip" type="primary" icon={<EditOutlined />} onClick={() => {
          const initialValues = (deal.items ?? []).map((item) => ({
            dealItemId: item.id,
            productName: item.product?.name || 'Товар',
            unit: item.product?.unit || 'шт',
            warehouseComment: item.warehouseComment || '',
            requestedQty: Number(item.requestedQty) || 0,
            price: Number(item.price) || (item.product?.salePrice ? Number(item.product.salePrice) : 0),
          }));
          quantitiesForm.setFieldsValue({ items: initialValues, discount: 0, paymentType: 'FULL', paidAmount: 0 });
          setSetQuantitiesModal(true);
        }}>
          Указать количества и цены
        </Button>,
      );
    }

    // IN_PROGRESS with quantities → Send to finance (payment method selection)
    if (deal.status === 'IN_PROGRESS' && (isAdmin || role === 'MANAGER') && hasQuantities) {
      actions.push(
        <Button key="send-finance" type="primary" icon={<DollarOutlined />} onClick={() => {
          setSelectedPaymentMethod(null);
          setSendToFinanceModal(true);
        }}>
          Отправить в финансы
        </Button>,
      );
    }

    // IN_PROGRESS → Go back to warehouse
    if (deal.status === 'IN_PROGRESS' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Popconfirm key="back-to-warehouse-ip" title="Вернуть на склад?" onConfirm={() => statusMut.mutate('WAITING_STOCK_CONFIRMATION')}>
          <Button icon={<ArrowLeftOutlined />} loading={statusMut.isPending}>
            Назад на склад
          </Button>
        </Popconfirm>,
      );
    }

    // WAITING_FINANCE → Finance approve/reject (Accountant/Admin)
    if (deal.status === 'WAITING_FINANCE' && (isAdmin || role === 'ACCOUNTANT')) {
      const contractMissing = needsContract && !deal.contractId;
      actions.push(
        contractMissing
          ? <Tooltip key="fin-approve" title="Сначала прикрепите договор">
            <Button type="primary" icon={<CheckCircleOutlined />} disabled>
              Одобрить финансы
            </Button>
          </Tooltip>
          : <Popconfirm key="fin-approve" title="Одобрить финансы?" onConfirm={() => financeApproveMut.mutate()}>
            <Button type="primary" icon={<CheckCircleOutlined />} loading={financeApproveMut.isPending}>
              Одобрить финансы
            </Button>
          </Popconfirm>,
        <Button key="fin-reject" danger icon={<CloseCircleOutlined />} onClick={() => setRejectModal(true)}>
          Отклонить
        </Button>,
      );
    }

    // WAITING_FINANCE → Go back to IN_PROGRESS
    if (deal.status === 'WAITING_FINANCE' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Popconfirm key="back-to-ip-wf" title="Вернуть в работу?" onConfirm={() => statusMut.mutate('IN_PROGRESS')}>
          <Button icon={<ArrowLeftOutlined />} loading={statusMut.isPending}>
            Назад в работу
          </Button>
        </Popconfirm>,
      );
    }

    // ADMIN_APPROVED → Admin approves → READY_FOR_SHIPMENT
    if (deal.status === 'ADMIN_APPROVED' && isAdmin) {
      actions.push(
        <Popconfirm key="admin-approve" title="Одобрить и отправить на отгрузку?" onConfirm={() => adminApproveMut.mutate()}>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={adminApproveMut.isPending}>
            Одобрить (Админ)
          </Button>
        </Popconfirm>,
        <Popconfirm key="back-to-ip-aa" title="Вернуть в работу?" onConfirm={() => statusMut.mutate('IN_PROGRESS')}>
          <Button icon={<ArrowLeftOutlined />} loading={statusMut.isPending}>
            Назад в работу
          </Button>
        </Popconfirm>,
      );
    }

    // READY_FOR_SHIPMENT → Shipment (closes deal)
    if (deal.status === 'READY_FOR_SHIPMENT' && (isAdmin || role === 'WAREHOUSE_MANAGER')) {
      actions.push(
        <Button key="ship" type="primary" icon={<CheckCircleOutlined />} onClick={() => setShipmentModal(true)}>
          Оформить отгрузку
        </Button>,
      );
    }

    // SHIPMENT_ON_HOLD → Release hold
    if (deal.status === 'SHIPMENT_ON_HOLD' && (isAdmin || role === 'WAREHOUSE_MANAGER')) {
      actions.push(
        <Popconfirm key="release-hold" title="Вернуть сделку в очередь на отгрузку?" onConfirm={() => releaseHoldMut.mutate()}>
          <Button type="primary" icon={<ArrowRightOutlined />} loading={releaseHoldMut.isPending}>
            Вернуть в очередь
          </Button>
        </Popconfirm>,
      );
    }

    // REJECTED → Return to IN_PROGRESS
    if (deal.status === 'REJECTED' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Button key="rework" type="primary" icon={<ArrowRightOutlined />} loading={statusMut.isPending} onClick={() => statusMut.mutate('IN_PROGRESS')}>
          Вернуть в работу
        </Button>,
      );
    }

    // Cancel button (available on most statuses)
    if (!isReadOnly && deal.status !== 'REJECTED' && (isAdmin || role === 'MANAGER')) {
      actions.push(
        <Popconfirm key="cancel" title="Отменить сделку?" onConfirm={() => statusMut.mutate('CANCELED')}>
          <Button danger icon={<CloseCircleOutlined />} loading={statusMut.isPending}>
            Отменить
          </Button>
        </Popconfirm>,
      );
    }

    // SUPER_ADMIN: Override button (always visible for SA)
    if (isSuperAdmin) {
      actions.push(
        <Button
          key="override"
          icon={<ThunderboltOutlined />}
          onClick={() => setOverrideModal(true)}
          style={{ background: '#722ed1', borderColor: '#722ed1', color: '#fff' }}
        >
          Super Override
        </Button>,
      );
      actions.push(
        <Button
          key="delete-deal"
          danger
          icon={<DeleteOutlined />}
          onClick={() => { setDeleteReason(''); setDeleteConfirmModal(true); }}
        >
          Удалить сделку
        </Button>,
      );
    }

    if (actions.length === 0) return null;

    return (
      <Card bordered={false} style={{ marginBottom: 16 }}>
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actions}
          </div>
        ) : (
          <Space wrap>{actions}</Space>
        )}
      </Card>
    );
  }

  // Build item columns dynamically based on deal state
  const itemColumns = [
    { title: 'Товар', dataIndex: ['product', 'name'] },
    { title: 'Артикул', dataIndex: ['product', 'sku'], render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Комментарий запроса', dataIndex: 'requestComment', render: (v: string | null) => v || '—' },
    ...(hasQuantities ? [
      { title: 'Кол-во', dataIndex: 'requestedQty', align: 'right' as const, width: 90, render: (v: number | null) => v != null ? formatQty(v) : '—' },
      { title: 'Ед.', dataIndex: ['product', 'unit'], width: 60 },
      { title: 'Цена', dataIndex: 'price', align: 'right' as const, render: (v: string | null) => v != null ? formatUZS(v) : '—' },
      { title: 'Сумма', key: 'total', align: 'right' as const, render: (_: unknown, r: DealItem) => r.requestedQty != null && r.price != null ? formatUZS(Number(r.price) * Number(r.requestedQty)) : '—' },
      ...(showVat ? [
        { title: 'НДС %', key: 'vatRate', align: 'center' as const, width: 70, render: () => '12%' },
        { title: 'Сумма НДС', key: 'vatAmount', align: 'right' as const, render: (_: unknown, r: DealItem) => r.requestedQty != null && r.price != null ? formatUZS(Number(r.price) * Number(r.requestedQty) * 0.12) : '—' },
        { title: 'С НДС', key: 'totalWithVat', align: 'right' as const, render: (_: unknown, r: DealItem) => r.requestedQty != null && r.price != null ? formatUZS(Number(r.price) * Number(r.requestedQty) * 1.12) : '—' },
      ] : []),
    ] : [
      { title: 'Ед.', dataIndex: ['product', 'unit'], width: 60 },
    ]),
    ...(deal.items?.some((i) => i.warehouseComment) ? [
      { title: 'Ответ склада', dataIndex: 'warehouseComment', render: (v: string | null) => v || '—' },
    ] : []),
    ...(canEditItems ? [{
      title: '', width: 50,
      render: (_: unknown, r: DealItem) => (
        <Popconfirm title="Удалить позицию?" onConfirm={() => removeItemMut.mutate(r.id)}>
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    }] : []),
  ];

  function renderWarehouseInfo() {
    const respondedItems = (deal.items ?? []).filter((i) => i.warehouseComment);
    if (respondedItems.length === 0) return null;
    const firstResponded = respondedItems[0];

    return (
      <Card title="Ответ склада" bordered={false}>
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {respondedItems.map((item) => (
              <Card key={item.id} size="small" bordered>
                <Typography.Text strong>{item.product?.name}</Typography.Text>
                {item.requestComment && (
                  <div style={{ marginTop: 4 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Запрос: </Typography.Text>
                    <Typography.Text style={{ fontSize: 12 }}>{item.requestComment}</Typography.Text>
                  </div>
                )}
                <div style={{ marginTop: 4 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Ответ: </Typography.Text>
                  <Typography.Text>{item.warehouseComment}</Typography.Text>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Table
            dataSource={respondedItems}
            rowKey="id"
            pagination={false}
            size="small"
            bordered={false}
            columns={[
              { title: 'Товар', dataIndex: ['product', 'name'] },
              { title: 'Комментарий запроса', dataIndex: 'requestComment', render: (v: string | null) => v || '—' },
              { title: 'Ответ склада', dataIndex: 'warehouseComment', render: (v: string | null) => v || '—' },
            ]}
          />
        )}
        {firstResponded?.confirmedAt && (
          <Typography.Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
            Ответ: {dayjs(firstResponded.confirmedAt).format('DD.MM.YYYY HH:mm')}
            {firstResponded?.confirmer && ` — ${firstResponded.confirmer.fullName}`}
          </Typography.Text>
        )}
      </Card>
    );
  }

  function renderShipment() {
    if (!deal.shipment) return null;

    return (
      <Card title="Отгрузка" bordered={false}>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="Тип транспорта">{deal.shipment.vehicleType}</Descriptions.Item>
          <Descriptions.Item label="Номер транспорта">{deal.shipment.vehicleNumber}</Descriptions.Item>
          <Descriptions.Item label="Водитель">{deal.shipment.driverName}</Descriptions.Item>
          <Descriptions.Item label="Время отправления">{dayjs(deal.shipment.departureTime).format('DD.MM.YYYY HH:mm')}</Descriptions.Item>
          <Descriptions.Item label="Номер накладной">{deal.shipment.deliveryNoteNumber}</Descriptions.Item>
          {deal.shipment.shipmentComment && (
            <Descriptions.Item label="Комментарий" span={2}>{deal.shipment.shipmentComment}</Descriptions.Item>
          )}
        </Descriptions>
        <Typography.Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
          Оформлено: {dayjs(deal.shipment.shippedAt).format('DD.MM.YYYY HH:mm')}
          {deal.shipment.user && ` — ${deal.shipment.user.fullName}`}
        </Typography.Text>
      </Card>
    );
  }

  return (
    <div>
      <Typography.Title level={4}>{deal.title}</Typography.Title>

      <Card bordered={false} style={{ marginBottom: 16 }}>
        <DealPipeline status={deal.status} />
      </Card>

      {renderWorkflowActions()}

      {needsContract && !deal.contractId && deal.status !== 'CLOSED' && deal.status !== 'CANCELED' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Для QR/перечисления необходим договор"
          description={canManageContract
            ? 'Создайте новый или прикрепите существующий договор к сделке.'
            : 'Привяжите договор к сделке перед финансовым одобрением.'}
          action={canManageContract ? (
            <Space>
              <Button size="small" type="primary" icon={<FileTextOutlined />} onClick={() => {
                contractForm.resetFields();
                contractForm.setFieldsValue({ startDate: dayjs(), amount: Number(deal.amount) || 0 });
                setCreateContractModal(true);
              }}>Создать договор</Button>
              <Button size="small" icon={<LinkOutlined />} onClick={() => setAttachContractModal(true)}>Прикрепить</Button>
            </Space>
          ) : undefined}
        />
      )}

      {needsContract && deal.contractId && deal.contract && canManageContract && (
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title={<><FileTextOutlined /> Договор: {deal.contract.contractNumber}</>}
          extra={!isReadOnly && (
            <Popconfirm title="Открепить договор от сделки?" onConfirm={() => detachContractMut.mutate()}>
              <Button size="small" danger type="text">Открепить</Button>
            </Popconfirm>
          )}
        >
          <Descriptions size="small" column={{ xs: 1, sm: 3 }}>
            <Descriptions.Item label="Номер">{deal.contract.contractNumber}</Descriptions.Item>
            <Descriptions.Item label="Клиент">{deal.client?.companyName}</Descriptions.Item>
            <Descriptions.Item label="Статус"><Tag color="green">Прикреплён</Tag></Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Детали */}
          <Card bordered={false} size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Клиент">
                <Link to={`/clients/${deal.clientId}`}>{deal.client?.companyName}</Link>
              </Descriptions.Item>
              <Descriptions.Item label="Менеджер">
                {isAdmin ? (
                  <Select
                    value={deal.managerId}
                    onChange={(val) => managerMut.mutate(val)}
                    loading={managerMut.isPending}
                    style={{ minWidth: 120 }}
                    showSearch
                    optionFilterProp="label"
                    options={(users ?? []).filter((u) => u.isActive && u.role === 'MANAGER').map((u) => ({ label: u.fullName, value: u.id }))}
                  />
                ) : (
                  deal.manager?.fullName
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Сумма">
                {hasQuantities ? formatUZS(deal.amount) : <Typography.Text type="secondary">Не установлено</Typography.Text>}
              </Descriptions.Item>
              {deal.discount && Number(deal.discount) > 0 && (
                <Descriptions.Item label="Скидка">{formatUZS(deal.discount)}</Descriptions.Item>
              )}
              <Descriptions.Item label="Создана">{dayjs(deal.createdAt).format('DD.MM.YYYY HH:mm')}</Descriptions.Item>
              {deal.contract && (
                <Descriptions.Item label="Договор">{deal.contract.contractNumber}</Descriptions.Item>
              )}
              {deal.paymentMethod && (
                <Descriptions.Item label="Способ оплаты">
                  <Tag color="blue">{paymentMethodLabels[deal.paymentMethod] || deal.paymentMethod}</Tag>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Статус">
                <DealStatusTag status={deal.status} />
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Оплата */}
          {hasQuantities && (
            <Card
              title="Оплата"
              size="small"
              extra={
                !isReadOnly && (isAdmin || role === 'MANAGER' || role === 'ACCOUNTANT' || role === 'WAREHOUSE_MANAGER') && (
                  <Space>
                    <Button size="small" icon={<PlusOutlined />} onClick={() => { setEditingPayment(null); paymentRecordForm.resetFields(); setPaymentRecordModal(true); }}>+</Button>
                    <Button size="small" onClick={() => { paymentForm.setFieldsValue({ paidAmount: Number(deal.paidAmount), paymentType: deal.paymentType, dueDate: deal.dueDate ? dayjs(deal.dueDate) : null, terms: deal.terms || '' }); setPaymentModal(true); }}>Изменить</Button>
                  </Space>
                )
              }
              bordered={false}
            >
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Тип">{deal.paymentType === 'FULL' ? 'Полная' : deal.paymentType === 'PARTIAL' ? 'Частичная' : 'Рассрочка'}</Descriptions.Item>
                <Descriptions.Item label="Статус">
                  <Tag color={paymentStatusLabels[deal.paymentStatus]?.color}>{paymentStatusLabels[deal.paymentStatus]?.label}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Оплачено">{formatUZS(deal.paidAmount)} / {formatUZS(deal.amount)}</Descriptions.Item>
                {Number(deal.amount) - Number(deal.paidAmount) > 0 && (
                  <Descriptions.Item label="Долг">
                    <Typography.Text type="danger" strong>{formatUZS(Number(deal.amount) - Number(deal.paidAmount))}</Typography.Text>
                  </Descriptions.Item>
                )}
                {deal.dueDate && (
                  <Descriptions.Item label="Срок">{dayjs(deal.dueDate).format('DD.MM.YYYY')}</Descriptions.Item>
                )}
              </Descriptions>

              {(dealPayments ?? []).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Платежи:</Typography.Text>
                  {(dealPayments ?? []).map((p: any) => (
                    <Card key={p.id} size="small" bordered>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography.Text strong>{formatUZS(p.amount)}</Typography.Text>
                        <Space size={4}>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(p.paidAt).format('DD.MM.YYYY HH:mm')}</Typography.Text>
                          {!isReadOnly && (isAdmin || role === 'ACCOUNTANT') && (
                            <>
                              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => {
                                setEditingPayment({ id: p.id });
                                paymentRecordForm.setFieldsValue({ amount: Number(p.amount), method: p.method || undefined, paidAt: dayjs(p.paidAt), note: p.note || '' });
                                setPaymentRecordModal(true);
                              }} />
                              <Popconfirm title="Удалить платёж?" onConfirm={() => deletePaymentRecordMut.mutate(p.id)}>
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </>
                          )}
                        </Space>
                      </div>
                      {(p.method || p.creator?.fullName) && (
                        <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                          {p.method && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{paymentMethodLabels[p.method] || p.method}</Typography.Text>}
                          {p.creator?.fullName && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.creator.fullName}</Typography.Text>}
                        </div>
                      )}
                      {p.note && <div style={{ marginTop: 4 }}><Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.note}</Typography.Text></div>}
                    </Card>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Товары */}
          <Card
            title={`Товары (${deal.items?.length ?? 0})`}
            size="small"
            extra={
              <Space>
                {canToggleVat && (
                  <Button size="small" type={showVat ? 'primary' : 'default'} icon={<CalculatorOutlined />} onClick={() => setShowVat(!showVat)}>НДС</Button>
                )}
                {canEditItems && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setItemModal(true)}>+</Button>}
              </Space>
            }
            bordered={false}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(deal.items ?? []).map((item) => (
                <Card key={item.id} size="small" bordered>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text strong style={{ display: 'block', wordBreak: 'break-word' }}>{item.product?.name}</Typography.Text>
                      <Tag style={{ marginTop: 4 }}>{item.product?.sku}</Tag>
                    </div>
                    {canEditItems && (
                      <Popconfirm title="Удалить?" onConfirm={() => removeItemMut.mutate(item.id)}>
                        <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                      </Popconfirm>
                    )}
                  </div>
                  {item.requestComment && (
                    <div style={{ marginTop: 6 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Запрос: {item.requestComment}</Typography.Text>
                    </div>
                  )}
                  {hasQuantities && item.requestedQty != null && (
                    <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>Кол-во</Typography.Text>
                        <div><Typography.Text strong>{formatQty(item.requestedQty)} {item.product?.unit || 'шт'}</Typography.Text></div>
                      </div>
                      {item.price != null && (
                        <div>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>Цена</Typography.Text>
                          <div><Typography.Text>{formatUZS(item.price)}</Typography.Text></div>
                        </div>
                      )}
                      {item.requestedQty != null && item.price != null && (
                        <div>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>Сумма</Typography.Text>
                          <div><Typography.Text strong>{formatUZS(Number(item.price) * Number(item.requestedQty))}</Typography.Text></div>
                        </div>
                      )}
                      {showVat && item.requestedQty != null && item.price != null && (
                        <>
                          <div>
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>НДС 12%</Typography.Text>
                            <div><Typography.Text>{formatUZS(Number(item.price) * Number(item.requestedQty) * 0.12)}</Typography.Text></div>
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>С НДС</Typography.Text>
                            <div><Typography.Text strong>{formatUZS(Number(item.price) * Number(item.requestedQty) * 1.12)}</Typography.Text></div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {item.warehouseComment && (
                    <div style={{ marginTop: 6 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Склад: {item.warehouseComment}</Typography.Text>
                    </div>
                  )}
                </Card>
              ))}
              {hasQuantities && (() => {
                const subtotal = (deal.items ?? []).reduce((sum, item) => sum + Number(item.price ?? 0) * Number(item.requestedQty ?? 0), 0);
                if (subtotal <= 0) return null;
                const discount = Number(deal.discount || 0);
                return (
                  <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.02)', borderRadius: 8 }}>
                    {discount > 0 && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography.Text>Подытог</Typography.Text>
                          <Typography.Text>{formatUZS(subtotal)}</Typography.Text>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography.Text>Скидка</Typography.Text>
                          <Typography.Text type="success">-{formatUZS(discount)}</Typography.Text>
                        </div>
                      </>
                    )}
                    {showVat && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography.Text>НДС 12%</Typography.Text>
                        <Typography.Text>{formatUZS((discount > 0 ? subtotal - discount : subtotal) * 0.12)}</Typography.Text>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography.Text strong>Итого</Typography.Text>
                      <Typography.Text strong>{formatUZS(showVat ? (discount > 0 ? subtotal - discount : subtotal) * 1.12 : (discount > 0 ? subtotal - discount : subtotal))}</Typography.Text>
                    </div>
                  </div>
                );
              })()}
              {(deal.items ?? []).length === 0 && (
                <Typography.Text type="secondary">Нет товаров</Typography.Text>
              )}
            </div>
          </Card>

          {renderWarehouseInfo()}
          {renderShipment()}

          {/* Комментарии */}
          <Card title="Комментарии" size="small" bordered={false}>
            <List
              dataSource={deal.comments ?? []}
              locale={{ emptyText: 'Нет комментариев' }}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <div>
                        <Typography.Text strong>{item.author?.fullName}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                          {dayjs(item.createdAt).format('DD.MM.YYYY HH:mm')}
                        </Typography.Text>
                      </div>
                    }
                    description={item.text}
                  />
                </List.Item>
              )}
            />
            {!isReadOnly && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Input
                  placeholder="Комментарий..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onPressEnter={() => comment.trim() && commentMut.mutate(comment.trim())}
                />
                <Button type="primary" icon={<SendOutlined />} loading={commentMut.isPending} onClick={() => comment.trim() && commentMut.mutate(comment.trim())} />
              </div>
            )}
          </Card>

          {/* История */}
          <Collapse
            size="small"
            items={[
              {
                key: 'history',
                label: 'История',
                children: (
                  <Timeline
                    items={(history ?? []).map((entry: DealHistoryEntry) => {
                      if (entry.kind === 'audit') {
                        return {
                          color: entry.action === 'STATUS_CHANGE' ? 'blue' : entry.action === 'CREATE' ? 'green' : 'gray',
                          children: (
                            <div>
                              <Typography.Text strong style={{ fontSize: 12 }}>{entry.user?.fullName}</Typography.Text>{' '}
                              <Tag style={{ fontSize: 11 }}>{entry.action}</Tag>
                              <div><Typography.Text type="secondary" style={{ fontSize: 11 }}>{dayjs(entry.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text></div>
                              {entry.action === 'STATUS_CHANGE' && entry.before && entry.after && (
                                <div style={{ marginTop: 4 }}>
                                  <DealStatusTag status={entry.before.status as DealStatus} />{' → '}
                                  <DealStatusTag status={entry.after.status as DealStatus} />
                                </div>
                              )}
                            </div>
                          ),
                        };
                      }
                      return {
                        color: entry.type === 'IN' ? 'green' : 'red',
                        children: (
                          <div>
                            <Tag color={entry.type === 'IN' ? 'green' : 'red'} style={{ fontSize: 11 }}>{entry.type === 'IN' ? 'Приход' : 'Расход'}</Tag>{' '}
                            <Typography.Text strong style={{ fontSize: 12 }}>{entry.product?.name}</Typography.Text>{' '}
                            <Typography.Text style={{ fontSize: 12 }}>x {entry.quantity}</Typography.Text>
                            <div><Typography.Text type="secondary" style={{ fontSize: 11 }}>{dayjs(entry.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text></div>
                          </div>
                        ),
                      };
                    })}
                  />
                ),
              },
              ...(isSuperAdmin ? [{
                key: 'audit',
                label: 'Аудит (SA)',
                children: <AuditHistoryPanel dealId={id!} />,
              }] : []),
            ]}
          />
        </div>
      ) : (
        <Tabs
          defaultActiveKey="details"
          items={[
            {
              key: 'details',
              label: 'Детали',
              children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                  <Card bordered={false}>
                    <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                      <Descriptions.Item label="Клиент">
                        <Link to={`/clients/${deal.clientId}`}>{deal.client?.companyName}</Link>
                      </Descriptions.Item>
                      <Descriptions.Item label="Менеджер">
                        {isAdmin ? (
                          <Select
                            value={deal.managerId}
                            onChange={(val) => managerMut.mutate(val)}
                            loading={managerMut.isPending}
                            style={{ minWidth: 200 }}
                            showSearch
                            optionFilterProp="label"
                            options={(users ?? []).filter((u) => u.isActive && u.role === 'MANAGER').map((u) => ({ label: u.fullName, value: u.id }))}
                          />
                        ) : (
                          deal.manager?.fullName
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="Сумма">
                        {hasQuantities ? formatUZS(deal.amount) : <Typography.Text type="secondary">Не установлено</Typography.Text>}
                      </Descriptions.Item>
                      {deal.discount && Number(deal.discount) > 0 && (
                        <Descriptions.Item label="Скидка">{formatUZS(deal.discount)}</Descriptions.Item>
                      )}
                      <Descriptions.Item label="Создана">{dayjs(deal.createdAt).format('DD.MM.YYYY HH:mm')}</Descriptions.Item>
                      {deal.contract && (
                        <Descriptions.Item label="Договор">{deal.contract.contractNumber}</Descriptions.Item>
                      )}
                      {deal.paymentMethod && (
                        <Descriptions.Item label="Способ оплаты">
                          <Tag color="blue">{paymentMethodLabels[deal.paymentMethod] || deal.paymentMethod}</Tag>
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Статус">
                        <DealStatusTag status={deal.status} />
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>

                  {hasQuantities && (
                    <Card
                      title="Оплата"
                      extra={
                        <Space>
                          {!isReadOnly && (isAdmin || role === 'MANAGER' || role === 'ACCOUNTANT' || role === 'WAREHOUSE_MANAGER') && (
                            <Button size="small" icon={<PlusOutlined />} onClick={() => { setEditingPayment(null); paymentRecordForm.resetFields(); setPaymentRecordModal(true); }}>Добавить платёж</Button>
                          )}
                          {!isReadOnly && (isAdmin || role === 'MANAGER' || role === 'ACCOUNTANT' || role === 'WAREHOUSE_MANAGER') && (
                            <Button size="small" onClick={() => { paymentForm.setFieldsValue({ paidAmount: Number(deal.paidAmount), paymentType: deal.paymentType, dueDate: deal.dueDate ? dayjs(deal.dueDate) : null, terms: deal.terms || '' }); setPaymentModal(true); }}>Изменить</Button>
                          )}
                        </Space>
                      }
                      bordered={false}
                    >
                      <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                        <Descriptions.Item label="Тип">{deal.paymentType === 'FULL' ? 'Полная' : deal.paymentType === 'PARTIAL' ? 'Частичная' : 'Рассрочка'}</Descriptions.Item>
                        <Descriptions.Item label="Статус оплаты">
                          <Tag color={paymentStatusLabels[deal.paymentStatus]?.color}>{paymentStatusLabels[deal.paymentStatus]?.label}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="Оплачено">{formatUZS(deal.paidAmount)} / {formatUZS(deal.amount)}</Descriptions.Item>
                        {Number(deal.amount) - Number(deal.paidAmount) > 0 && (
                          <Descriptions.Item label="Долг">
                            <Typography.Text type="danger" strong>{formatUZS(Number(deal.amount) - Number(deal.paidAmount))}</Typography.Text>
                          </Descriptions.Item>
                        )}
                        {deal.dueDate && (
                          <Descriptions.Item label="Срок оплаты">{dayjs(deal.dueDate).format('DD.MM.YYYY')}</Descriptions.Item>
                        )}
                        {deal.terms && (
                          <Descriptions.Item label="Условия" span={2}>{deal.terms}</Descriptions.Item>
                        )}
                      </Descriptions>

                      {(dealPayments ?? []).length > 0 && (
                        <Table
                          dataSource={dealPayments}
                          rowKey="id"
                          pagination={false}
                          size="small"
                          bordered={false}
                          style={{ marginTop: 16 }}
                          scroll={{ x: 500 }}
                          columns={[
                            { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
                            { title: 'Способ', dataIndex: 'method', render: (v: string | null) => v ? (paymentMethodLabels[v] || v) : '—' },
                            { title: 'Дата оплаты', dataIndex: 'paidAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm') },
                            { title: 'Кем внесено', dataIndex: ['creator', 'fullName'], render: (v: string) => v || '—' },
                            { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
                            ...(!isReadOnly && (isAdmin || role === 'ACCOUNTANT') ? [{
                              title: '', key: 'actions', width: 80,
                              render: (_: unknown, record: PaymentRecord) => (
                                <Space size={0}>
                                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => {
                                    setEditingPayment({ id: record.id });
                                    paymentRecordForm.setFieldsValue({ amount: Number(record.amount), method: record.method || undefined, paidAt: dayjs(record.paidAt), note: record.note || '' });
                                    setPaymentRecordModal(true);
                                  }} />
                                  <Popconfirm title="Удалить платёж?" onConfirm={() => deletePaymentRecordMut.mutate(record.id)}>
                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                                  </Popconfirm>
                                </Space>
                              ),
                            }] : []),
                          ]}
                        />
                      )}
                    </Card>
                  )}

                  <Card title={`Товары (${deal.items?.length ?? 0})`} extra={
                    <Space>
                      {canToggleVat && (
                        <Button size="small" type={showVat ? 'primary' : 'default'} icon={<CalculatorOutlined />} onClick={() => setShowVat(!showVat)}>НДС 12%</Button>
                      )}
                      {canEditItems && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setItemModal(true)}>Добавить</Button>}
                    </Space>
                  } bordered={false}>
                    <Table
                      dataSource={deal.items ?? []}
                      columns={itemColumns}
                      rowKey="id"
                      pagination={false}
                      size="small"
                      bordered={false}
                      scroll={{ x: 600 }}
                      summary={() => {
                        if (!hasQuantities) return null;
                        const subtotal = (deal.items ?? []).reduce((sum, item) => sum + Number(item.price ?? 0) * Number(item.requestedQty ?? 0), 0);
                        if (subtotal <= 0) return null;
                        const discount = Number(deal.discount || 0);
                        const hasDiscount = discount > 0;
                        return (
                          <>
                            {hasDiscount && (
                              <>
                                <Table.Summary.Row>
                                  <Table.Summary.Cell index={0} colSpan={itemColumns.length - 1}><Typography.Text>Подытог</Typography.Text></Table.Summary.Cell>
                                  <Table.Summary.Cell index={1} align="right"><Typography.Text>{formatUZS(subtotal)}</Typography.Text></Table.Summary.Cell>
                                </Table.Summary.Row>
                                <Table.Summary.Row>
                                  <Table.Summary.Cell index={0} colSpan={itemColumns.length - 1}><Typography.Text>Скидка</Typography.Text></Table.Summary.Cell>
                                  <Table.Summary.Cell index={1} align="right"><Typography.Text type="success">-{formatUZS(discount)}</Typography.Text></Table.Summary.Cell>
                                </Table.Summary.Row>
                              </>
                            )}
                            {showVat && (
                              <Table.Summary.Row>
                                <Table.Summary.Cell index={0} colSpan={itemColumns.length - 1}><Typography.Text>НДС 12%</Typography.Text></Table.Summary.Cell>
                                <Table.Summary.Cell index={1} align="right"><Typography.Text>{formatUZS((hasDiscount ? subtotal - discount : subtotal) * 0.12)}</Typography.Text></Table.Summary.Cell>
                              </Table.Summary.Row>
                            )}
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0} colSpan={itemColumns.length - 1}><Typography.Text strong>Итого</Typography.Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={1} align="right"><Typography.Text strong>{formatUZS(showVat ? (hasDiscount ? subtotal - discount : subtotal) * 1.12 : (hasDiscount ? subtotal - discount : subtotal))}</Typography.Text></Table.Summary.Cell>
                            </Table.Summary.Row>
                          </>
                        );
                      }}
                    />
                  </Card>

                  {renderWarehouseInfo()}
                  {renderShipment()}

                  <Card title="Комментарии" bordered={false}>
                    <List
                      dataSource={deal.comments ?? []}
                      locale={{ emptyText: 'Нет комментариев' }}
                      renderItem={(item) => (
                        <List.Item>
                          <List.Item.Meta
                            title={
                              <Space>
                                <Typography.Text strong>{item.author?.fullName}</Typography.Text>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  {dayjs(item.createdAt).format('DD.MM.YYYY HH:mm')}
                                </Typography.Text>
                              </Space>
                            }
                            description={item.text}
                          />
                        </List.Item>
                      )}
                    />
                    {!isReadOnly && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                        <Input
                          placeholder="Написать комментарий..."
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          onPressEnter={() => comment.trim() && commentMut.mutate(comment.trim())}
                        />
                        <Button type="primary" icon={<SendOutlined />} loading={commentMut.isPending} onClick={() => comment.trim() && commentMut.mutate(comment.trim())} />
                      </div>
                    )}
                  </Card>
                </Space>
              ),
            },
            {
              key: 'history',
              label: 'История',
              children: (
                <Card bordered={false}>
                  <Timeline
                    items={(history ?? []).map((entry: DealHistoryEntry) => {
                      if (entry.kind === 'audit') {
                        return {
                          color: entry.action === 'STATUS_CHANGE' ? 'blue' : entry.action === 'CREATE' ? 'green' : 'gray',
                          children: (
                            <div>
                              <Typography.Text strong>{entry.user?.fullName}</Typography.Text>{' '}
                              <Tag>{entry.action}</Tag>{' '}
                              <Typography.Text type="secondary">{dayjs(entry.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text>
                              {entry.action === 'STATUS_CHANGE' && entry.before && entry.after && (
                                <div style={{ marginTop: 4 }}>
                                  <DealStatusTag status={entry.before.status as DealStatus} />{' → '}
                                  <DealStatusTag status={entry.after.status as DealStatus} />
                                </div>
                              )}
                            </div>
                          ),
                        };
                      }
                      return {
                        color: entry.type === 'IN' ? 'green' : 'red',
                        children: (
                          <div>
                            <Tag color={entry.type === 'IN' ? 'green' : 'red'}>{entry.type === 'IN' ? 'Приход' : 'Расход'}</Tag>{' '}
                            <Typography.Text strong>{entry.product?.name}</Typography.Text>{' '}
                            <Typography.Text>({entry.product?.sku})</Typography.Text>{' '}
                            <Typography.Text>x {entry.quantity}</Typography.Text>{' '}
                            <Typography.Text type="secondary">{dayjs(entry.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text>
                            {entry.note && <div style={{ marginTop: 4 }}><Typography.Text type="secondary">{entry.note}</Typography.Text></div>}
                          </div>
                        ),
                      };
                    })}
                  />
                </Card>
              ),
            },
            ...(isSuperAdmin ? [{
              key: 'audit',
              label: <><AuditOutlined /> Аудит (SA)</>,
              children: (
                <Card bordered={false}>
                  <AuditHistoryPanel dealId={id!} />
                </Card>
              ),
            }] : []),
          ]}
        />
      )}

      {/* Add Item Modal */}
      <Modal
        title="Добавить товар"
        open={itemModal}
        onCancel={() => setItemModal(false)}
        onOk={() => itemForm.submit()}
        confirmLoading={addItemMut.isPending}
        okText="Добавить"
        cancelText="Отмена"
      >
        <Form form={itemForm} layout="vertical" onFinish={(v) => addItemMut.mutate({ productId: v.productId, requestComment: v.requestComment || undefined })}>
          <Form.Item name="productId" label="Товар" rules={[{ required: true, message: 'Выберите товар' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Выберите товар"
              options={(products ?? []).filter((p) => p.isActive).map((p) => ({ label: `${p.name} (${p.sku}) — остаток: ${p.stock}`, value: p.id }))}
            />
          </Form.Item>
          <Form.Item name="requestComment" label="Комментарий / запрос">
            <Input.TextArea rows={2} placeholder="Например: нужно 50 тонн, уточнить наличие" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Payment Modal */}
      <Modal
        title="Обновить оплату"
        open={paymentModal}
        onCancel={() => setPaymentModal(false)}
        onOk={() => paymentForm.submit()}
        confirmLoading={paymentMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={paymentForm} layout="vertical" onFinish={(v) => paymentMut.mutate({ ...v, dueDate: v.dueDate ? v.dueDate.format('YYYY-MM-DD') : null, terms: v.terms || null })}>
          <Form.Item name="paidAmount" label="Оплаченная сумма" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Form.Item name="paymentType" label="Тип оплаты">
            <Select options={[{ label: 'Полная', value: 'FULL' }, { label: 'Частичная', value: 'PARTIAL' }, { label: 'Рассрочка', value: 'INSTALLMENT' }]} />
          </Form.Item>
          <Form.Item name="dueDate" label="Срок оплаты">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="terms" label="Условия">
            <Input.TextArea rows={2} placeholder="Условия оплаты..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Warehouse Response Modal */}
      <Modal
        title="Ответ склада"
        open={warehouseResponseModal}
        onCancel={() => setWarehouseResponseModal(false)}
        onOk={() => warehouseForm.submit()}
        confirmLoading={warehouseResponseMut.isPending}
        okText="Ответить"
        cancelText="Отмена"
        width={isMobile ? '100%' : 700}
      >
        <Form form={warehouseForm} layout="vertical" onFinish={(values) => {
          const items = values.items.map((item: Record<string, unknown>) => ({
            dealItemId: item.dealItemId,
            warehouseComment: item.warehouseComment as string,
          }));
          warehouseResponseMut.mutate(items);
        }}>
          <Form.List name="items">
            {(fields) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {fields.map((field) => {
                  const itemData = warehouseForm.getFieldValue(['items', field.name]);
                  return (
                    <Card key={field.key} size="small" title={itemData?.productName || 'Товар'} bordered>
                      <Form.Item name={[field.name, 'dealItemId']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'productName']} hidden><Input /></Form.Item>
                      {itemData?.requestComment && (
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                          Запрос менеджера: {itemData.requestComment}
                        </Typography.Text>
                      )}
                      <Form.Item
                        name={[field.name, 'warehouseComment']}
                        label="Ответ склада"
                        rules={[{ required: true, message: 'Укажите ответ' }]}
                      >
                        <Input.TextArea rows={2} placeholder="Есть в наличии 40 тонн, срок доставки 3 дня..." />
                      </Form.Item>
                    </Card>
                  );
                })}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Set Quantities Modal */}
      <Modal
        title="Указать количества и цены"
        open={setQuantitiesModal}
        onCancel={() => setSetQuantitiesModal(false)}
        onOk={() => quantitiesForm.submit()}
        confirmLoading={setQuantitiesMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        width={isMobile ? '100%' : 800}
      >
        <Form form={quantitiesForm} layout="vertical" onFinish={(values) => {
          const items = values.items.map((item: Record<string, unknown>) => ({
            dealItemId: item.dealItemId,
            requestedQty: item.requestedQty as number,
            price: item.price as number,
          }));
          setQuantitiesMut.mutate({
            items,
            discount: values.discount || 0,
            paymentType: values.paymentType || 'FULL',
            paidAmount: values.paymentType === 'FULL' ? undefined : values.paidAmount || 0,
            dueDate: values.dueDate ? values.dueDate.format('YYYY-MM-DD') : undefined,
            terms: values.terms || undefined,
          });
        }}>
          <Form.List name="items">
            {(fields) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                {fields.map((field) => {
                  const itemData = quantitiesForm.getFieldValue(['items', field.name]);
                  return (
                    <Card key={field.key} size="small" title={`${itemData?.productName || 'Товар'} (${itemData?.unit || 'шт'})`} bordered>
                      <Form.Item name={[field.name, 'dealItemId']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'productName']} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, 'unit']} hidden><Input /></Form.Item>
                      {itemData?.warehouseComment && (
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                          Ответ склада: {itemData.warehouseComment}
                        </Typography.Text>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                        <Form.Item name={[field.name, 'requestedQty']} label="Количество" rules={[{ required: true, message: 'Обязательно' }]}>
                          <InputNumber
                            style={{ width: '100%' }}
                            min={0.1}
                            step={0.1}
                            parser={(v) => {
                              const s = (v || '').replace(',', '.');
                              return Number(s) as unknown as 0;
                            }}
                          />
                        </Form.Item>
                        <Form.Item name={[field.name, 'price']} label="Цена за единицу" rules={[{ required: true, message: 'Обязательно' }]}>
                          <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
                        </Form.Item>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </Form.List>

          <Card size="small" title="Оплата" bordered>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <Form.Item name="discount" label="Скидка">
                <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
              </Form.Item>
              <Form.Item name="paymentType" label="Тип оплаты">
                <Radio.Group>
                  <Radio.Button value="FULL">Полная</Radio.Button>
                  <Radio.Button value="PARTIAL">Частичная</Radio.Button>
                  <Radio.Button value="INSTALLMENT">Рассрочка</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.paymentType !== cur.paymentType}>
                {({ getFieldValue }) => getFieldValue('paymentType') !== 'FULL' && (
                  <Form.Item name="paidAmount" label="Оплачено">
                    <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
                  </Form.Item>
                )}
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.paymentType !== cur.paymentType}>
                {({ getFieldValue }) => getFieldValue('paymentType') !== 'FULL' && (
                  <Form.Item name="dueDate" label="Срок оплаты">
                    <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
                  </Form.Item>
                )}
              </Form.Item>
            </div>
            <Form.Item name="terms" label="Условия">
              <Input.TextArea rows={2} placeholder="Условия оплаты..." />
            </Form.Item>
          </Card>
        </Form>
      </Modal>

      {/* Send to Finance Modal — Payment Method Selection */}
      <Modal
        title="Отправить в финансы"
        open={sendToFinanceModal}
        onCancel={() => { setSendToFinanceModal(false); setSelectedPaymentMethod(null); }}
        onOk={() => {
          if (!selectedPaymentMethod) {
            message.warning('Выберите способ оплаты');
            return;
          }
          sendToFinanceMut.mutate(selectedPaymentMethod);
        }}
        confirmLoading={sendToFinanceMut.isPending}
        okText="Отправить"
        cancelText="Отмена"
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Выберите способ оплаты. Наличные, Payme, Click и Терминал не требуют проверки финансов. QR, Перечисление и Рассрочка направляются на проверку бухгалтера (требуется договор).
        </Typography.Paragraph>
        <Radio.Group
          value={selectedPaymentMethod}
          onChange={(e) => setSelectedPaymentMethod(e.target.value)}
          style={{ width: '100%' }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <Radio.Button value="CASH" style={{ width: '100%', height: 'auto', padding: '8px 16px', textAlign: 'left' }}>
              Наличные
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Без проверки финансов</Typography.Text>
            </Radio.Button>
            <Radio.Button value="PAYME" style={{ width: '100%', height: 'auto', padding: '8px 16px', textAlign: 'left' }}>
              Payme
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Без проверки финансов</Typography.Text>
            </Radio.Button>
            <Radio.Button value="CLICK" style={{ width: '100%', height: 'auto', padding: '8px 16px', textAlign: 'left' }}>
              Click
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Без проверки финансов</Typography.Text>
            </Radio.Button>
            <Radio.Button value="TERMINAL" style={{ width: '100%', height: 'auto', padding: '8px 16px', textAlign: 'left' }}>
              Терминал
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Без проверки финансов</Typography.Text>
            </Radio.Button>
            <Radio.Button value="QR" style={{ width: '100%', height: 'auto', padding: '8px 16px', textAlign: 'left' }}>
              QR
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Требуется проверка бухгалтера + договор</Typography.Text>
            </Radio.Button>
            <Radio.Button value="TRANSFER" style={{ width: '100%', height: 'auto', padding: '8px 16px', textAlign: 'left' }}>
              Перечисление
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Требуется проверка бухгалтера + договор</Typography.Text>
            </Radio.Button>
            <Radio.Button value="INSTALLMENT" style={{ width: '100%', height: 'auto', padding: '8px 16px', textAlign: 'left' }}>
              Рассрочка
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Требуется проверка бухгалтера + договор</Typography.Text>
            </Radio.Button>
          </Space>
        </Radio.Group>
      </Modal>

      {/* Shipment Modal */}
      <Modal
        title="Оформить отгрузку"
        open={shipmentModal}
        onCancel={() => setShipmentModal(false)}
        onOk={() => shipmentForm.submit()}
        confirmLoading={shipmentMut.isPending}
        okText="Оформить"
        cancelText="Отмена"
        width={isMobile ? '100%' : 600}
      >
        <Form form={shipmentForm} layout="vertical" onFinish={(v) => shipmentMut.mutate({ ...v, departureTime: v.departureTime.toISOString(), shipmentComment: v.shipmentComment || undefined })}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Form.Item name="vehicleType" label="Тип транспорта" rules={[{ required: true, message: 'Обязательно' }]}>
              <Input placeholder="Грузовик / Фура / ..." />
            </Form.Item>
            <Form.Item name="vehicleNumber" label="Номер транспорта" rules={[{ required: true, message: 'Обязательно' }]}>
              <Input placeholder="01 A 123 AA" />
            </Form.Item>
            <Form.Item name="driverName" label="Водитель" rules={[{ required: true, message: 'Обязательно' }]}>
              <Input placeholder="ФИО водителя" />
            </Form.Item>
            <Form.Item name="departureTime" label="Время отправления" rules={[{ required: true, message: 'Обязательно' }]}>
              <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
            </Form.Item>
            <Form.Item name="deliveryNoteNumber" label="Номер накладной" rules={[{ required: true, message: 'Обязательно' }]}>
              <Input placeholder="Номер накладной" />
            </Form.Item>
            <Form.Item name="shipmentComment" label="Комментарий">
              <Input placeholder="Комментарий к отгрузке" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* Finance Reject Modal */}
      <Modal
        title="Отклонить сделку"
        open={rejectModal}
        onCancel={() => { setRejectModal(false); setRejectReason(''); }}
        onOk={() => { if (rejectReason.trim()) financeRejectMut.mutate(rejectReason.trim()); else message.warning('Укажите причину'); }}
        confirmLoading={financeRejectMut.isPending}
        okText="Отклонить"
        okButtonProps={{ danger: true }}
        cancelText="Отмена"
      >
        <Alert message="Сделка будет возвращена со статусом «Отклонена». Менеджер сможет доработать и отправить повторно." type="warning" showIcon style={{ marginBottom: 16 }} />
        <Input.TextArea
          rows={3}
          placeholder="Причина отклонения..."
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      {/* Payment Record Modal */}
      <Modal
        title={editingPayment ? 'Редактировать платёж' : 'Добавить платёж'}
        open={paymentRecordModal}
        onCancel={() => { setPaymentRecordModal(false); setEditingPayment(null); paymentRecordForm.resetFields(); }}
        onOk={() => paymentRecordForm.submit()}
        confirmLoading={paymentRecordMut.isPending || updatePaymentRecordMut.isPending}
        okText={editingPayment ? 'Сохранить' : 'Добавить'}
        cancelText="Отмена"
      >
        <Form form={paymentRecordForm} layout="vertical" onFinish={(v) => {
          if (editingPayment) {
            updatePaymentRecordMut.mutate({ paymentId: editingPayment.id, amount: v.amount, method: v.method || null, paidAt: v.paidAt ? v.paidAt.toISOString() : undefined, note: v.note || null });
          } else {
            paymentRecordMut.mutate({ ...v, paidAt: v.paidAt ? v.paidAt.toISOString() : undefined });
          }
        }}>
          <Form.Item name="amount" label="Сумма" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Form.Item name="method" label="Способ оплаты">
            <Select allowClear placeholder="Выберите" options={[
              { label: 'Наличные', value: 'CASH' },
              { label: 'Перечисление', value: 'TRANSFER' },
              { label: 'Payme', value: 'PAYME' },
              { label: 'QR', value: 'QR' },
              { label: 'Click', value: 'CLICK' },
              { label: 'Терминал', value: 'TERMINAL' },
            ]} />
          </Form.Item>
          <Form.Item name="paidAt" label="Дата оплаты">
            <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" disabledDate={(current) => current && current.isAfter(dayjs())} />
          </Form.Item>
          <Form.Item name="note" label="Примечание">
            <Input.TextArea rows={2} placeholder="Примечание к платежу..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Contract Modal */}
      <Modal
        title="Создать договор"
        open={createContractModal}
        onCancel={() => setCreateContractModal(false)}
        onOk={() => contractForm.submit()}
        confirmLoading={createContractMut.isPending}
        okText="Создать и прикрепить"
        cancelText="Отмена"
      >
        <Form form={contractForm} layout="vertical" onFinish={(v) => createContractMut.mutate({
          contractNumber: v.contractNumber,
          contractType: v.contractType || 'ONE_TIME',
          amount: v.amount || 0,
          startDate: v.startDate.format('YYYY-MM-DD'),
          endDate: v.endDate ? v.endDate.format('YYYY-MM-DD') : undefined,
          notes: v.notes || undefined,
        })}
        onValuesChange={(changed) => {
          if (changed.contractType) {
            const start = contractForm.getFieldValue('startDate') || dayjs();
            if (changed.contractType === 'ANNUAL') {
              contractForm.setFieldsValue({ startDate: start, endDate: dayjs(start).endOf('year') });
            } else {
              contractForm.setFieldsValue({ endDate: undefined });
            }
          }
        }}
        >
          <Form.Item name="contractType" label="Тип договора" initialValue="ONE_TIME">
            <Radio.Group>
              <Radio.Button value="ONE_TIME">Разовый</Radio.Button>
              <Radio.Button value="ANNUAL">Годовой</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="contractNumber" label="Номер договора" rules={[{ required: true, message: 'Укажите номер' }]}>
            <Input placeholder="Например: Д-2026-001" />
          </Form.Item>
          <Form.Item name="amount" label="Сумма договора">
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Form.Item name="startDate" label="Дата начала" rules={[{ required: true, message: 'Обязательно' }]}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="endDate" label="Дата окончания">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </div>
          <Form.Item name="notes" label="Примечание">
            <Input.TextArea rows={2} placeholder="Примечание к договору..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Attach Existing Contract Modal */}
      <Modal
        title="Прикрепить существующий договор"
        open={attachContractModal}
        onCancel={() => setAttachContractModal(false)}
        footer={null}
      >
        {(clientContracts ?? []).length === 0 ? (
          <Typography.Text type="secondary">
            Нет доступных договоров для этого клиента. Создайте новый договор.
          </Typography.Text>
        ) : (
          <List
            dataSource={(clientContracts ?? []).filter((c: ContractListItem) => c.isActive)}
            renderItem={(contract: ContractListItem) => (
              <List.Item
                actions={[
                  <Button
                    key="attach"
                    type="primary"
                    size="small"
                    loading={attachContractMut.isPending}
                    onClick={() => attachContractMut.mutate(contract.id)}
                  >
                    Прикрепить
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={contract.contractNumber}
                  description={`Сумма: ${formatUZS(contract.amount)} | Сделок: ${contract.dealsCount}`}
                />
              </List.Item>
            )}
          />
        )}
        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          style={{ marginTop: 12 }}
          onClick={() => {
            setAttachContractModal(false);
            contractForm.resetFields();
            contractForm.setFieldsValue({ startDate: dayjs(), amount: Number(deal.amount) || 0 });
            setCreateContractModal(true);
          }}
        >
          Создать новый договор
        </Button>
      </Modal>

      {/* SUPER_ADMIN: Override Modal */}
      {isSuperAdmin && (
        <SuperOverrideModal
          open={overrideModal}
          deal={deal}
          products={products ?? []}
          users={users ?? []}
          clients={(clients ?? []).map((c) => ({ id: c.id, companyName: c.companyName }))}
          onClose={() => setOverrideModal(false)}
          onSuccess={() => invalidate()}
        />
      )}

      {/* SUPER_ADMIN: Delete Confirm Modal */}
      <Modal
        title={<Typography.Text type="danger" strong>Удалить сделку</Typography.Text>}
        open={deleteConfirmModal}
        onCancel={() => { setDeleteConfirmModal(false); setDeleteReason(''); }}
        onOk={() => {
          if (deleteReason.trim().length < 3) {
            message.error('Укажите причину удаления (мин. 3 символа)');
            return;
          }
          deleteDealMut.mutate(deleteReason.trim());
        }}
        confirmLoading={deleteDealMut.isPending}
        okText="Удалить навсегда"
        okButtonProps={{ danger: true }}
        cancelText="Отмена"
      >
        <Alert
          type="error"
          showIcon
          message="Это действие необратимо!"
          description="Сделка и все связанные данные (товары, комментарии, платежи) будут удалены. Складские движения блокируют удаление."
          style={{ marginBottom: 16 }}
        />
        <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Причина удаления *</Typography.Text>
        <Input.TextArea
          rows={3}
          value={deleteReason}
          onChange={(e) => setDeleteReason(e.target.value)}
          placeholder="Укажите причину удаления (мин. 3 символа)..."
          status={deleteReason.length > 0 && deleteReason.length < 3 ? 'error' : undefined}
        />
      </Modal>
    </div>
  );
}
