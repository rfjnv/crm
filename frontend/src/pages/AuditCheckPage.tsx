import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DatePicker, Typography, Tag, Spin, Empty, Button, Checkbox, Progress, Popconfirm, Input, Modal, Tooltip,
} from 'antd';
import {
  ThunderboltOutlined, ExportOutlined, CheckCircleFilled, SearchOutlined, LeftOutlined, RightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { dealsApi } from '../api/deals.api';
import { usersApi } from '../api/users.api';
import { clientsApi } from '../api/clients.api';
import { inventoryApi } from '../api/warehouse.api';
import SuperOverridePanel from '../components/SuperOverridePanel';
import BackButton from '../components/BackButton';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { formatUZS } from '../utils/currency';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import type { Deal, DealItem, PaymentStatus, UserRole } from '../types';
import { getFirstName } from '../lib/name-utils';
import ReceiptPunchedTag from '../components/ReceiptPunchedTag';
import './AuditCheckPage.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  UNPAID: 'default', PARTIAL: 'orange', PAID: 'green',
};
const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Не оплачено', PARTIAL: 'Частично', PAID: 'Оплачено',
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные', TRANSFER: 'Перечисление', PAYME: 'Payme',
  QR: 'QR', CLICK: 'Click', TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка', DEBT: 'Долг',
};
const PAYMENT_TYPE_LABELS: Record<string, string> = {
  FULL: 'полная', PARTIAL: 'частичная', INSTALLMENT: 'рассрочка',
};
const DELIVERY_LABELS: Record<string, string> = {
  SELF_PICKUP: 'Самовывоз', YANDEX: 'Яндекс', DELIVERY: 'Доставка',
};

function isoRangeForTashkentYmd(ymd: string) {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    closedFrom: new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00+05:00`).toISOString(),
    closedTo: new Date(`${y}-${pad(m)}-${pad(d)}T23:59:59.999+05:00`).toISOString(),
  };
}

function formatQty(v: number | string | null | undefined): string {
  if (v == null) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

function dealMatchesSearch(deal: Deal, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    deal.title,
    deal.client?.companyName,
    deal.client?.contactName,
    deal.manager?.fullName,
    deal.vehicleNumber,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * В классическом дизайне шапка приложения липкая — шапку страницы прижимаем под неё.
 * В новом дизайне прокручивается содержимое окна, шапки над ним нет — прижимаем к верху.
 */
function useStickyTopOffset() {
  const [top, setTop] = useState(0);
  useEffect(() => {
    if (document.documentElement.dataset.design === 'modern') return;
    const header = document.querySelector('.ant-layout-header');
    if (!header) return;
    const update = () => setTop(header.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return top;
}

function Fact({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'neg' }) {
  return (
    <span className="audit-fact">
      <span className="audit-fact__label">{label}</span>
      <span className={tone === 'neg' ? 'audit-fact__value audit-neg' : 'audit-fact__value'}>{children}</span>
    </span>
  );
}

// ─── Deal card ────────────────────────────────────────────────────────────────

function DealAuditCard({ deal, onOverride, checked, onToggle }: {
  deal: Deal;
  onOverride?: (id: string) => void;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  // Проверенная сделка сворачивается до строки — внимание остаётся на непроверенных.
  // Ручное раскрытие действует, пока не сменилась отметка.
  const [manual, setManual] = useState<{ checked: boolean; open: boolean } | null>(null);
  const open = manual && manual.checked === checked ? manual.open : !checked;
  const setOpen = (fn: (v: boolean) => boolean) => setManual({ checked, open: fn(open) });

  const { data: detail, isLoading } = useQuery({
    queryKey: ['deal', deal.id],
    queryFn: () => dealsApi.getById(deal.id),
  });
  const { data: payments = [] } = useQuery({
    queryKey: ['deal-payments', deal.id],
    queryFn: () => dealsApi.getDealPayments(deal.id),
  });

  const d = detail ?? deal;
  const items: DealItem[] = detail?.items ?? [];
  const debt = Number(d.amount) - Number(d.paidAmount);
  const itemsTotal = items.reduce((s, i) => s + Number(i.price ?? 0) * Number(i.requestedQty ?? 0), 0);

  return (
    <article className={`audit-card${checked ? ' is-checked' : ''}`}>
      <header className="audit-card__head">
        <Checkbox
          checked={checked}
          onChange={() => onToggle(deal.id)}
          aria-label={checked ? 'Отметить сделку как непроверенную' : 'Отметить сделку как проверенную'}
        />
        <button type="button" className="audit-card__title" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ClientCompanyDisplay client={deal.client} />
          <b>{formatUZS(deal.amount)}</b>
          <Tag color={PAYMENT_STATUS_COLORS[deal.paymentStatus]} style={{ margin: 0 }}>
            {PAYMENT_STATUS_LABELS[deal.paymentStatus]}
          </Tag>
          {deal.closedAt && <span className="audit-muted">{dayjs(deal.closedAt).format('HH:mm')}</span>}
          <ReceiptPunchedTag isReceiptPunched={deal.isReceiptPunched} />
          {checked && <Tag color="success" icon={<CheckCircleFilled />} style={{ margin: 0 }}>Проверено</Tag>}
        </button>
        <span className="audit-card__actions">
          <Tooltip title="Открыть сделку в новой вкладке">
            <Link to={`/deals/${deal.id}`} target="_blank">
              <Button size="small" type="text" icon={<ExportOutlined />} aria-label="Открыть сделку" />
            </Link>
          </Tooltip>
          {onOverride && (
            <Button size="small" icon={<ThunderboltOutlined />} onClick={() => onOverride(deal.id)}>
              Исправить
            </Button>
          )}
        </span>
      </header>

      {open && (isLoading ? (
        <Spin size="small" style={{ display: 'block', margin: '16px auto' }} />
      ) : (
        <div className="audit-card__body">
          <div className="audit-facts">
            <Fact label="Менеджер">{getFirstName(d.manager?.fullName) || '—'}</Fact>
            <Fact label="Оплата">
              {d.paymentMethod ? (PAYMENT_METHOD_LABELS[d.paymentMethod] ?? d.paymentMethod) : 'способ не указан'}
              {PAYMENT_TYPE_LABELS[d.paymentType] ? `, ${PAYMENT_TYPE_LABELS[d.paymentType]}` : ''}
            </Fact>
            <Fact label="Оплачено">{formatUZS(d.paidAmount)} из {formatUZS(d.amount)}</Fact>
            {debt > 0 && <Fact label="Долг" tone="neg">{formatUZS(debt)}</Fact>}
            {d.discount && Number(d.discount) > 0 && <Fact label="Скидка">{formatUZS(d.discount)}</Fact>}
            {d.dueDate && <Fact label="Срок оплаты">{dayjs(d.dueDate).format('DD.MM.YYYY')}</Fact>}
            {d.deliveryType && <Fact label="Доставка">{DELIVERY_LABELS[d.deliveryType] ?? d.deliveryType}</Fact>}
            {d.vehicleNumber && <Fact label="Машина">{d.vehicleNumber}{d.vehicleType ? ` (${d.vehicleType})` : ''}</Fact>}
            {d.contract && <Fact label="Договор">{d.contract.contractNumber}</Fact>}
            {d.transferInn && <Fact label="ИНН"><Typography.Text code>{d.transferInn}</Typography.Text></Fact>}
            <Fact label="Создана">{dayjs(d.createdAt).format('DD.MM.YYYY HH:mm')}</Fact>
            <Fact label="Закрыта">{d.closedAt ? dayjs(d.closedAt).format('DD.MM.YYYY HH:mm') : '—'}</Fact>
            {d.terms && <Fact label="Условия">{d.terms}</Fact>}
          </div>

          <div className="audit-lists">
            <section className="audit-list">
              <div className="audit-list__title">Товары · {items.length}</div>
              {items.length === 0 ? (
                <span className="audit-muted">Нет позиций</span>
              ) : (
                <>
                  {items.map((i) => (
                    <div key={i.id} className="audit-row audit-row--item">
                      <span className="audit-row__name">
                        {i.product?.name ?? '—'}
                        {i.product?.sku && <small>{i.product.sku}</small>}
                      </span>
                      <span className="audit-num">{formatQty(i.requestedQty)} {i.product?.unit ?? ''}</span>
                      <span className="audit-num audit-muted">× {i.price != null ? formatUZS(i.price) : '—'}</span>
                      <span className="audit-num">
                        {i.requestedQty != null && i.price != null ? formatUZS(Number(i.price) * Number(i.requestedQty)) : '—'}
                      </span>
                    </div>
                  ))}
                  {itemsTotal > 0 && (
                    <div className="audit-row audit-row--total">
                      <span>Итого</span>
                      <span className="audit-num">{formatUZS(itemsTotal)}</span>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="audit-list">
              <div className="audit-list__title">Платежи · {payments.length}</div>
              {payments.length === 0 ? (
                <span className="audit-muted">Платежей нет</span>
              ) : payments.map((p) => (
                <div key={p.id} className="audit-row audit-row--pay">
                  <span className="audit-muted">{dayjs(p.paidAt).format('DD.MM.YY HH:mm')}</span>
                  <span>
                    {p.method ? (PAYMENT_METHOD_LABELS[p.method] ?? p.method) : '—'}
                    <small> · {getFirstName(p.creator?.fullName) || '—'}</small>
                  </span>
                  <span className="audit-num">{formatUZS(p.amount)}</span>
                </div>
              ))}
            </section>
          </div>

          {detail?.shipment && (
            <div className="audit-facts audit-facts--shipment">
              <span className="audit-list__title">Отгрузка</span>
              <Fact label="Транспорт">{detail.shipment.vehicleType} · {detail.shipment.vehicleNumber}</Fact>
              <Fact label="Водитель">{detail.shipment.driverName}</Fact>
              <Fact label="Накладная">{detail.shipment.deliveryNoteNumber}</Fact>
              <Fact label="Отправлено">{dayjs(detail.shipment.departureTime).format('DD.MM.YYYY HH:mm')}</Fact>
            </div>
          )}
        </div>
      ))}
    </article>
  );
}

// ─── Суперредактирование — то же окно, что на карточке сделки ────────────────

function OverrideModal({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => dealsApi.getById(dealId),
  });
  const { data: payments = [] } = useQuery({
    queryKey: ['deal-payments', dealId],
    queryFn: () => dealsApi.getDealPayments(dealId),
  });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: inventoryApi.listProducts });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() });
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list });

  return (
    <Modal
      title={<>Суперредактирование <span className="so-modal-sub">{deal?.title ?? ''}</span></>}
      open
      onCancel={onClose}
      footer={null}
      width={isMobile ? '100vw' : 'min(1120px, calc(100vw - 48px))'}
      style={isMobile ? { top: 0, margin: 0, padding: 0, maxWidth: '100vw' } : { top: 24 }}
      styles={{
        body: isMobile
          ? { height: 'calc(var(--app-vh, 100dvh) - 57px)', overflow: 'auto' }
          : { maxHeight: 'calc(var(--app-vh, 100vh) - 140px)', overflow: 'auto' },
      }}
      destroyOnClose
    >
      {isLoading && <Spin style={{ display: 'block', margin: '40px auto' }} />}
      {deal && (
        <SuperOverridePanel
          variant="modal"
          deal={deal}
          payments={payments}
          products={products}
          users={users}
          clients={clients.map((c) => ({
            id: c.id,
            companyName: c.companyName,
            contactName: c.contactName ?? null,
            phone: c.phone ?? null,
            isSvip: c.isSvip,
          }))}
          onCancel={onClose}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['deal', dealId] });
            queryClient.invalidateQueries({ queryKey: ['deal-payments', dealId] });
            queryClient.invalidateQueries({ queryKey: ['audit-check-deals'] });
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AuditCheckPage() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role as UserRole | undefined;
  const canOverride = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const [params, setParams] = useSearchParams();
  const dateStr = params.get('date');
  const date: Dayjs = dateStr ? dayjs(dateStr) : dayjs();

  const [overrideDealId, setOverrideDealId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const stickyTop = useStickyTopOffset();

  const ymd = date.format('YYYY-MM-DD');
  const { closedFrom, closedTo } = isoRangeForTashkentYmd(ymd);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`audit-checked-${ymd}`);
      setCheckedIds(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch {
      setCheckedIds(new Set());
    }
    setSearch('');
  }, [ymd]);

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(`audit-checked-${ymd}`, JSON.stringify([...next]));
      } catch { /* хранилище недоступно — отметки живут до перезагрузки */ }
      return next;
    });
  };

  const setDate = (d: Dayjs | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (d) next.set('date', d.format('YYYY-MM-DD'));
      else next.delete('date');
      return next;
    });
  };

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['audit-check-deals', ymd],
    queryFn: () => dealsApi.list('CLOSED', true, { closedFrom, closedTo }),
  });

  const totalAmount = deals.reduce((s, d) => s + Number(d.amount), 0);
  const totalPaid = deals.reduce((s, d) => s + Number(d.paidAmount), 0);
  const checkedCount = deals.filter((d) => checkedIds.has(d.id)).length;
  const progressPercent = deals.length > 0 ? Math.round((checkedCount / deals.length) * 100) : 0;
  const allDone = deals.length > 0 && checkedCount === deals.length;
  const filteredDeals = deals.filter((d) => dealMatchesSearch(d, search));
  const isToday = date.isSame(dayjs(), 'day');

  return (
    <div className="audit-page">
      {/* Шапка страницы остаётся на месте при прокрутке */}
      <div className="audit-head" style={{ top: stickyTop }}>
        <div className="audit-head__row">
          <BackButton fallback="/dashboard" />
          <Typography.Title level={4} style={{ margin: 0 }}>Аудит сделок</Typography.Title>
          <span className="audit-head__date">
            <Button icon={<LeftOutlined />} onClick={() => setDate(date.subtract(1, 'day'))} aria-label="Предыдущий день" />
            <DatePicker value={date} onChange={setDate} format="DD.MM.YYYY" allowClear={false} />
            <Button icon={<RightOutlined />} disabled={isToday} onClick={() => setDate(date.add(1, 'day'))} aria-label="Следующий день" />
          </span>
          {deals.length > 0 && (
            <Input
              allowClear
              className="audit-head__search"
              prefix={<SearchOutlined />}
              placeholder="Клиент, менеджер, машина…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </div>

        {!isLoading && deals.length > 0 && (
          <div className="audit-head__row audit-head__stats">
            <span><b>{deals.length}</b> {deals.length === 1 ? 'сделка' : deals.length < 5 ? 'сделки' : 'сделок'} на <b>{formatUZS(totalAmount)}</b></span>
            {totalPaid < totalAmount && (
              <span>оплачено <b>{formatUZS(totalPaid)}</b> · <span className="audit-neg">долг <b>{formatUZS(totalAmount - totalPaid)}</b></span></span>
            )}
            <span className="audit-head__progress">
              <span>Проверено <b className={allDone ? 'audit-pos' : undefined}>{checkedCount}</b> из {deals.length}</span>
              <Progress
                percent={progressPercent}
                showInfo={false}
                size="small"
                strokeColor={allDone ? 'var(--c-pos-fg, var(--ant-color-success))' : undefined}
                style={{ flex: 1, margin: 0, minWidth: 80 }}
              />
              <Popconfirm
                title="Сбросить отметки?"
                description={`Отметки о проверке за ${date.format('DD.MM.YYYY')} будут удалены.`}
                okText="Сбросить"
                okButtonProps={{ danger: true }}
                cancelText="Отмена"
                onConfirm={() => {
                  setCheckedIds(new Set());
                  try { localStorage.removeItem(`audit-checked-${ymd}`); } catch { /* недоступно */ }
                }}
              >
                <Button size="small" type="link" danger disabled={checkedCount === 0}>Сбросить</Button>
              </Popconfirm>
            </span>
          </div>
        )}
      </div>

      {isLoading && <Spin style={{ display: 'block', margin: '60px auto' }} />}

      {!isLoading && deals.length === 0 && (
        <Empty description={`Нет закрытых сделок за ${date.format('DD.MM.YYYY')}`} style={{ marginTop: 60 }} />
      )}

      {!isLoading && deals.length > 0 && filteredDeals.length === 0 && (
        <Empty description={`Ничего не найдено по запросу «${search}»`} style={{ marginTop: 60 }} />
      )}

      <div className="audit-list-wrap">
        {filteredDeals.map((deal) => (
          <DealAuditCard
            key={deal.id}
            deal={deal}
            onOverride={canOverride ? setOverrideDealId : undefined}
            checked={checkedIds.has(deal.id)}
            onToggle={toggleChecked}
          />
        ))}
      </div>

      {overrideDealId && canOverride && (
        <OverrideModal dealId={overrideDealId} onClose={() => setOverrideDealId(null)} />
      )}
    </div>
  );
}
