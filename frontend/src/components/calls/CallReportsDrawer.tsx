import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Drawer, Empty, List, Popconfirm, Space, Spin, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import { callsApi, type CallReportStatus } from '../../api/calls.api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { formatUzPhone } from '../../utils/phone';
import { apiErrorMessage, CALL_TYPE_LABELS, formatDuration } from './callsUi';

const STATUS: Record<CallReportStatus, { label: string; color: string }> = {
  WAITING: { label: 'Расшифровываем звонки', color: 'processing' },
  RUNNING: { label: 'Анализируем', color: 'processing' },
  DONE: { label: 'Готово', color: 'green' },
  FAILED: { label: 'Ошибка', color: 'red' },
};

const inProgress = (s: CallReportStatus) => s === 'WAITING' || s === 'RUNNING';

/** Общие анализы по выбранным звонкам: список и сам отчёт. */
export default function CallReportsDrawer({ open, onClose, openReportId, onOpenReport, onOpenCall }: {
  open: boolean;
  onClose: () => void;
  openReportId: string | null;
  onOpenReport: (id: string | null) => void;
  onOpenCall: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { data: list = [], isLoading } = useQuery({
    queryKey: ['call-reports'],
    queryFn: callsApi.reports,
    enabled: open,
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => inProgress(r.status)) ? 10_000 : false),
  });
  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['call-report', openReportId],
    queryFn: () => callsApi.report(openReportId!),
    enabled: open && !!openReportId,
    refetchInterval: (q) => (q.state.data && inProgress(q.state.data.status) ? 10_000 : false),
  });
  const [showCalls, setShowCalls] = useState(false);

  const remove = useMutation({
    mutationFn: callsApi.removeReport,
    onSuccess: () => {
      message.success('Анализ удалён');
      onOpenReport(null);
      queryClient.invalidateQueries({ queryKey: ['call-reports'] });
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={isMobile ? '100%' : 760}
      title={openReportId ? (
        <Space>
          <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => onOpenReport(null)} />
          {report?.title ?? 'Общий анализ'}
        </Space>
      ) : 'Общие анализы звонков'}
      destroyOnHidden
    >
      {!openReportId && (
        isLoading ? <Spin /> : list.length === 0 ? (
          <Empty description="Пока нет. Отметьте звонки в журнале и нажмите «Общий анализ»." />
        ) : (
          <List
            dataSource={list}
            renderItem={(r) => (
              <List.Item style={{ cursor: 'pointer' }} onClick={() => onOpenReport(r.id)}>
                <List.Item.Meta
                  title={r.title}
                  description={`${dayjs(r.createdAt).format('DD.MM.YYYY HH:mm')} · ${r.createdBy.fullName} · звонков: ${r.callsCount}`}
                />
                <Tag color={STATUS[r.status].color}>{STATUS[r.status].label}</Tag>
              </List.Item>
            )}
          />
        )
      )}

      {openReportId && (reportLoading || !report ? <Spin /> : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <Tag color={STATUS[report.status].color}>{STATUS[report.status].label}</Tag>
            <Typography.Text type="secondary">
              {dayjs(report.createdAt).format('DD.MM.YYYY HH:mm')} · {report.createdBy.fullName}
            </Typography.Text>
          </Space>
          {inProgress(report.status) && (
            <Alert
              type="info"
              showIcon
              message="Готовим анализ"
              description="Сначала расшифровываются звонки, у которых ещё нет текста, потом все разговоры анализируются вместе. Обычно это занимает несколько минут — страницу можно закрыть."
            />
          )}
          {report.status === 'FAILED' && <Alert type="error" showIcon message={report.error ?? 'Не удалось сделать анализ'} />}
          {report.result && (
            <div className="call-report-markdown">
              <ReactMarkdown>{report.result}</ReactMarkdown>
            </div>
          )}

          <Button type="link" style={{ padding: 0 }} onClick={() => setShowCalls((v) => !v)}>
            {showCalls ? 'Скрыть звонки' : `Звонки в анализе (${report.calls.length})`}
          </Button>
          {showCalls && (
            <List
              size="small"
              dataSource={report.calls}
              renderItem={(c) => (
                <List.Item
                  style={{ cursor: c.deletedAt ? undefined : 'pointer' }}
                  onClick={() => !c.deletedAt && onOpenCall(c.id)}
                >
                  <Typography.Text delete={!!c.deletedAt}>
                    {c.number}. {dayjs(c.startedAt).format('DD.MM HH:mm')} · {c.mobileType ? CALL_TYPE_LABELS[c.mobileType] : 'Звонок'} · {formatDuration(c.durationSec)}
                    {' · '}{c.manager?.fullName ?? '—'} · {c.client?.companyName ?? (formatUzPhone(c.phone) || 'неизвестный номер')}
                  </Typography.Text>
                  {!c.hasTranscript && !c.deletedAt && <Tag>без расшифровки</Tag>}
                </List.Item>
              )}
            />
          )}

          <Popconfirm title="Удалить этот анализ?" onConfirm={() => remove.mutate(report.id)}>
            <Button danger size="small" loading={remove.isPending}>Удалить анализ</Button>
          </Popconfirm>
        </Space>
      ))}
    </Drawer>
  );
}
