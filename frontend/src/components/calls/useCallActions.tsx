import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { callsApi, type CallListItem } from '../../api/calls.api';
import CallDetailDrawer from './CallDetailDrawer';
import { CreateClientModal, LinkClientModal } from './CallClientModals';
import type { CallRowActions } from './CallsList';
import { apiErrorMessage } from './callsUi';

type CallRef = { id: string; counterpart: string | null };

/** Карточка звонка, привязка/создание клиента и задача «перезвонить» — общие для журнала и карточки клиента. */
export function useCallActions(opts: { openCallId?: string | null; onOpenChange?: (id: string | null) => void } = {}) {
  const queryClient = useQueryClient();
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const openId = opts.onOpenChange ? opts.openCallId ?? null : localOpenId;
  const setOpenId = opts.onOpenChange ?? setLocalOpenId;
  const [linkFor, setLinkFor] = useState<CallRef | null>(null);
  const [createFor, setCreateFor] = useState<CallRef | null>(null);

  const actions: CallRowActions = {
    onOpen: (c: CallListItem) => setOpenId(c.id),
    onLinkClient: (c) => setLinkFor(c),
    onCreateClient: (c) => setCreateFor(c),
    onCallbackTask: async (c) => {
      try {
        const r = await callsApi.callbackTask(c.id);
        message.success(r.existing ? 'Задача «перезвонить» по этому номеру уже есть' : 'Задача «перезвонить» создана');
        queryClient.invalidateQueries({ queryKey: ['call', c.id] });
      } catch (err) {
        message.error(apiErrorMessage(err));
      }
    },
  };

  const elements = (
    <>
      <CallDetailDrawer
        callId={openId}
        onClose={() => setOpenId(null)}
        onLinkClient={(c) => setLinkFor(c)}
        onCreateClient={(c) => setCreateFor(c)}
      />
      <LinkClientModal call={linkFor} open={!!linkFor} onClose={() => setLinkFor(null)} />
      <CreateClientModal call={createFor} open={!!createFor} onClose={() => setCreateFor(null)} />
    </>
  );

  return { actions, elements };
}
