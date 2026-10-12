import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DatePicker, Input, Modal, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { attendanceApi } from '../api/attendance.api';
import { ATTENDANCE_MARKS } from '../constants/attendanceMarks';

export interface AttendanceMarkTarget {
  /** Не задан — HR выбирает сотрудника в самом окне. */
  userId?: string;
  userName?: string;
  date: Dayjs;
  marks?: string[];
  note?: string | null;
}

interface Props {
  target: AttendanceMarkTarget | null;
  /** Для выбора сотрудника, когда окно открыто без конкретного человека. */
  userOptions?: { value: string; label: string }[];
  onClose: () => void;
}

/** Плашки HR за день («не пришёл», «больничный»…) и комментарий. */
export default function AttendanceMarkModal({ target, userOptions = [], onClose }: Props) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | undefined>();
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [marks, setMarks] = useState<string[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!target) return;
    setUserId(target.userId);
    setDate(target.date);
    setMarks(target.marks ?? []);
    setNote(target.note ?? '');
  }, [target]);

  const save = useMutation({
    mutationFn: () =>
      attendanceApi.mark({ userId: userId!, date: date.format('YYYY-MM-DD'), marks, note: note.trim() || null }),
    onSuccess: () => {
      message.success('Отметка сохранена');
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['employee-cards'] });
      queryClient.invalidateQueries({ queryKey: ['employee-card'] });
      queryClient.invalidateQueries({ queryKey: ['manager-kpi'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Не удалось сохранить отметку');
    },
  });

  const toggle = (key: string, checked: boolean) =>
    setMarks((prev) => (checked ? [...prev, key] : prev.filter((m) => m !== key)));

  return (
    <Modal
      title={target?.userName ? `Отметка — ${target.userName}` : 'Отметить сотрудника'}
      open={!!target}
      onCancel={onClose}
      onOk={() => save.mutate()}
      okText="Сохранить"
      cancelText="Отмена"
      okButtonProps={{ disabled: !userId }}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Space wrap>
          {!target?.userId && (
            <Select
              placeholder="Сотрудник"
              value={userId}
              onChange={setUserId}
              showSearch
              optionFilterProp="label"
              options={userOptions}
              style={{ width: 240 }}
            />
          )}
          <DatePicker value={date} onChange={(v) => v && setDate(v)} format="DD.MM.YYYY" allowClear={false} />
        </Space>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>Плашки (можно несколько)</Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {ATTENDANCE_MARKS.map((m) => {
              const checked = marks.includes(m.key);
              return (
                <Tooltip key={m.key} title={m.hint}>
                  <Tag.CheckableTag
                    checked={checked}
                    onChange={(c) => toggle(m.key, c)}
                    style={{ border: '1px solid var(--ant-color-border, #d9d9d9)', padding: '2px 10px' }}
                  >
                    {m.label}
                  </Tag.CheckableTag>
                </Tooltip>
              );
            })}
          </div>
        </div>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>Комментарий</Typography.Text>
          <Input.TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Например: предупредил утром, справка будет в понедельник"
            maxLength={500}
            showCount
            autoSize={{ minRows: 2, maxRows: 5 }}
            style={{ marginTop: 6 }}
          />
        </div>
      </Space>
    </Modal>
  );
}
