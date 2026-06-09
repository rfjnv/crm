import { useState, useMemo } from 'react';
import {
  Card,
  Button,
  Table,
  Tag,
  Progress,
  Drawer,
  Descriptions,
  Space,
  Typography,
  Divider,
  Form,
  InputNumber,
  Input,
  Select,
  Switch,
  Popconfirm,
  Alert,
  Tooltip,
  Spin,
  message,
  List,
  Badge,
  Row,
  Col,
  Tabs,
  theme,
} from 'antd';
import {
  RobotOutlined,
  EditOutlined,
  ReloadOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  BulbOutlined,
  WarningOutlined,
  BarChartOutlined,
  TableOutlined,
  RadarChartOutlined,
} from '@ant-design/icons';
import { Bar, Column, Radar } from '@ant-design/charts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { noteAuditApi, type NoteAuditReport, type NoteAuditMemory } from '../api/noteAudit.api';
import { useAuthStore } from '../store/authStore';

const { Title, Text } = Typography;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEEK_OPTIONS = [
  { label: 'Прошлая неделя', value: -1 },
  { label: 'Позапрошлая', value: -2 },
  { label: 'Текущая неделя', value: 0 },
];

const CRITERIA_LABELS: Record<string, string> = {
  scoreSpecificity: 'Конкретность',
  scoreFollowUp: 'Недозвоны',
  scoreNextStep: 'Следующий шаг',
  scoreTone: 'Тон',
};

function scoreColor(score: number): string {
  if (score >= 7) return '#52c41a';
  if (score >= 4) return '#fa8c16';
  if (score === 0) return '#d9d9d9';
  return '#f5222d';
}

function scoreTag(score: number): React.ReactNode {
  const color = scoreColor(score);
  return (
    <Tag
      color={score === 0 ? 'default' : color}
      style={{ fontWeight: 700, fontSize: 13, minWidth: 38, textAlign: 'center' }}
    >
      {score.toFixed(1)}
    </Tag>
  );
}

function ScoreBar({
  label,
  score,
  corrected,
}: {
  label: string;
  score: number;
  corrected?: number | null;
}) {
  const display = corrected ?? score;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ fontSize: 12 }}>{label}</Text>
        <Space size={4}>
          {corrected != null && corrected !== score && (
            <Text delete type="secondary" style={{ fontSize: 11 }}>
              {score.toFixed(1)}
            </Text>
          )}
          <Text strong style={{ color: scoreColor(display), fontSize: 13 }}>
            {display.toFixed(1)}
          </Text>
        </Space>
      </div>
      <Progress
        percent={display * 10}
        showInfo={false}
        strokeColor={scoreColor(display)}
        size={['100%', 6]}
      />
    </div>
  );
}

function statusBadge(status: NoteAuditReport['status']) {
  if (status === 'DONE') return <Badge status="success" text="Готово" />;
  if (status === 'PENDING') return <Badge status="processing" text="Анализ..." />;
  return <Badge status="error" text="Ошибка" />;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ─── Charts ───────────────────────────────────────────────────────────────────

/** Horizontal bar — overall score ranking */
function OverallRankingChart({ reports }: { reports: NoteAuditReport[] }) {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

  const done = reports.filter((r) => r.status === 'DONE');
  if (done.length === 0) return <Text type="secondary">Нет данных для графика</Text>;

  const data = [...done]
    .sort((a, b) => {
      const sa = a.correctedScoreOverall ?? a.scoreOverall;
      const sb = b.correctedScoreOverall ?? b.scoreOverall;
      return sa - sb;
    })
    .map((r) => ({
      manager: r.managerName,
      score: r.correctedScoreOverall ?? r.scoreOverall,
      color: scoreColor(r.correctedScoreOverall ?? r.scoreOverall),
    }));

  const config = {
    data,
    xField: 'score',
    yField: 'manager',
    height: Math.max(180, done.length * 44),
    theme: chartTheme,
    style: {
      fill: (d: { color: string }) => d.color,
      maxWidth: 28,
      radius: 4,
    },
    axis: {
      x: {
        min: 0,
        max: 10,
        labelFill: token.colorTextSecondary,
        grid: true,
        gridLineWidth: 1,
        gridLineDash: [3, 3],
      },
      y: { labelFill: token.colorText, labelFontSize: 13 },
    },
    label: {
      position: 'right' as const,
      text: (d: { score: number }) => d.score.toFixed(1),
      style: { fill: token.colorText, fontSize: 12, fontWeight: 600 },
      offset: 6,
    },
    tooltip: {
      items: [{ field: 'score', channel: 'x', name: 'Оценка' }],
    },
  };

  return <Bar {...config} />;
}

/** Grouped column — 4 criteria per manager */
function CriteriaGroupedChart({ reports }: { reports: NoteAuditReport[] }) {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

  const done = reports.filter((r) => r.status === 'DONE');
  if (done.length === 0) return <Text type="secondary">Нет данных для графика</Text>;

  const criteriaKeys = [
    'scoreSpecificity',
    'scoreFollowUp',
    'scoreNextStep',
    'scoreTone',
  ] as const;

  const data: { manager: string; criteria: string; score: number }[] = [];
  for (const r of done) {
    for (const key of criteriaKeys) {
      const corrKey = `corrected${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof NoteAuditReport;
      const val = (r[corrKey] as number | null) ?? (r[key] as number);
      data.push({
        manager: r.managerName,
        criteria: CRITERIA_LABELS[key],
        score: val,
      });
    }
  }

  const config = {
    data,
    xField: 'manager',
    yField: 'score',
    colorField: 'criteria',
    group: true,
    height: 300,
    theme: chartTheme,
    style: { maxWidth: 20, radius: 3 },
    axis: {
      x: {
        labelFill: token.colorTextSecondary,
        labelAutoRotate: true,
        labelAutoHide: true,
      },
      y: {
        min: 0,
        max: 10,
        labelFill: token.colorTextSecondary,
        title: false,
        grid: true,
        gridLineWidth: 1,
        gridLineDash: [3, 3],
      },
    },
    legend: {
      color: {
        itemLabelFill: token.colorText,
        position: 'top' as const,
      },
    },
    tooltip: {
      items: [{ field: 'score', channel: 'y', name: 'Балл' }],
    },
  };

  return <Column {...config} />;
}

/** Radar — individual profile */
function ManagerRadarChart({ report }: { report: NoteAuditReport }) {
  const { token } = theme.useToken();
  const isDark = token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

  const criteriaKeys = [
    'scoreSpecificity',
    'scoreFollowUp',
    'scoreNextStep',
    'scoreTone',
  ] as const;

  const makeData = (label: string, isAi: boolean) =>
    criteriaKeys.map((key) => {
      const corrKey = `corrected${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof NoteAuditReport;
      const corrVal = report[corrKey] as number | null;
      const aiVal = report[key] as number;
      return {
        criteria: CRITERIA_LABELS[key],
        score: isAi ? aiVal : (corrVal ?? aiVal),
        type: label,
      };
    });

  const data = report.isCorrected
    ? [...makeData('AI', true), ...makeData('Скорр.', false)]
    : makeData('Оценка', true);

  const config = {
    data,
    xField: 'criteria',
    yField: 'score',
    seriesField: 'type',
    height: 260,
    theme: chartTheme,
    scale: { y: { min: 0, max: 10 } },
    area: {},
    style: { lineWidth: 2 },
    axis: {
      x: { labelFill: token.colorText, labelFontSize: 12 },
      y: { gridAreaFill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' },
    },
    legend: {
      color: { itemLabelFill: token.colorText },
    },
    tooltip: {
      items: [{ field: 'score', channel: 'y', name: 'Балл' }],
    },
  };

  return <Radar {...config} />;
}

// ─── Correction drawer ────────────────────────────────────────────────────────

function CorrectionForm({
  report,
  onSaved,
}: {
  report: NoteAuditReport;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (vals: Record<string, unknown>) =>
      noteAuditApi.correctReport(report.id, vals as any),
    onSuccess: () => {
      message.success('Корректировка сохранена');
      qc.invalidateQueries({ queryKey: ['note-audit-reports'] });
      onSaved();
    },
    onError: (e: any) => message.error(e?.response?.data?.message ?? 'Ошибка сохранения'),
  });

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        correctedScoreSpecificity: report.scoreSpecificity,
        correctedScoreFollowUp: report.scoreFollowUp,
        correctedScoreNextStep: report.scoreNextStep,
        correctedScoreTone: report.scoreTone,
        correctedSummary: report.summary,
        saveAsMemory: true,
        memoryScope: 'manager',
      }}
      onFinish={(vals) => mutation.mutate(vals)}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="AI учится на ваших поправках"
        description="Если включена опция «Сохранить в памяти», эта корректировка будет учтена при следующем анализе."
      />

      <Form.Item label="Конкретность (0–10)" name="correctedScoreSpecificity">
        <InputNumber min={0} max={10} step={0.5} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="Недозвоны (0–10)" name="correctedScoreFollowUp">
        <InputNumber min={0} max={10} step={0.5} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="Следующий шаг (0–10)" name="correctedScoreNextStep">
        <InputNumber min={0} max={10} step={0.5} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="Тон (0–10)" name="correctedScoreTone">
        <InputNumber min={0} max={10} step={0.5} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="Правильная оценка (текст)" name="correctedSummary">
        <Input.TextArea rows={3} placeholder="Опишите реальную ситуацию..." />
      </Form.Item>
      <Form.Item
        label="Причина корректировки"
        name="correctionReason"
        rules={[{ required: true, message: 'Укажите причину' }]}
      >
        <Input.TextArea rows={2} placeholder="AI неправильно оценил X, потому что..." />
      </Form.Item>

      <Divider />

      <Form.Item label="Сохранить в памяти AI" name="saveAsMemory" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item
        label="Область памяти"
        name="memoryScope"
        tooltip="Для этого менеджера или для всех сразу"
      >
        <Select
          options={[
            { value: 'manager', label: `Только для ${report.managerName}` },
            { value: 'global', label: 'Для всех менеджеров (глобально)' },
          ]}
        />
      </Form.Item>

      <Button type="primary" htmlType="submit" loading={mutation.isPending} block>
        Сохранить корректировку
      </Button>
    </Form>
  );
}

// ─── Report detail drawer ─────────────────────────────────────────────────────

function ReportDetail({
  report,
  isSuperAdmin,
}: {
  report: NoteAuditReport;
  isSuperAdmin: boolean;
}) {
  const [showCorrect, setShowCorrect] = useState(false);

  const effectiveOverall = report.correctedScoreOverall ?? report.scoreOverall;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {report.status === 'ERROR' && (
        <Alert type="error" showIcon message="Ошибка анализа" description={report.errorMessage} />
      )}

      {report.status === 'PENDING' && (
        <Alert
          type="info"
          showIcon
          icon={<Spin size="small" />}
          message="AI анализирует заметки... обновите страницу через минуту"
        />
      )}

      {report.status === 'DONE' && (
        <>
          {/* Radar + Overall */}
          <Row gutter={12}>
            <Col span={24}>
              <Card size="small" title={<><RadarChartOutlined /> Профиль менеджера</>}>
                <ManagerRadarChart report={report} />
              </Card>
            </Col>
          </Row>

          {/* Overall score */}
          <Card size="small" style={{ background: 'var(--color-bg-elevated)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Text strong>Итоговая оценка</Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {report.isCorrected && (
                  <Tag color="volcano" icon={<EditOutlined />}>
                    Скорректировано
                  </Tag>
                )}
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    color: scoreColor(effectiveOverall),
                  }}
                >
                  {effectiveOverall.toFixed(1)}
                </span>
                <Text type="secondary">/10</Text>
              </div>
            </div>
            <Text style={{ fontSize: 13 }}>{report.correctedSummary ?? report.summary}</Text>
          </Card>

          {/* Score bars */}
          <Card size="small" title="Оценки по критериям">
            <ScoreBar
              label="Конкретность (×0.30)"
              score={report.scoreSpecificity}
              corrected={report.correctedScoreSpecificity}
            />
            <ScoreBar
              label="Недозвоны (×0.20)"
              score={report.scoreFollowUp}
              corrected={report.correctedScoreFollowUp}
            />
            <ScoreBar
              label="Следующий шаг (×0.30)"
              score={report.scoreNextStep}
              corrected={report.correctedScoreNextStep}
            />
            <ScoreBar
              label="Тон (×0.20)"
              score={report.scoreTone}
              corrected={report.correctedScoreTone}
            />
          </Card>

          {/* Feedback */}
          <Card size="small" title="Детальная обратная связь">
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Конкретность">
                {report.feedbackSpecificity}
              </Descriptions.Item>
              <Descriptions.Item label="Недозвоны">
                {report.feedbackFollowUp}
              </Descriptions.Item>
              <Descriptions.Item label="Следующий шаг">
                {report.feedbackNextStep}
              </Descriptions.Item>
              <Descriptions.Item label="Тон">{report.feedbackTone}</Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Examples */}
          {(report.goodExamples.length > 0 || report.badExamples.length > 0) && (
            <Card size="small" title="Примеры заметок">
              {report.goodExamples.length > 0 && (
                <>
                  <Text strong style={{ color: '#52c41a' }}>
                    <CheckCircleOutlined /> Хорошие примеры
                  </Text>
                  <List
                    size="small"
                    dataSource={report.goodExamples}
                    renderItem={(item) => (
                      <List.Item>
                        <Text style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          «{item}»
                        </Text>
                      </List.Item>
                    )}
                  />
                </>
              )}
              {report.badExamples.length > 0 && (
                <>
                  <Text
                    strong
                    style={{ color: '#fa8c16', marginTop: 8, display: 'block' }}
                  >
                    <WarningOutlined /> Можно было лучше
                  </Text>
                  <List
                    size="small"
                    dataSource={report.badExamples}
                    renderItem={(item) => (
                      <List.Item>
                        <Text style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          «{item}»
                        </Text>
                      </List.Item>
                    )}
                  />
                </>
              )}
            </Card>
          )}

          {/* Correction info */}
          {report.isCorrected && (
            <Alert
              type="warning"
              showIcon
              icon={<EditOutlined />}
              message={`Скорректировано: ${report.correctedByName ?? '—'}`}
              description={`${formatDate(report.correctedAt!)} — ${report.correctionReason}`}
            />
          )}

          {/* Correct button */}
          {isSuperAdmin && (
            <Button
              icon={<EditOutlined />}
              onClick={() => setShowCorrect(!showCorrect)}
              block
              type={report.isCorrected ? 'default' : 'primary'}
            >
              {showCorrect
                ? 'Скрыть форму'
                : report.isCorrected
                  ? 'Изменить корректировку'
                  : 'Скорректировать оценку AI'}
            </Button>
          )}
        </>
      )}

      {showCorrect && isSuperAdmin && (
        <>
          <Divider>Корректировка</Divider>
          <CorrectionForm
            report={report}
            onSaved={() => setShowCorrect(false)}
          />
        </>
      )}
    </Space>
  );
}

// ─── Memory panel ─────────────────────────────────────────────────────────────

function MemoryPanel() {
  const qc = useQueryClient();
  const { data: memories = [], isLoading } = useQuery({
    queryKey: ['note-audit-memory'],
    queryFn: () => noteAuditApi.getMemory(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => noteAuditApi.deleteMemory(id),
    onSuccess: () => {
      message.success('Удалено');
      qc.invalidateQueries({ queryKey: ['note-audit-memory'] });
    },
  });

  return (
    <div>
      <Alert
        type="info"
        showIcon
        icon={<BulbOutlined />}
        style={{ marginBottom: 12 }}
        message="Память AI"
        description="Здесь хранятся ваши корректировки, которые AI учитывает при следующих анализах."
      />
      {isLoading ? (
        <Spin />
      ) : memories.length === 0 ? (
        <Text type="secondary">Памяти пока нет. Скорректируйте хотя бы один отчёт.</Text>
      ) : (
        <List
          dataSource={memories}
          renderItem={(m: NoteAuditMemory) => (
            <List.Item
              actions={[
                <Popconfirm
                  key="del"
                  title="Удалить запись памяти?"
                  onConfirm={() => deleteMutation.mutate(m.id)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={m.managerId === '*' ? 'purple' : 'blue'}>
                      {m.managerId === '*' ? 'Глобально' : m.managerId}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {formatDate(m.createdAt)} — {m.createdByName}
                    </Text>
                  </Space>
                }
                description={
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                    }}
                  >
                    {m.context}
                  </pre>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NoteAuditPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [weekOffset, setWeekOffset] = useState(-1);
  const [selectedReport, setSelectedReport] = useState<NoteAuditReport | null>(null);
  const [showMemory, setShowMemory] = useState(false);
  const qc = useQueryClient();

  const {
    data: reports = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['note-audit-reports', weekOffset],
    queryFn: () => noteAuditApi.getReports({ weekOffset }),
    refetchInterval: (query) => {
      const data = query.state.data as NoteAuditReport[] | undefined;
      const hasPending = data?.some((r) => r.status === 'PENDING');
      return hasPending ? 5000 : false;
    },
  });

  const generateAllMutation = useMutation({
    mutationFn: () => noteAuditApi.generate({ weekOffset }),
    onSuccess: () => {
      message.success('Запущен анализ для всех менеджеров. Подождите 1-2 минуты...');
      setTimeout(() => qc.invalidateQueries({ queryKey: ['note-audit-reports'] }), 3000);
    },
    onError: (e: any) => message.error(e?.response?.data?.message ?? 'Ошибка'),
  });

  const generateOneMutation = useMutation({
    mutationFn: (managerId: string) =>
      noteAuditApi.generate({ managerId, weekOffset }),
    onSuccess: () => {
      message.success('Анализ завершён');
      qc.invalidateQueries({ queryKey: ['note-audit-reports'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.message ?? 'Ошибка'),
  });

  // Keep drawer report in sync after refetch
  const freshSelectedReport = useMemo(
    () =>
      selectedReport
        ? (reports.find((r) => r.id === selectedReport.id) ?? selectedReport)
        : null,
    [reports, selectedReport],
  );

  const columns = [
    {
      title: 'Менеджер',
      dataIndex: 'managerName',
      key: 'manager',
      render: (name: string, r: NoteAuditReport) => (
        <Space>
          <Text strong>{name}</Text>
          {r.isCorrected && (
            <Tooltip title="Оценка скорректирована администратором">
              <EditOutlined style={{ color: '#fa8c16', fontSize: 12 }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: NoteAuditReport['status']) => statusBadge(s),
    },
    {
      title: 'Итог',
      key: 'overall',
      width: 80,
      sorter: (a: NoteAuditReport, b: NoteAuditReport) =>
        (a.correctedScoreOverall ?? a.scoreOverall) -
        (b.correctedScoreOverall ?? b.scoreOverall),
      defaultSortOrder: 'descend' as const,
      render: (_: unknown, r: NoteAuditReport) =>
        r.status === 'DONE' ? scoreTag(r.correctedScoreOverall ?? r.scoreOverall) : '—',
    },
    {
      title: 'Конкр.',
      key: 'spec',
      width: 80,
      render: (_: unknown, r: NoteAuditReport) =>
        r.status === 'DONE'
          ? scoreTag(r.correctedScoreSpecificity ?? r.scoreSpecificity)
          : '—',
    },
    {
      title: 'Недозв.',
      key: 'follow',
      width: 80,
      render: (_: unknown, r: NoteAuditReport) =>
        r.status === 'DONE'
          ? scoreTag(r.correctedScoreFollowUp ?? r.scoreFollowUp)
          : '—',
    },
    {
      title: 'Шаг',
      key: 'next',
      width: 80,
      render: (_: unknown, r: NoteAuditReport) =>
        r.status === 'DONE'
          ? scoreTag(r.correctedScoreNextStep ?? r.scoreNextStep)
          : '—',
    },
    {
      title: 'Тон',
      key: 'tone',
      width: 80,
      render: (_: unknown, r: NoteAuditReport) =>
        r.status === 'DONE'
          ? scoreTag(r.correctedScoreTone ?? r.scoreTone)
          : '—',
    },
    {
      title: 'Заметок',
      dataIndex: 'notesCount',
      key: 'notes',
      width: 80,
      render: (n: number) => <Text type="secondary">{n}</Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      render: (_: unknown, r: NoteAuditReport) => (
        <Space size={4}>
          <Button size="small" onClick={() => setSelectedReport(r)}>
            Детали
          </Button>
          {isSuperAdmin && r.status !== 'PENDING' && (
            <Tooltip title="Перегенерировать">
              <Popconfirm
                title="Запустить повторный анализ?"
                onConfirm={() => generateOneMutation.mutate(r.managerId)}
              >
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={generateOneMutation.isPending}
                />
              </Popconfirm>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const hasDoneReports = reports.some((r) => r.status === 'DONE');

  return (
    <div style={{ padding: '16px 24px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <RobotOutlined /> AI Аудит заметок
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Еженедельный анализ качества работы менеджеров с клиентами
          </Text>
        </div>
        <Space>
          {isSuperAdmin && (
            <Button icon={<BulbOutlined />} onClick={() => setShowMemory(true)}>
              Память AI
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          {isSuperAdmin && (
            <Popconfirm
              title="Запустить анализ для всех менеджеров?"
              description="Займёт 1-3 минуты. Существующие отчёты за эту неделю не пересоздаются."
              onConfirm={() => generateAllMutation.mutate()}
            >
              <Button
                type="primary"
                icon={<RobotOutlined />}
                loading={generateAllMutation.isPending}
              >
                Запустить анализ
              </Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      {/* Week selector */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Text>Период:</Text>
          <Select
            value={weekOffset}
            onChange={(v) => setWeekOffset(v)}
            options={WEEK_OPTIONS}
            style={{ width: 180 }}
          />
          {reports.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDate(reports[0].periodStart)} — {formatDate(reports[0].periodEnd)}
            </Text>
          )}
        </Space>
      </Card>

      {reports.length === 0 && !isLoading ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 32 }}>
            <RobotOutlined
              style={{
                fontSize: 48,
                color: 'var(--color-text-secondary)',
                marginBottom: 12,
              }}
            />
            <div>
              <Text type="secondary">Нет отчётов за выбранный период.</Text>
              {isSuperAdmin && (
                <div style={{ marginTop: 8 }}>
                  <Button
                    type="primary"
                    icon={<RobotOutlined />}
                    onClick={() => generateAllMutation.mutate()}
                    loading={generateAllMutation.isPending}
                  >
                    Запустить первый анализ
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Tabs
          defaultActiveKey="charts"
          items={[
            {
              key: 'charts',
              label: (
                <Space>
                  <BarChartOutlined />
                  Графики
                </Space>
              ),
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  {/* Legend */}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <Space size={4}>
                      <Tag color="#52c41a">7–10</Tag>
                      <Text style={{ fontSize: 12 }}>Хорошо</Text>
                    </Space>
                    <Space size={4}>
                      <Tag color="#fa8c16">4–6</Tag>
                      <Text style={{ fontSize: 12 }}>Удовлетворительно</Text>
                    </Space>
                    <Space size={4}>
                      <Tag color="#f5222d">1–3</Tag>
                      <Text style={{ fontSize: 12 }}>Плохо</Text>
                    </Space>
                    <Space size={4}>
                      <Tag color="default">0</Tag>
                      <Text style={{ fontSize: 12 }}>Нет заметок</Text>
                    </Space>
                  </div>

                  <Row gutter={[16, 16]}>
                    {/* Overall ranking */}
                    <Col xs={24} lg={10}>
                      <Card
                        size="small"
                        title={
                          <Space>
                            <BarChartOutlined />
                            Рейтинг менеджеров
                          </Space>
                        }
                        loading={isLoading}
                        style={{ height: '100%' }}
                      >
                        {hasDoneReports ? (
                          <OverallRankingChart reports={reports} />
                        ) : (
                          <Text type="secondary">Нет завершённых отчётов</Text>
                        )}
                      </Card>
                    </Col>

                    {/* Grouped criteria */}
                    <Col xs={24} lg={14}>
                      <Card
                        size="small"
                        title={
                          <Space>
                            <BarChartOutlined />
                            Сравнение по критериям
                          </Space>
                        }
                        loading={isLoading}
                        style={{ height: '100%' }}
                      >
                        {hasDoneReports ? (
                          <CriteriaGroupedChart reports={reports} />
                        ) : (
                          <Text type="secondary">Нет завершённых отчётов</Text>
                        )}
                      </Card>
                    </Col>
                  </Row>
                </Space>
              ),
            },
            {
              key: 'table',
              label: (
                <Space>
                  <TableOutlined />
                  Таблица
                </Space>
              ),
              children: (
                <>
                  {/* Legend */}
                  <div
                    style={{
                      marginBottom: 12,
                      display: 'flex',
                      gap: 16,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Space size={4}>
                      <Tag color="#52c41a">7–10</Tag>
                      <Text style={{ fontSize: 12 }}>Хорошо</Text>
                    </Space>
                    <Space size={4}>
                      <Tag color="#fa8c16">4–6</Tag>
                      <Text style={{ fontSize: 12 }}>Удовлетворительно</Text>
                    </Space>
                    <Space size={4}>
                      <Tag color="#f5222d">1–3</Tag>
                      <Text style={{ fontSize: 12 }}>Плохо</Text>
                    </Space>
                    <Space size={4}>
                      <Tag color="default">0</Tag>
                      <Text style={{ fontSize: 12 }}>Нет заметок</Text>
                    </Space>
                  </div>

                  <Table
                    dataSource={reports}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading}
                    size="small"
                    onRow={(r) => ({
                      onClick: () => setSelectedReport(r),
                      style: { cursor: 'pointer' },
                    })}
                    pagination={false}
                  />
                </>
              ),
            },
          ]}
        />
      )}

      {/* Detail drawer */}
      <Drawer
        title={
          freshSelectedReport ? (
            <Space>
              <RobotOutlined />
              <span>{freshSelectedReport.managerName}</span>
              {freshSelectedReport.status === 'DONE' && (
                <span
                  style={{
                    color: scoreColor(
                      freshSelectedReport.correctedScoreOverall ??
                        freshSelectedReport.scoreOverall,
                    ),
                    fontWeight: 700,
                  }}
                >
                  {(
                    freshSelectedReport.correctedScoreOverall ??
                    freshSelectedReport.scoreOverall
                  ).toFixed(1)}
                  /10
                </span>
              )}
            </Space>
          ) : null
        }
        open={!!selectedReport}
        onClose={() => setSelectedReport(null)}
        width={540}
        destroyOnClose
      >
        {freshSelectedReport && (
          <ReportDetail report={freshSelectedReport} isSuperAdmin={isSuperAdmin} />
        )}
      </Drawer>

      {/* Memory drawer */}
      <Drawer
        title={
          <Space>
            <BulbOutlined />
            <span>Память AI</span>
          </Space>
        }
        open={showMemory}
        onClose={() => setShowMemory(false)}
        width={520}
        destroyOnClose
      >
        <MemoryPanel />
      </Drawer>
    </div>
  );
}
