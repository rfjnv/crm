import { HIDDEN_MONEY, formatMoneyCompact, formatUZS, moneyFormatter } from '../../utils/currency';
import './Money.css';

interface Props {
  value: number | string | null | undefined;
  /**
   * `compact` — «12,4 млн» для крупных чисел (Hero, Stat), полная сумма в `title`;
   * `full` — «12 400 000 so'm» для списков и таблиц.
   */
  variant?: 'compact' | 'full';
  className?: string;
}

/**
 * Денежная сумма. Число и единица — отдельными спанами, единица мельче (Caption).
 * Уважает скрытие сумм: уровень NONE и `null` от сервера показываются как «•••».
 * Отрицательные — со знаком и цветом риска.
 */
export default function Money({ value, variant = 'full', className }: Props) {
  const negative = value != null && Number(value) < 0;
  const classes = (modifier: string) =>
    ['ui-money', modifier, negative ? 'ui-money--negative' : '', className ?? ''].filter(Boolean).join(' ');

  if (variant === 'compact') {
    const m = formatMoneyCompact(value);
    if (m.hidden) return <span className={classes('ui-money--hidden')}>{m.text}</span>;
    return (
      <span className={classes('ui-money--compact')} title={m.full}>
        <span className="ui-money__value">{m.text}</span>
        {m.unit && <span className="ui-money__unit">{m.unit}</span>}
      </span>
    );
  }

  if (formatUZS(value) === HIDDEN_MONEY) {
    return <span className={classes('ui-money--hidden')}>{HIDDEN_MONEY}</span>;
  }
  const num = Number(value);
  return (
    <span className={classes('ui-money--full')}>
      <span className="ui-money__value">{(negative ? '−' : '') + moneyFormatter(Math.abs(num))}</span>
      <span className="ui-money__unit">so’m</span>
    </span>
  );
}
