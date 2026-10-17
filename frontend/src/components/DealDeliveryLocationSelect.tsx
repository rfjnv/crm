import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, Typography, message } from 'antd';
import { clientsApi } from '../api/clients.api';
import { dealsApi } from '../api/deals.api';
import type { Deal } from '../types';

const LOCKED_STATUSES = new Set(['CLOSED', 'CANCELED', 'REJECTED']);

/** Куда везти сделку: основной адрес клиента или один из его филиалов. */
export default function DealDeliveryLocationSelect({ deal }: { deal: Deal }) {
  const qc = useQueryClient();
  const clientAddress = deal.client?.address;
  const editable = !LOCKED_STATUSES.has(deal.status);

  const { data: locations } = useQuery({
    queryKey: ['client-locations', deal.clientId],
    queryFn: () => clientsApi.locations(deal.clientId),
    enabled: editable,
  });

  const mut = useMutation({
    mutationFn: (deliveryLocationId: string | null) => dealsApi.update(deal.id, { deliveryLocationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deal', deal.id] });
      message.success('Адрес доставки изменён');
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Не удалось изменить');
    },
  });

  const mainLabel = `Основной адрес${clientAddress ? ` — ${clientAddress}` : ''}`;
  const current = deal.deliveryLocation;

  if (!editable || !locations || locations.length === 0) {
    return current ? (
      <span>
        📍 <b>{current.name}</b>
        {current.address ? ` — ${current.address}` : ''}
        {(current.contactName || current.phone) && (
          <Typography.Text type="secondary"> · {[current.contactName, current.phone].filter(Boolean).join(', ')}</Typography.Text>
        )}
      </span>
    ) : <span>{mainLabel}</span>;
  }

  return (
    <Select
      style={{ minWidth: 220, maxWidth: '100%' }}
      value={deal.deliveryLocationId ?? ''}
      loading={mut.isPending}
      disabled={mut.isPending}
      onChange={(v: string) => mut.mutate(v || null)}
      options={[
        { value: '', label: mainLabel },
        ...locations.map((l) => ({ value: l.id, label: `📍 ${l.name}${l.address ? ` — ${l.address}` : ''}` })),
      ]}
    />
  );
}
