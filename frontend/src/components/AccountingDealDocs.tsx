import { Typography } from 'antd';
import dayjs from 'dayjs';
import type { AccountingChange } from '../api/accountingChanges.api';

/** Договор, ИНН и юр. имя — по ним бухгалтер находит свои документы. */
export default function AccountingDealDocs({ deal, compact = false }: { deal: NonNullable<AccountingChange['deal']>; compact?: boolean }) {
  const size = compact ? 12 : 13;
  return (
    <div style={{ marginTop: 6, display: 'grid', gap: 2, fontSize: size }}>
      {deal.contract && (
        <Typography.Text style={{ fontSize: size }}>
          Договор <Typography.Text strong style={{ fontSize: size }}>№{deal.contract.contractNumber}</Typography.Text>
          {' от '}{dayjs(deal.contract.startDate).format('DD.MM.YYYY')}
          {deal.contract.contractType === 'ANNUAL' ? ' · годовой' : ''}
        </Typography.Text>
      )}
      {deal.inn && (
        <Typography.Text style={{ fontSize: size }}>
          ИНН <Typography.Text code style={{ fontSize: size }}>{deal.inn}</Typography.Text>
          {deal.legalName
            ? <> · <Typography.Text strong style={{ fontSize: size }}>{deal.legalName}</Typography.Text></>
            : <Typography.Text type="secondary" style={{ fontSize: size }}> · юр. имя не найдено</Typography.Text>}
        </Typography.Text>
      )}
    </div>
  );
}
