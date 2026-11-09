import type { ReactNode } from 'react';
import { Typography, theme } from 'antd';
import dayjs from 'dayjs';
import DealStatusTag from './DealStatusTag';
import type { DealStatus } from '../types';
import { formatUZS } from '../utils/currency';

/**
 * Человеческий разбор записи аудита: вместо двух простыней JSON «до/после»
 * показываем только то, что реально поменялось, по-русски и с названиями товаров.
 */

export interface AuditNames {
  /** productId → название товара */
  products?: Map<string, string>;
  /** userId → ФИО */
  users?: Map<string, string>;
}

type Obj = Record<string, unknown>;

const FIELD_LABELS: Record<string, string> = {
  title: 'Название',
  status: 'Статус',
  amount: 'Сумма',
  lineTotal: 'Сумма строки',
  finalAmount: 'Итоговая сумма',
  paidAmount: 'Оплачено',
  discount: 'Скидка',
  terms: 'Условия',
  dueDate: 'Срок оплаты',
  closedAt: 'Дата закрытия',
  clientId: 'Клиент',
  managerId: 'Менеджер',
  contractId: 'Договор',
  paymentType: 'Тип оплаты',
  paymentMethod: 'Способ оплаты',
  paymentStatus: 'Статус оплаты',
  isSessionDeal: 'Сеансовая сделка',
  isReceiptPunched: 'Чек пробит',
  deliveryLocationId: 'Адрес доставки',
  reason: 'Причина',
  respondedItems: 'Позиций с ответом склада',
  respondedVia: 'Ответ склада через',
  shipment: 'Отгрузка',
  payments: 'Платежи',
  comments: 'Комментарии',
  items: 'Товары',
  // поля позиций и отгрузки
  productId: 'Товар',
  productName: 'Товар',
  requestedQty: 'Кол-во',
  qty: 'Кол-во',
  price: 'Цена',
  rollCount: 'Рулонов',
  dealDate: 'Дата сделки',
  confirmedAt: 'Подтверждено',
  shippedAt: 'Отгружено',
  deliveredAt: 'Доставлено',
  priceSource: 'Откуда цена',
  via: 'Через',
  vehicleType: 'Тип машины',
  vehicleNumber: 'Номер машины',
  driverName: 'Водитель',
  departureTime: 'Время выезда',
  deliveryNoteNumber: '№ накладной',
};

const MONEY_FIELDS = new Set(['amount', 'lineTotal', 'finalAmount', 'paidAmount', 'discount', 'price']);
/** Технические поля, которые в разборе только мешают. */
const SKIP_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

const PAYMENT_METHOD: Record<string, string> = {
  CASH: 'Наличные', TRANSFER: 'Перечисление', PAYME: 'Payme', QR: 'QR', CLICK: 'Click',
  TERMINAL: 'Терминал', INSTALLMENT: 'Рассрочка', DEBT: 'Долг',
};
const PAYMENT_TYPE: Record<string, string> = { FULL: 'Полная', PARTIAL: 'Частичная', INSTALLMENT: 'Рассрочка' };
const PAYMENT_STATUS: Record<string, string> = { UNPAID: 'Не оплачено', PARTIAL: 'Частично', PAID: 'Оплачено' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v: unknown) => v === null || v === undefined || v === '';
const same = (a: unknown, b: unknown) => (isEmpty(a) && isEmpty(b)) || JSON.stringify(a) === JSON.stringify(b);
const label = (key: string) => FIELD_LABELS[key] ?? key;

function formatValue(key: string, v: unknown, names: AuditNames): ReactNode {
  if (isEmpty(v)) return '—';
  if (key === 'status' && typeof v === 'string') return <DealStatusTag status={v as DealStatus} />;
  if (key === 'paymentMethod') return PAYMENT_METHOD[String(v)] ?? String(v);
  if (key === 'paymentType') return PAYMENT_TYPE[String(v)] ?? String(v);
  if (key === 'paymentStatus') return PAYMENT_STATUS[String(v)] ?? String(v);
  if (key === 'productId') return names.products?.get(String(v)) ?? 'другой товар';
  if (key === 'managerId' || key === 'userId') return names.users?.get(String(v)) ?? 'другой сотрудник';
  if (key === 'clientId' || key === 'contractId' || key === 'deliveryLocationId') return 'указан';
  if (MONEY_FIELDS.has(key) && !Number.isNaN(Number(v))) return formatUZS(Number(v));
  if (typeof v === 'boolean') return v ? 'Да' : 'Нет';
  if (typeof v === 'number') return v.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  if (typeof v === 'string' && ISO_DATE.test(v)) {
    const d = dayjs(v);
    return d.hour() === 0 && d.minute() === 0 ? d.format('DD.MM.YYYY') : d.format('DD.MM.YYYY HH:mm');
  }
  if (Array.isArray(v)) return `${v.length} шт.`;
  if (isObj(v)) return JSON.stringify(v);
  return String(v);
}

function Change({ field, from, to, names, onlyNew }: {
  field: string; from?: unknown; to: unknown; names: AuditNames; onlyNew?: boolean;
}) {
  const { token: tk } = theme.useToken();
  return (
    <span>
      <Typography.Text type="secondary">{label(field)}: </Typography.Text>
      {!onlyNew && (
        <>
          <span style={{ textDecoration: 'line-through', color: tk.colorTextTertiary }}>{formatValue(field, from, names)}</span>
          {' → '}
        </>
      )}
      <Typography.Text strong>{formatValue(field, to, names)}</Typography.Text>
    </span>
  );
}

function itemName(item: Obj, names: AuditNames): string {
  if (typeof item.productName === 'string') return item.productName;
  if (typeof item.productId === 'string') return names.products?.get(item.productId) ?? 'Товар';
  return 'Товар';
}

interface Line { key: string; node: ReactNode }

function diffItems(before: unknown[], after: unknown[], names: AuditNames, Row: (p: { children: ReactNode; tone?: 'add' | 'del' }) => ReactNode): Line[] {
  const lines: Line[] = [];
  const b = before.filter(isObj);
  const a = after.filter(isObj);
  const byId = new Map(b.filter((i) => i.id).map((i) => [String(i.id), i]));
  const seen = new Set<string>();

  a.forEach((item, idx) => {
    const id = item.id ? String(item.id) : '';
    const prev = id ? byId.get(id) : undefined;
    const name = itemName(item, names);
    if (!prev) {
      lines.push({
        key: `add-${id || idx}`,
        node: Row({
          tone: 'add',
          children: (<><Typography.Text strong>+ {name}</Typography.Text>{' '}{describeItem(item, names)}</>),
        }),
      });
      return;
    }
    seen.add(id);
    const changed = Object.keys({ ...prev, ...item }).filter(
      (k) => !SKIP_FIELDS.has(k) && k !== 'productName' && !same(prev[k], item[k]),
    );
    if (changed.length === 0) return;
    const prevQty = Number(prev.requestedQty ?? prev.qty);
    const nextQty = Number(item.requestedQty ?? item.qty);
    const prevSum = prevQty * Number(prev.price);
    const nextSum = nextQty * Number(item.price);
    const sumChanged = Number.isFinite(prevSum) && Number.isFinite(nextSum) && prevSum !== nextSum
      && (changed.includes('requestedQty') || changed.includes('qty') || changed.includes('price'));
    lines.push({
      key: `chg-${id}`,
      node: Row({
        children: (
          <>
            <Typography.Text strong>{name}</Typography.Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12 }}>
              {changed.map((k) => <Change key={k} field={k} from={prev[k]} to={item[k]} names={names} />)}
              {sumChanged && <Change field="lineTotal" from={prevSum} to={nextSum} names={names} />}
            </div>
          </>
        ),
      }),
    });
  });

  b.forEach((item, idx) => {
    const id = item.id ? String(item.id) : '';
    if (id && seen.has(id)) return;
    if (id && a.some((x) => String(x.id) === id)) return;
    lines.push({
      key: `del-${id || idx}`,
      node: Row({
        tone: 'del',
        children: (<><Typography.Text strong delete>− {itemName(item, names)}</Typography.Text>{' '}{describeItem(item, names)}</>),
      }),
    });
  });
  return lines;
}

function describeItem(item: Obj, names: AuditNames): ReactNode {
  const qty = item.requestedQty ?? item.qty;
  const parts: ReactNode[] = [];
  if (!isEmpty(qty)) parts.push(<span key="q">{formatValue('requestedQty', qty, names)} шт.</span>);
  if (!isEmpty(item.price)) parts.push(<span key="p">по {formatValue('price', item.price, names)}</span>);
  if (!isEmpty(item.rollCount)) parts.push(<span key="r">{formatValue('rollCount', item.rollCount, names)} рул.</span>);
  if (parts.length === 0) return null;
  return <Typography.Text type="secondary">{parts.map((p, i) => <span key={i}>{i > 0 ? ', ' : ''}{p}</span>)}</Typography.Text>;
}

/** Есть ли в записи что показать (чтобы не рисовать пустые блоки). */
export function hasAuditChanges(before?: Obj | null, after?: Obj | null): boolean {
  if (!after && !before) return false;
  if (!before || !after) return Object.keys((after ?? before)!).some((k) => !SKIP_FIELDS.has(k));
  return Object.keys({ ...before, ...after }).some((k) => !SKIP_FIELDS.has(k) && !same(before[k], after[k]));
}

export default function AuditChanges({ before, after, names = {}, fontSize = 12 }: {
  before?: Obj | null;
  after?: Obj | null;
  names?: AuditNames;
  fontSize?: number;
}) {
  const { token: tk } = theme.useToken();
  if (!before && !after) return null;

  const Row = ({ children, tone }: { children: ReactNode; tone?: 'add' | 'del' }) => (
    <div style={{
      padding: '2px 0 2px 8px',
      borderLeft: `2px solid ${tone === 'add' ? tk.colorSuccess : tone === 'del' ? tk.colorError : tk.colorBorder}`,
      marginTop: 4,
    }}>
      {children}
    </div>
  );

  const lines: Line[] = [];
  const b = before ?? {};
  const a = after ?? {};
  const onlyNew = !before;
  const onlyOld = !after;
  const keys = Object.keys({ ...b, ...a }).filter((k) => !SKIP_FIELDS.has(k));

  for (const k of keys) {
    const from = b[k];
    const to = a[k];
    if (!onlyNew && !onlyOld && same(from, to)) continue;

    if (k === 'items' && (Array.isArray(from) || Array.isArray(to))) {
      lines.push(...diffItems(Array.isArray(from) ? from : [], Array.isArray(to) ? to : [], names, Row));
      continue;
    }
    // У платежей и комментариев в снимке только id и даты — важно лишь сколько их стало.
    if ((k === 'payments' || k === 'comments') && (Array.isArray(from) || Array.isArray(to))) {
      const fl = Array.isArray(from) ? from.length : 0;
      const tl = Array.isArray(to) ? to.length : 0;
      if (fl === tl && !onlyNew) continue;
      lines.push({ key: k, node: <Row><Change field={k} from={`${fl}`} to={`${tl}`} names={names} onlyNew={onlyNew} /></Row> });
      continue;
    }
    if (isObj(from) || isObj(to)) {
      const fo = isObj(from) ? from : {};
      const tobj = isObj(to) ? to : {};
      const sub = Object.keys({ ...fo, ...tobj }).filter((sk) => onlyNew || !same(fo[sk], tobj[sk]));
      if (sub.length === 0) continue;
      lines.push({
        key: k,
        node: (
          <Row>
            <Typography.Text strong>{label(k)}</Typography.Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12 }}>
              {sub.map((sk) => <Change key={sk} field={sk} from={fo[sk]} to={tobj[sk]} names={names} onlyNew={onlyNew} />)}
            </div>
          </Row>
        ),
      });
      continue;
    }
    lines.push({
      key: k,
      node: <Row><Change field={k} from={from} to={onlyOld ? from : to} names={names} onlyNew={onlyNew || onlyOld} /></Row>,
    });
  }

  if (lines.length === 0) {
    return <Typography.Text type="secondary" style={{ fontSize }}>Без видимых изменений</Typography.Text>;
  }
  return <div style={{ fontSize, marginTop: 4 }}>{lines.map((l) => <div key={l.key}>{l.node}</div>)}</div>;
}
