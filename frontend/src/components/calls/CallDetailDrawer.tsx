import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Drawer, Empty, List, Space, Spin, Tag, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { callsApi } from '../../api/calls.api';
import { formatUzPhone } from '../../utils/phone';
import { useIsMobile } from '../../hooks/useIsMobile';
import CallAudioPlayer from './CallAudioPlayer';
import { AudioStatusTag, apiErrorMessage, callTypeLabel, formatDuration } from './callsUi';

const STAGES: Record<string, string> = {
  greeting: 'Приветствие',
  needsDiscovery: 'Выявление потребностей',
  presentation: 'Презентация',
  objectionHandling: 'Работа с возражениями',
  closing: 'Закрытие сделки',
};

const TASK_STATUS: Record<string, string> = { TODO: 'К выполнению', IN_PROGRESS: 'В работе', DONE: 'Выполнено', APPROVED: 'Принято' };

export default function CallDetailDrawer({
  callId,
  onClose,
  onLinkClient,
  onCreateClient,
}: {
  callId: string | null;
  onClose: () => void;
  onLinkClient: (call: { id: string; counterpart: string | null }) => void;
  onCreateClient: (call: { id: string; counterpart: string | null }) => void;
}) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { data: call, isLoading, error } = useQuery({
    queryKey: ['call', callId],
    queryFn: () => callsApi.get(callId!),
    enabled: !!callId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['call', callId] });
    queryClient.invalidateQueries({ queryKey: ['calls'] });
    queryClient.invalidateQueries({ queryKey: ['calls-missed'] });
  };
  const callbackMut = useMutation({
    mutationFn: () => callsApi.callbackTask(callId!),
    onSuccess: (r) => { message.success(r.existing ? 'Задача «перезвонить» по этому номеру уже есть' : 'Задача «перезвонить» создана'); refresh(); },
    onError: (err) => message.error(apiErrorMessage(err)),
  });
  const calledBackMut = useMutation({
    mutationFn: () => callsApi.calledBack(callId!),
    onSuccess: () => { message.success('Отмечено: перезвонили'); refresh(); },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  const missed = call && call.status === 'MISSED';

  return (
    <Drawer
      open={!!callId}
      onClose={onClose}
      width={isMobile ? '100%' : 560}
      title={call ? `${callTypeLabel(call)} · ${dayjs(call.startedAt).format('DD.MM.YYYY HH:mm')}` : 'Звонок'}
      destroyOnHidden
    >
      {isLoading && <Spin />}
      {error && <Alert type="error" message={apiErrorMessage(error, 'Звонок не найден')} />}
      {call && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Клиент">
              {call.client ? (
                <Link to={`/clients/${call.client.id}`}>{call.client.companyName}</Link>
              ) : (
                <Space direction="vertical" size={4}>
                  <Tag>Неизвестный контакт</Tag>
                  {call.clientMatchNote && <Typography.Text type="secondary">{call.clientMatchNote}</Typography.Text>}
                </Space>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Номер">{formatUzPhone(call.counterpart) || 'скрыт'}</Descriptions.Item>
            <Descriptions.Item label="Менеджер">{call.manager?.fullName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Длительность">{formatDuration(call.durationSec)}</Descriptions.Item>
            {call.simSlot && <Descriptions.Item label="SIM">{call.simSlot}</Descriptions.Item>}
            {missed && (
              <Descriptions.Item label="Перезвонили">
                {call.calledBackAt ? dayjs(call.calledBackAt).format('DD.MM HH:mm') : <Tag color="red">Ещё нет</Tag>}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Запись">
              {call.hasRecording ? <CallAudioPlayer callId={call.id} block /> : 'нет'}
            </Descriptions.Item>
            <Descriptions.Item label="Анализ"><AudioStatusTag call={call} /></Descriptions.Item>
          </Descriptions>

          <Space wrap>
            {!call.client && (
              <>
                <Button onClick={() => onLinkClient(call)}>Привязать к клиенту</Button>
                <Button onClick={() => onCreateClient(call)}>Создать клиента</Button>
              </>
            )}
            {call.client && <Button onClick={() => onLinkClient(call)}>Сменить клиента</Button>}
            {call.counterpart && <Button onClick={() => callbackMut.mutate()} loading={callbackMut.isPending}>Задача «перезвонить»</Button>}
            {missed && !call.calledBackAt && (
              <Button type="primary" onClick={() => calledBackMut.mutate()} loading={calledBackMut.isPending}>Перезвонил</Button>
            )}
          </Space>

          {call.tasks.length > 0 && (
            <List
              size="small"
              header={<Typography.Text strong>Задачи</Typography.Text>}
              dataSource={call.tasks}
              renderItem={(t) => (
                <List.Item>
                  <Link to="/tasks">{t.title}</Link>
                  <Tag>{TASK_STATUS[t.status] ?? t.status}</Tag>
                </List.Item>
              )}
            />
          )}

          {call.audit && (
            <div>
              <Typography.Title level={5}>
                Аудит звонка{call.audit.score != null ? ` · ${call.audit.score}/10` : ''}
                {call.audit.saleProbability != null ? ` · вероятность продажи ${call.audit.saleProbability}%` : ''}
              </Typography.Title>
              {call.audit.stageChecklist && (
                <Space wrap style={{ marginBottom: 8 }}>
                  {Object.entries(STAGES).map(([k, label]) => (
                    <Tag key={k} color={call.audit!.stageChecklist![k] ? 'green' : 'red'}>{label}</Tag>
                  ))}
                </Space>
              )}
              {call.audit.mentorTips && call.audit.mentorTips.length > 0 && (
                <ul style={{ paddingInlineStart: 18, marginTop: 0 }}>
                  {call.audit.mentorTips.map((tip, i) => <li key={i}>{tip}</li>)}
                </ul>
              )}
              <Link to={`/ai-assistant/call-audits?audit=${call.audit.id}`}>Полный разбор</Link>
            </div>
          )}

          <div>
            <Typography.Title level={5}>Расшифровка</Typography.Title>
            {call.transcript ? (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 420, overflow: 'auto' }}>
                {call.transcript}
              </Typography.Paragraph>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={call.audioError ?? 'Расшифровки нет'} />
            )}
          </div>
        </Space>
      )}
    </Drawer>
  );
}
