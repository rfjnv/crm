import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Select, Typography, message } from 'antd';
import { usersApi } from '../../api/users.api';
import { callsApi } from '../../api/calls.api';
import { apiErrorMessage } from './callsUi';

/** «Это был другой менеджер»: звонки, их аудиты и открытые задачи переходят выбранному сотруднику. */
export default function ReassignCallsModal({ callIds, open, onClose, onDone }: {
  callIds: string[];
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const [managerId, setManagerId] = useState<string | undefined>();
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(), enabled: open });

  const mut = useMutation({
    mutationFn: () => callsApi.reassign(callIds, managerId!),
    onSuccess: (r) => {
      message.success(`Звонков переписано на ${r.managerName}: ${r.updated}`);
      queryClient.invalidateQueries({ queryKey: ['calls'] });
      queryClient.invalidateQueries({ queryKey: ['call'] });
      queryClient.invalidateQueries({ queryKey: ['calls-missed'] });
      queryClient.invalidateQueries({ queryKey: ['client-calls'] });
      setManagerId(undefined);
      onDone?.();
      onClose();
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  return (
    <Modal
      title="Чей это звонок"
      open={open}
      onCancel={onClose}
      onOk={() => mut.mutate()}
      okText="Сохранить"
      okButtonProps={{ disabled: !managerId, loading: mut.isPending }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Выбрано звонков: {callIds.length}. Если за менеджера на звонок ответил коллега, укажите, кто говорил:
        звонки, их аудиты и открытые задачи «перезвонить» перейдут к нему.
      </Typography.Paragraph>
      <Select
        showSearch
        style={{ width: '100%' }}
        placeholder="Сотрудник"
        value={managerId}
        onChange={setManagerId}
        optionFilterProp="label"
        options={users.filter((u) => u.isActive).map((u) => ({ value: u.id, label: u.fullName }))}
      />
    </Modal>
  );
}
