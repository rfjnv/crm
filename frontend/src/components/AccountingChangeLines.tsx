import { Tag, Typography } from 'antd';
import type { AccountingChangeLine } from '../api/accountingChanges.api';
import { formatPrice, formatUZS } from '../utils/currency';

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные',
  TRANSFER: 'Перечисление',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка',
  DEBT: 'Долг',
};

const KIND: Record<AccountingChangeLine['kind'], { label: string; color: string }> = {
  price: { label: 'Цена', color: 'orange' },
  qty: { label: 'Кол-во', color: 'blue' },
  added: { label: 'Добавлен', color: 'green' },
  removed: { label: 'Убран', color: 'red' },
  amount: { label: 'Сумма', color: 'purple' },
  discount: { label: 'Скидка', color: 'magenta' },
  vat: { label: 'НДС', color: 'gold' },
  paymentMethod: { label: 'Оплата', color: 'cyan' },
};

const qty = (v: unknown) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
/** Цена может прийти списком «90 / 100», если товар стоит несколькими позициями. */
const price = (v: unknown) => (typeof v === 'number' ? formatPrice(v) : String(v ?? '—'));

function valueText(l: AccountingChangeLine): { before?: string; after?: string } {
  switch (l.kind) {
    case 'price': return { before: price(l.before), after: price(l.after) };
    case 'qty': return { before: `${qty(l.before)} ${l.unit ?? ''}`, after: `${qty(l.after)} ${l.unit ?? ''}` };
    case 'added': return { after: `${l.after} ${l.unit ?? ''}`.trim() };
    case 'removed': return { before: `${qty(l.before)} ${l.unit ?? ''}` };
    case 'amount':
    case 'discount': return { before: formatUZS(Number(l.before)), after: formatUZS(Number(l.after)) };
    case 'vat': return { before: l.before ? 'с НДС' : 'без НДС', after: l.after ? 'с НДС' : 'без НДС' };
    case 'paymentMethod': return {
      before: METHOD_LABELS[String(l.before)] ?? String(l.before ?? '—'),
      after: METHOD_LABELS[String(l.after)] ?? String(l.after ?? '—'),
    };
  }
}

/** Список изменений сделки «было → стало» для бухгалтера. */
export default function AccountingChangeLines({ lines, limit }: { lines: AccountingChangeLine[]; limit?: number }) {
  const shown = limit ? lines.slice(0, limit) : lines;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {shown.map((l, i) => {
        const v = valueText(l);
        return (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 13 }}>
            <Tag color={KIND[l.kind].color} style={{ marginInlineEnd: 0 }}>{KIND[l.kind].label}</Tag>
            {l.product && <Typography.Text>{l.product}</Typography.Text>}
            {v.before && <Typography.Text delete={l.kind !== 'removed'} type="secondary">{v.before}</Typography.Text>}
            {v.before && v.after && <Typography.Text type="secondary">→</Typography.Text>}
            {v.after && <Typography.Text strong>{v.after}</Typography.Text>}
          </div>
        );
      })}
      {limit && lines.length > limit && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>и ещё {lines.length - limit}</Typography.Text>
      )}
    </div>
  );
}
