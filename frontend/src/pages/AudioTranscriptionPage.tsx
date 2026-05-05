import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
  theme,
} from 'antd';
import {
  AuditOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  FileTextOutlined,
  HistoryOutlined,
  MinusCircleFilled,
  RobotOutlined,
  SaveOutlined,
  SoundOutlined,
  StarOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import {
  aiAssistantApi,
  aiTrainingApi,
  type AsrLanguageMode,
  type EngineMeta,
} from '../api/ai-assistant.api';
import { useAuthStore } from '../store/authStore';

const { Title, Text, Paragraph } = Typography;
const TRAINING_MAX_LEN = 5000;
const TRAINING_FILE_ACCEPT = '.txt,.md,.csv,.json';

const ENGINE_LABELS: Record<EngineMeta['engine'], string> = {
  aisha: 'AISHA',
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI Whisper',
};

const ENGINE_DESCRIPTIONS: Record<EngineMeta['engine'], string> = {
  aisha: 'Узбекский STT (AISHA Space)',
  elevenlabs: 'Универсальный STT с диаризацией',
  openai: 'gpt-4o-transcribe',
};

type StageChecklist = {
  greeting: boolean;
  needsDiscovery: boolean;
  presentation: boolean;
  objectionHandling: boolean;
  closing: boolean;
};

type StageItem = { key: keyof StageChecklist; label: string; shortLabel: string };

const DEFAULT_STAGE_CHECKLIST: StageChecklist = {
  greeting: false,
  needsDiscovery: false,
  presentation: false,
  objectionHandling: false,
  closing: false,
};

function splitIntoChunks(text: string, maxLen: number): string[] {
  const normalized = text.trim().replace(/\r\n/g, '\n');
  if (!normalized) return [];
  if (normalized.length <= maxLen) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxLen, normalized.length);
    if (end < normalized.length) {
      const splitAt = normalized.lastIndexOf('\n', end);
      if (splitAt > start + 200) end = splitAt;
    }
    const part = normalized.slice(start, end).trim();
    if (part) chunks.push(part);
    start = end;
  }
  return chunks;
}

function formatMs(ms: number): string {
  if (!ms || ms < 0) return '-';
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

function buildMentorPlan(tips: string[]): string[] {
  if (tips.length === 0) return [];
  const days = [
    `1-kun: Qo'ng'iroq skriptini qayta o'qing va 3 ta asosiy savol tayyorlang.`,
    `2-kun: 5 ta ochiq savol bilan ehtiyoj aniqlash mashqi qiling.`,
    `3-kun: E'tirozlar ro'yxatini tuzing va har biriga 1 javob yozing.`,
    `4-kun: Taqdimot blokini 90 soniyaga qisqartirib aytib bering.`,
    `5-kun: 3 ta "yopuvchi" frazani ovoz chiqarib mashq qiling.`,
    `6-kun: O'zingizning 1 qo'ng'irog'ingizni qayta tinglab self-audit qiling.`,
    `7-kun: Qayta qo'ng'iroq simulyatsiyasi: ehtiyoj -> qiymat -> objection -> close.`,
  ];
  const mappedTips = tips.slice(0, 7).map((tip, idx) => `${idx + 1}-kun mentor fokus: ${tip}`);
  return days.map((d, idx) => `${d} ${mappedTips[idx] ? `\n${mappedTips[idx]}` : ''}`.trim());
}

function getScoreColor(score: number | null, token: ReturnType<typeof theme.useToken>['token']) {
  if (score === null) return token.colorTextTertiary;
  if (score >= 7) return token.colorSuccess;
  if (score >= 5) return token.colorWarning;
  return token.colorError;
}

function getRiskLevel(score: number | null) {
  if (score === null) return 'N/A';
  if (score >= 7) return 'Низкий риск';
  if (score >= 5) return 'Средний риск';
  return 'Высокий риск';
}

function getRiskColor(score: number | null): 'default' | 'green' | 'gold' | 'red' {
  if (score === null) return 'default';
  if (score >= 7) return 'green';
  if (score >= 5) return 'gold';
  return 'red';
}

function cleanAuditAnalysis(raw: string): string {
  return raw
    .replace(/```(?:json|markdown|md)?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*(?:конечно|разумеется|вот|ниже)\s*,?\s*(?:представляю|привожу|даю)?\s*(?:готовый\s*)?(?:ai[-\s]?аудит|аудит|анализ)[^\n]*[:.]?\s*$/gim, '')
    .replace(/^\s*(?:как\s+(?:ии|ai|искусственный интеллект|языковая модель)[^\n]*|я\s+(?:как\s+)?(?:ии|ai|искусственный интеллект|языковая модель)[^\n]*|не\s+являюсь\s+человеком[^\n]*)\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function AuditMarkdown({ content }: { content: string }) {
  const { token } = theme.useToken();
  const cleaned = cleanAuditAnalysis(content);

  return (
    <div style={{ color: token.colorText }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <Title level={3} style={{ marginTop: 0 }}>{children}</Title>,
          h2: ({ children }) => <Title level={4} style={{ marginTop: 18 }}>{children}</Title>,
          h3: ({ children }) => <Title level={5} style={{ marginTop: 16 }}>{children}</Title>,
          p: ({ children }) => <Paragraph style={{ marginBottom: 10 }}>{children}</Paragraph>,
          ul: ({ children }) => <ul style={{ marginTop: 0, paddingLeft: 22 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ marginTop: 0, paddingLeft: 22 }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 6 }}>{children}</li>,
          strong: ({ children }) => <Text strong>{children}</Text>,
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: '12px 0 18px' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'separate',
                  borderSpacing: 0,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: token.colorBgContainer,
                }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                background: token.colorFillTertiary,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                fontWeight: 700,
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                padding: '10px 12px',
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                verticalAlign: 'top',
              }}
            >
              {children}
            </td>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}

function MetricCard({
  title,
  value,
  suffix,
  icon,
  accent,
  children,
}: {
  title: string;
  value: ReactNode;
  suffix?: string;
  icon: ReactNode;
  accent: string;
  children?: ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <Card
      styles={{ body: { padding: 18 } }}
      style={{
        height: '100%',
        borderRadius: 18,
        borderColor: token.colorBorderSecondary,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <Space direction="vertical" size={2}>
          <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <Text strong style={{ fontSize: 28, lineHeight: 1, color: accent }}>{value}</Text>
            {suffix && <Text type="secondary">{suffix}</Text>}
          </div>
        </Space>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 14,
            display: 'grid',
            placeItems: 'center',
            color: accent,
            background: token.colorFillTertiary,
            fontSize: 18,
          }}
        >
          {icon}
        </div>
      </div>
      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </Card>
  );
}

function EngineBadge({ engine, compact = false }: { engine: EngineMeta; compact?: boolean }) {
  const { token } = theme.useToken();
  const label = ENGINE_LABELS[engine.engine];
  const sub = ENGINE_DESCRIPTIONS[engine.engine];

  let icon;
  let color;
  let borderColor;
  let statusText;

  if (engine.status === 'success') {
    icon = <CheckCircleFilled style={{ color: token.colorSuccess }} />;
    color = token.colorSuccessBg;
    borderColor = token.colorSuccessBorder;
    statusText = `${engine.textLength} симв · ${formatMs(engine.durationMs)}`;
  } else if (engine.status === 'skipped') {
    icon = <MinusCircleFilled style={{ color: token.colorTextTertiary }} />;
    color = token.colorFillQuaternary;
    borderColor = token.colorBorderSecondary;
    statusText = 'Пропущен (нет ключа)';
  } else {
    icon = <CloseCircleFilled style={{ color: token.colorError }} />;
    color = token.colorErrorBg;
    borderColor = token.colorErrorBorder;
    statusText = 'Ошибка';
  }

  return (
    <div
      style={{
        background: color,
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        padding: compact ? '8px 10px' : '10px 14px',
        flex: compact ? '0 1 auto' : '1 1 200px',
        minWidth: compact ? 0 : 200,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {icon}
        <Text strong>{label}</Text>
      </div>
      {!compact && <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{sub}</Text>}
      <Text style={{ fontSize: 12, display: 'block', marginTop: 4 }}>{statusText}</Text>
      {engine.error && engine.status === 'error' && (
        <Text type="danger" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
          {engine.error.slice(0, 120)}
        </Text>
      )}
    </div>
  );
}

function EngineStatusStrip({
  engines,
  enginesUsed,
  mergeModel,
}: {
  engines: EngineMeta[];
  enginesUsed: number;
  mergeModel: string;
}) {
  const successCount = engines.filter((e) => e.status === 'success').length;
  if (engines.length === 0) return null;
  return (
    <Card
      size="small"
      title={(
        <Space wrap>
          <Text strong>Движки распознавания</Text>
          <Tag color={successCount >= 2 ? 'green' : successCount === 1 ? 'gold' : 'red'}>
            {successCount} из 3 успешно
          </Tag>
          {mergeModel && mergeModel !== 'fallback' && mergeModel !== 'single-source' && (
            <Tag color="blue">Claude merge</Tag>
          )}
        </Space>
      )}
      style={{ borderRadius: 18 }}
    >
      <Space wrap size={[10, 10]}>
        {engines.map((e) => <EngineBadge key={e.engine} engine={e} compact />)}
      </Space>
      {enginesUsed === 1 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12, borderRadius: 12 }}
          message="Сработал только 1 движок"
          description="Слияние не выполнялось — используется текст одного источника. Проверьте ключи остальных STT в Render."
        />
      )}
    </Card>
  );
}

function StageRadar({ stageItems, stageChecklist }: { stageItems: StageItem[]; stageChecklist: StageChecklist }) {
  const { token } = theme.useToken();
  const stageDone = stageItems.filter((s) => stageChecklist[s.key]).length;
  return (
    <Card
      title={<span><BarChartOutlined /> Stage Radar</span>}
      style={{ borderRadius: 18, height: '100%' }}
    >
      <Progress
        percent={Math.round((stageDone / stageItems.length) * 100)}
        strokeColor={stageDone >= 4 ? token.colorSuccess : stageDone >= 2 ? token.colorWarning : token.colorError}
        format={(p) => `${p}%`}
      />
      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {stageItems.map((stage) => {
          const done = stageChecklist[stage.key];
          return (
            <div
              key={stage.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 12,
                border: `1px solid ${done ? token.colorSuccessBorder : token.colorErrorBorder}`,
                background: done ? token.colorSuccessBg : token.colorErrorBg,
              }}
            >
              <Text strong>{stage.shortLabel}</Text>
              <Tag color={done ? 'green' : 'red'}>{done ? 'Выполнен' : 'Провален'}</Tag>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MentorPanel({
  mentorTips,
  mentorPlan,
  onBuildPlan,
}: {
  mentorTips: string[];
  mentorPlan: string[];
  onBuildPlan: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <Card
      title={<span><RobotOutlined /> Mentor Command Center</span>}
      extra={(
        <Button disabled={mentorTips.length === 0} onClick={onBuildPlan}>
          7-дневный план
        </Button>
      )}
      style={{
        borderRadius: 18,
        borderColor: token.colorPrimaryBorder,
        background: `linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorBgContainer})`,
      }}
    >
      {mentorTips.length > 0 ? (
        <Row gutter={[14, 14]}>
          {mentorTips.map((tip, idx) => (
            <Col xs={24} md={12} key={`${idx}-${tip.slice(0, 20)}`}>
              <div
                style={{
                  minHeight: 88,
                  padding: 14,
                  borderRadius: 14,
                  background: token.colorBgContainer,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <Tag color="blue">Совет {idx + 1}</Tag>
                <Paragraph style={{ margin: '8px 0 0' }}>{tip}</Paragraph>
              </div>
            </Col>
          ))}
        </Row>
      ) : (
        <Text type="secondary">Советы появятся после AI-аудита.</Text>
      )}
      {mentorPlan.length > 0 && (
        <>
          <Divider style={{ margin: '16px 0 12px' }} />
          <Title level={5} style={{ marginTop: 0 }}>План тренировки на 7 дней</Title>
          <Row gutter={[10, 10]}>
            {mentorPlan.map((item, idx) => (
              <Col xs={24} lg={12} key={`plan-${idx}`}>
                <Card size="small" style={{ borderRadius: 12 }}>
                  <Text style={{ whiteSpace: 'pre-wrap' }}>{item}</Text>
                </Card>
              </Col>
            ))}
          </Row>
        </>
      )}
    </Card>
  );
}

export default function AudioTranscriptionPage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [transcript, setTranscript] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [languageMode, setLanguageMode] = useState<AsrLanguageMode>('auto');
  const [auditLanguage, setAuditLanguage] = useState<'ru' | 'uz' | 'mixed'>('mixed');
  const [engines, setEngines] = useState<EngineMeta[]>([]);
  const [disputedNote, setDisputedNote] = useState('');
  const [enginesUsed, setEnginesUsed] = useState(0);
  const [mergeModel, setMergeModel] = useState('');
  const [progressText, setProgressText] = useState('');
  const [knowledgeText, setKnowledgeText] = useState('');
  const [analyzeScore, setAnalyzeScore] = useState<number | null>(null);
  const [saleProbability, setSaleProbability] = useState<number | null>(null);
  const [mentorTips, setMentorTips] = useState<string[]>([]);
  const [stageChecklist, setStageChecklist] = useState<StageChecklist>(DEFAULT_STAGE_CHECKLIST);
  const [mentorPlan, setMentorPlan] = useState<string[]>([]);

  const { token } = theme.useToken();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isTrainingEditor = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const selectedFile = useMemo(() => fileList[0]?.originFileObj ?? null, [fileList]);

  const resetResults = () => {
    setTranscript('');
    setAnalysis('');
    setEngines([]);
    setDisputedNote('');
    setEnginesUsed(0);
    setMergeModel('');
    setAnalyzeScore(null);
    setSaleProbability(null);
    setMentorTips([]);
    setStageChecklist(DEFAULT_STAGE_CHECKLIST);
    setMentorPlan([]);
  };

  const transcribeMutation = useMutation({
    mutationFn: async (file: File) => aiAssistantApi.transcribeAudio(file, languageMode),
    onSuccess: (data) => {
      setTranscript(data.text || '');
      setAnalysis('');
      setAnalyzeScore(null);
      setSaleProbability(null);
      setMentorTips([]);
      setEngines(data.engines || []);
      setDisputedNote(data.disputedNote || '');
      setEnginesUsed(data.enginesUsed || 0);
      setMergeModel(data.mergeModel || '');
      if (!data.text) message.warning('Распознавание завершено, но текст пустой');
    },
    onError: (error: any) => {
      const serverMessage = error?.response?.data?.message;
      message.error(serverMessage || 'Не удалось распознать аудио');
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async ({ text, duration, qScore }: { text: string; duration?: number; qScore?: number }) =>
      aiAssistantApi.analyzeSalesCall(text, auditLanguage, {
        audioDuration: duration,
        qualityScore: qScore,
        source: 'audio',
      }),
    onSuccess: (data) => {
      setAnalysis(data.analysis || '');
      setAnalyzeScore(typeof data.score === 'number' ? data.score : null);
      setSaleProbability(typeof data.saleProbability === 'number' ? data.saleProbability : null);
      setMentorTips(Array.isArray(data.mentorTips) ? data.mentorTips : []);
      setStageChecklist({
        greeting: Boolean(data.stageChecklist?.greeting),
        needsDiscovery: Boolean(data.stageChecklist?.needsDiscovery),
        presentation: Boolean(data.stageChecklist?.presentation),
        objectionHandling: Boolean(data.stageChecklist?.objectionHandling),
        closing: Boolean(data.stageChecklist?.closing),
      });
      setMentorPlan([]);
      if (!data.analysis) message.warning('Анализ завершён, но ответ пустой');
    },
    onError: (error: any) => {
      const serverMessage = error?.response?.data?.message;
      message.error(serverMessage || 'Не удалось проанализировать звонок');
    },
  });

  const saveKnowledgeMutation = useMutation({
    mutationFn: async (content: string) => {
      const title = `Call Audit Rule ${new Date().toLocaleString('ru-RU')}`;
      return aiTrainingApi.create({ title, content });
    },
    onSuccess: () => {
      message.success('Правило добавлено в AI Training');
      setKnowledgeText('');
    },
    onError: (error: any) => {
      const serverMessage =
        error?.response?.data?.message
        || error?.response?.data?.error
        || error?.message;
      message.error(serverMessage || 'Не удалось сохранить правило');
    },
  });

  const uploadKnowledgeFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const content = (await file.text()).trim();
      if (!content) throw new Error('Файл пустой');
      const chunks = splitIntoChunks(content, TRAINING_MAX_LEN);
      if (chunks.length === 0) throw new Error('Файл пустой');
      const now = new Date().toLocaleString('ru-RU');
      for (let i = 0; i < chunks.length; i += 1) {
        const suffix = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
        await aiTrainingApi.create({
          title: `Call Audit File ${now}${suffix}`,
          content: chunks[i],
        });
      }
      return chunks.length;
    },
    onSuccess: (chunksCount) => {
      message.success(`Файл загружен в AI Training: ${chunksCount} часть(ей) сохранено`);
    },
    onError: (error: any) => {
      const serverMessage =
        error?.response?.data?.message
        || error?.response?.data?.error
        || error?.message;
      message.error(serverMessage || 'Не удалось загрузить файл знаний');
    },
  });

  const uploadProps: UploadProps = {
    multiple: false,
    maxCount: 1,
    accept: 'audio/*',
    beforeUpload: () => false,
    fileList,
    onChange: (info) => {
      setFileList(info.fileList.slice(-1));
      resetResults();
    },
    onRemove: () => resetResults(),
  };

  const handleTranscribeAndAnalyze = async () => {
    if (!selectedFile) {
      message.warning('Сначала выберите аудио файл');
      return;
    }

    try {
      setProgressText('Шаг 1/2: 3 ИИ распознают аудио параллельно + Claude собирает финальный текст...');
      const transcribeRes = await transcribeMutation.mutateAsync(selectedFile);
      const text = (transcribeRes?.text || '').trim();
      setTranscript(text);

      if (!text) {
        message.warning('Распознавание завершено, но текст пустой');
        return;
      }

      if (transcribeRes?.auditRecommended === false) {
        setAnalysis(transcribeRes.auditSkipReason || 'Аудит не запущен из-за низкого качества записи.');
        message.warning('Низкое качество транскрипта: аудит пропущен');
        return;
      }

      setProgressText('Шаг 2/2: Claude делает AI-аудит звонка...');
      const analyzeRes = await analyzeMutation.mutateAsync({
        text,
        duration: transcribeRes?.audioQuality?.durationSec,
        qScore: transcribeRes?.qualityScore ?? undefined,
      });
      setAnalysis(analyzeRes?.analysis || '');
    } catch {
      // errors handled in mutation onError
    } finally {
      setProgressText('');
    }
  };

  const copyTranscript = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
    message.success('Текст скопирован');
  };

  const copyAnalysis = async () => {
    const cleanedAnalysis = cleanAuditAnalysis(analysis);
    if (!cleanedAnalysis) return;
    await navigator.clipboard.writeText(cleanedAnalysis);
    message.success('Анализ скопирован');
  };

  const handleSaveKnowledge = () => {
    const content = knowledgeText.trim();
    if (!content) {
      message.warning('Введите текст правила для обучения');
      return;
    }
    if (content.length > TRAINING_MAX_LEN) {
      message.warning(`Слишком длинное правило: ${content.length} символов. Максимум ${TRAINING_MAX_LEN}.`);
      return;
    }
    saveKnowledgeMutation.mutate(content);
  };

  const isLoading = transcribeMutation.isPending || analyzeMutation.isPending;
  const hasResult = Boolean(transcript || analysis || engines.length > 0);
  const stageItems: StageItem[] = [
    { key: 'greeting', label: 'Salomlashish / Приветствие', shortLabel: 'Контакт' },
    { key: 'needsDiscovery', label: 'Talablarni aniqlash / Выявление потребностей', shortLabel: 'Потребность' },
    { key: 'presentation', label: 'Taqdimot / Презентация', shortLabel: 'Презентация' },
    { key: 'objectionHandling', label: "E'tirozlar bilan ishlash / Работа с возражениями", shortLabel: 'Возражения' },
    { key: 'closing', label: 'Bitimni yopish / Закрытие сделки', shortLabel: 'Next step' },
  ];
  const stageDone = stageItems.filter((s) => stageChecklist[s.key]).length;
  const cleanedAnalysis = useMemo(() => cleanAuditAnalysis(analysis), [analysis]);
  const scoreColor = getScoreColor(analyzeScore, token);
  const saleColor = saleProbability !== null
    ? (saleProbability >= 70 ? token.colorSuccess : saleProbability >= 40 ? token.colorWarning : token.colorError)
    : token.colorTextTertiary;

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 40 }}>
      <Card
        style={{
          borderRadius: 24,
          marginBottom: 16,
          overflow: 'hidden',
          background: `linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorBgContainer} 62%)`,
          borderColor: token.colorPrimaryBorder,
        }}
        styles={{ body: { padding: 24 } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ maxWidth: 680 }}>
            <Space wrap size={[8, 8]} style={{ marginBottom: 10 }}>
              <Tag color="blue">3 STT</Tag>
              <Tag color="purple">Claude Merge</Tag>
              <Tag color="cyan">AI Mentor</Tag>
            </Space>
            <Title level={2} style={{ margin: 0 }}>Call Audit Command Center</Title>
            <Paragraph type="secondary" style={{ margin: '8px 0 0', fontSize: 15 }}>
              Загрузите звонок: AISHA, ElevenLabs и OpenAI распознают аудио параллельно, Claude собирает финальный текст и даёт управленческий аудит.
            </Paragraph>
          </div>
          <Button icon={<HistoryOutlined />} onClick={() => navigate('/ai-assistant/call-audits')}>
            История аудитов
          </Button>
        </div>

        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} lg={14}>
            <Upload.Dragger
              {...uploadProps}
              style={{
                padding: '18px 0',
                borderRadius: 18,
                background: token.colorBgContainer,
              }}
            >
              <p className="ant-upload-drag-icon"><UploadOutlined /></p>
              <p className="ant-upload-text">Перетащите аудио сюда или нажмите для выбора</p>
              <p className="ant-upload-hint">mp3 / wav / m4a / ogg · до 25 МБ · до 60 минут</p>
            </Upload.Dragger>
          </Col>
          <Col xs={24} lg={10}>
            <Card style={{ height: '100%', borderRadius: 18 }} styles={{ body: { padding: 16 } }}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={10}>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Распознавание</Text>
                    <Select<AsrLanguageMode>
                      value={languageMode}
                      onChange={(v) => setLanguageMode(v)}
                      style={{ width: '100%', marginTop: 4 }}
                      options={[
                        { value: 'auto', label: 'auto' },
                        { value: 'mixed', label: 'mixed uz+ru' },
                        { value: 'ru', label: 'ru' },
                        { value: 'uz', label: 'uz' },
                      ]}
                    />
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Язык аудита</Text>
                    <Select<'ru' | 'uz' | 'mixed'>
                      value={auditLanguage}
                      onChange={(v) => setAuditLanguage(v)}
                      style={{ width: '100%', marginTop: 4 }}
                      options={[
                        { value: 'mixed', label: 'uz + ru' },
                        { value: 'ru', label: 'ru' },
                        { value: 'uz', label: 'uz' },
                      ]}
                    />
                  </Col>
                </Row>
                <Button
                  type="primary"
                  size="large"
                  icon={<ThunderboltOutlined />}
                  onClick={handleTranscribeAndAnalyze}
                  loading={isLoading}
                  disabled={!selectedFile}
                  block
                >
                  {progressText || 'Запустить анализ'}
                </Button>
                {isLoading && (
                  <Alert
                    type="info"
                    showIcon
                    message={progressText || 'Идёт обработка'}
                    description="Обычно это занимает от нескольких секунд до пары минут: зависит от длины звонка и ответа STT-сервисов."
                    style={{ borderRadius: 12 }}
                  />
                )}
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>

      {!hasResult && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={8}>
            <Card style={{ borderRadius: 18, height: '100%' }}>
              <Statistic title="1. Распознавание" value="3" suffix="ИИ" prefix={<SoundOutlined />} />
              <Text type="secondary">AISHA + ElevenLabs + OpenAI слышат один и тот же файл.</Text>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card style={{ borderRadius: 18, height: '100%' }}>
              <Statistic title="2. Сборка текста" value="Claude" prefix={<RobotOutlined />} />
              <Text type="secondary">Claude выбирает лучший вариант слов и собирает диалог.</Text>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card style={{ borderRadius: 18, height: '100%' }}>
              <Statistic title="3. Менторинг" value="9" suffix="шагов" prefix={<TrophyOutlined />} />
              <Text type="secondary">Аудит по типу звонка, рискам, этапам и рекомендациям.</Text>
            </Card>
          </Col>
        </Row>
      )}

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <EngineStatusStrip engines={engines} enginesUsed={enginesUsed} mergeModel={mergeModel} />

        {hasResult && (
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard
                title="Оценка менеджера"
                value={analyzeScore !== null ? analyzeScore : '-'}
                suffix={analyzeScore !== null ? '/10' : undefined}
                icon={<TrophyOutlined />}
                accent={scoreColor}
              >
                <Progress
                  percent={analyzeScore !== null ? Math.round((analyzeScore / 10) * 100) : 0}
                  showInfo={false}
                  strokeColor={scoreColor}
                />
              </MetricCard>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard
                title="Вероятность продажи"
                value={saleProbability !== null ? `${saleProbability}` : '-'}
                suffix={saleProbability !== null ? '%' : undefined}
                icon={<StarOutlined />}
                accent={saleColor}
              >
                <Progress percent={saleProbability ?? 0} showInfo={false} strokeColor={saleColor} />
              </MetricCard>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard
                title="Риск по звонку"
                value={getRiskLevel(analyzeScore)}
                icon={<AuditOutlined />}
                accent={scoreColor}
              >
                <Tag color={getRiskColor(analyzeScore)}>{getRiskLevel(analyzeScore)}</Tag>
              </MetricCard>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard
                title="Покрытие этапов"
                value={stageDone}
                suffix={`/ ${stageItems.length}`}
                icon={<BarChartOutlined />}
                accent={stageDone >= 4 ? token.colorSuccess : stageDone >= 2 ? token.colorWarning : token.colorError}
              >
                <Progress
                  percent={Math.round((stageDone / stageItems.length) * 100)}
                  showInfo={false}
                  strokeColor={stageDone >= 4 ? token.colorSuccess : stageDone >= 2 ? token.colorWarning : token.colorError}
                />
              </MetricCard>
            </Col>
          </Row>
        )}

        {hasResult && (
          <Row gutter={[16, 16]} align="stretch">
            <Col xs={24} xl={15}>
              <MentorPanel
                mentorTips={mentorTips}
                mentorPlan={mentorPlan}
                onBuildPlan={() => setMentorPlan(buildMentorPlan(mentorTips))}
              />
            </Col>
            <Col xs={24} xl={9}>
              <StageRadar stageItems={stageItems} stageChecklist={stageChecklist} />
            </Col>
          </Row>
        )}

        <Card title={<span><FileTextOutlined /> Результаты</span>} style={{ borderRadius: 18 }}>
          <Tabs
            defaultActiveKey="audit"
            items={[
              {
                key: 'audit',
                label: 'AI-аудит',
                children: (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                      <Button type="text" icon={<CopyOutlined />} onClick={copyAnalysis} disabled={!analysis}>
                        Копировать аудит
                      </Button>
                    </div>
                    {cleanedAnalysis ? (
                      <AuditMarkdown content={cleanedAnalysis} />
                    ) : (
                      <Text type="secondary">Аудит появится автоматически после распознавания.</Text>
                    )}
                  </>
                ),
              },
              {
                key: 'transcript',
                label: 'Финальный транскрипт',
                children: (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                      <Button type="text" icon={<CopyOutlined />} onClick={copyTranscript} disabled={!transcript}>
                        Копировать текст
                      </Button>
                    </div>
                    {transcript ? (
                      <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{transcript}</Paragraph>
                    ) : (
                      <Text type="secondary">Загрузите аудио и нажмите кнопку — здесь появится финальный диалог.</Text>
                    )}
                  </>
                ),
              },
              {
                key: 'technical',
                label: 'Технические детали',
                children: (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {engines.length > 0 ? (
                      <Space wrap size={[10, 10]}>
                        {engines.map((e) => <EngineBadge key={e.engine} engine={e} />)}
                      </Space>
                    ) : (
                      <Text type="secondary">Технические детали появятся после обработки файла.</Text>
                    )}
                    {disputedNote && (
                      <Collapse
                        items={[{
                          key: 'disputed',
                          label: 'Спорные места и решения Claude',
                          children: <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{disputedNote}</Paragraph>,
                        }]}
                      />
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>

        {isTrainingEditor && (
          <Card
            title="AI Training"
            extra={(
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveKnowledge}
                loading={saveKnowledgeMutation.isPending}
              >
                Сохранить
              </Button>
            )}
            style={{ borderRadius: 18 }}
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Text type="secondary">
                Добавьте правило или критерий — оно попадёт в обучение AI ассистента и аудитора.
              </Text>
              <Upload
                accept={TRAINING_FILE_ACCEPT}
                showUploadList={false}
                beforeUpload={(file) => {
                  uploadKnowledgeFileMutation.mutate(file as File);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploadKnowledgeFileMutation.isPending}>
                  Загрузить текстовый файл
                </Button>
              </Upload>
              <Input.TextArea
                value={knowledgeText}
                onChange={(e) => setKnowledgeText(e.target.value)}
                rows={6}
                maxLength={TRAINING_MAX_LEN}
                showCount
                placeholder="Masalan: Har bir xato uchun aniq iqtibos majburiy. Dalilsiz xulosa yozilmasin."
              />
            </Space>
          </Card>
        )}
      </Space>
    </div>
  );
}
