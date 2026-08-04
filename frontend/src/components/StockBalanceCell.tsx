import { Typography } from 'antd';

type Num = string | number | null | undefined;

function toNum(v: Num): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Убираем хвост из нулей: 900.000 → 900, 22.100 → 22.1 */
function trim(n: number): string {
  return String(Number.isInteger(n) ? n : parseFloat(n.toFixed(3)));
}

export interface StockBalanceSource {
  stockBefore?: Num;
  stockAfter?: Num;
  rollStockBefore?: Num;
  rollStockAfter?: Num;
}

/**
 * «Было → Стало» по движению склада. Показывает прочерк, если снимок не записан
 * (движение сделано до появления этих полей) — вычислять задним числом нельзя,
 * часть остатков правилась в обход журнала движений.
 */
export default function StockBalanceCell({ movement }: { movement: StockBalanceSource }) {
  const before = toNum(movement.stockBefore);
  const after = toNum(movement.stockAfter);
  const rollBefore = toNum(movement.rollStockBefore);
  const rollAfter = toNum(movement.rollStockAfter);

  if (before == null || after == null) {
    return <Typography.Text type="secondary">—</Typography.Text>;
  }

  const hasRolls = rollBefore != null && rollAfter != null;

  return (
    <div style={{ lineHeight: 1.35 }}>
      <span style={{ whiteSpace: 'nowrap' }}>
        <Typography.Text type="secondary">{trim(before)}</Typography.Text>
        <Typography.Text type="secondary"> → </Typography.Text>
        <Typography.Text strong>{trim(after)}</Typography.Text>
      </span>
      {hasRolls && (
        <div style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
          <Typography.Text type="secondary">
            {trim(rollBefore)} → {trim(rollAfter)} рул.
          </Typography.Text>
        </div>
      )}
    </div>
  );
}
