import { Tag, Tooltip } from 'antd';
import type { Deal } from '../types';

/** Метка «📍 филиал» у сделки, которую везут не на основной адрес клиента. */
export default function DeliveryLocationTag({ deal }: { deal: Pick<Deal, 'deliveryType' | 'deliveryLocation'> }) {
  const loc = deal.deliveryLocation;
  if (deal.deliveryType !== 'DELIVERY' || !loc) return null;
  const details = [loc.address, [loc.contactName, loc.phone].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  return (
    <Tooltip title={details || undefined}>
      <Tag color="gold" style={{ marginInlineEnd: 0 }}>📍 {loc.name}</Tag>
    </Tooltip>
  );
}
