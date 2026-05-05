import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Input,
  Progress,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  AuditOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  HistoryOutlined,
  MinusCircleFilled,
  SaveOutlined,
  SoundOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
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
  aisha: 'Узбекский STT (KotibAI)',
  elevenlabs: 'Универсальный STT с диаризацией',
  openai: 'gpt-4o-transcribe',
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
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

type StageChecklist = {
  greeting: boolean;
  needsDiscovery: boolean;
  presentation: boolean;
  objectionHandling: boolean;
  closing: boolean;
};

const DEFAULT_STAGE_CHECKLIST: StageChecklist = {
  greeting: false,
  needsDiscovery: false,
  presentation: false,
  objectionHandling: false,
  closing: false,
};

function buildMentorPlan(tips: string[]): string[] {
  if (tips.length === 0) return [];
  const days = [
    `1-kun: Qo'ng'iroq skriptini qayta o'qing va 3 ta asosiy savol tayyorlang.`,
    `2-kun: 5 ta ochiq savol bilan ehtiyoj aniqlash mashqi qiling.`,
    `3-kun: E'tirozlar ro'yxatini tuzing va har biriga 1 javob yozing.`,
    `4-kun: Taqdimot blokini 90 soniyaga qisqartirib aytib bering.`,
    `5-kun: 3 ta \"yopuvchi\" frazani ovoz chiqarib mashq qiling.`,
    `6-kun: O'zingizning 1 qo'ng'irog'ingizni qayta tinglab self-audit qiling.`,
    `7-kun: Qayta qo'ng'iroq simulyatsiyasi: ehtiyoj → qiymat → objection → close.`,
  ];
  const mappedTips = tips.slice(0, 7).map((tip, idx) => `${idx + 1}-kun mentor fokus: ${tip}`);
  return days.map((d, idx) => `${d} ${mappedTips[idx] ? `\n${mappedTips[idx]}` : ''}`.trim());
}

function EngineBadge({ engine }: { engine: EngineMeta }) {
  const label = ENGINE_LABELS[engine.engine];
  const sub = ENGINE_DESCRIPTIONS[engine.engine];

  let icon;
  let color;
  let statusText;

  if (engine.status === 'success') {
    icon = <CheckCircleFilled style={{ color: '#52c41a' }} />;
    color = '#f6ffed';
    statusText = `${engine.textLength} симв · ${formatMs(engine.durationMs)}`;
  } else if (engine.status === 'skipped') {
    icon = <MinusCircleFilled style={{ color: '#bfbfbf' }} />;
    color = '#fafafa';
    statusText = 'Пропущен (нет ключа)';
  } else {
    icon = <CloseCircleFilled style={{ color: '#ff4d4f' }} />;
    color = '#fff1f0';
    statusText = 'Ошибка';
  }

  return (
    <div
      style={{
        background: color,
        border: '1px solid rgba(0,0,0,0.06)',
        borderRadius: 8,
        padding: '10px 14px',
        flex: '1 1 200px',
        minWidth: 200,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {icon}
        <Text strong>{label}</Text>
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{sub}</Text>
      <Text style={{ fontSize: 12, display: 'block', marginTop: 4 }}>{statusText}</Text>
      {engine.error && engine.status === 'error' && (
        <Text type="danger" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
          {engine.error.slice(0, 120)}
        </Text>
      )}
    </div>
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
      setProgressText('Шаг 1/2: 3 ИИ распознают аудио параллельно + Claude собирает финальный текст…');
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

      setProgressText('Шаг 2/2: AI-аудит звонка…');
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
    if (!analysis) return;
    await navigator.clipboard.writeText(analysis);
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
  const successCount = engines.filter((e) => e.status === 'success').length;
  const stageItems: Array<{ key: keyof StageChecklist; label: string }> = [
    { key: 'greeting', label: 'Salomlashish / Приветствие' },
    { key: 'needsDiscovery', label: 'Talablarni aniqlash / Выявление потребностей' },
    { key: 'presentation', label: 'Taqdimot / Презентация' },
    { key: 'objectionHandling', label: "E'tirozlar bilan ishlash / Работа с возражениями" },
    { key: 'closing', label: 'Bitimni yopish / Закрытие сделки' },
  ];
  const stageDone = stageItems.filter((s) => stageChecklist[s.key]).length;
  const riskLevel = analyzeScore === null
    ? 'N/A'
    : analyzeScore >= 7
      ? 'Низкий риск'
      : analyzeScore >= 5
        ? 'Средний риск'
        : 'Высокий риск';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>
            <SoundOutlined /> Аудио в текст · 3 ИИ + Claude
          </Title>
          <Text type="secondary">
            AISHA, ElevenLabs и OpenAI распознают параллельно — Claude собирает один точный финальный текст.
          </Text>
        </div>
        <Button icon={<HistoryOutlined />} onClick={() => navigate('/ai-assistant/call-audits')}>
          История аудитов
        </Button>
      </div>

      {/* ───────────── Upload + Settings ───────────── */}
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Text>Язык распознавания:</Text>
              <Select<AsrLanguageMode>
                value={languageMode}
                onChange={(v) => setLanguageMode(v)}
                style={{ minWidth: 200 }}
                options={[
                  { value: 'auto', label: 'auto (рекомендуется)' },
                  { value: 'mixed', label: 'mixed (uz + ru)' },
                  { value: 'ru', label: 'Только русский' },
                  { value: 'uz', label: 'Только узбекский' },
                ]}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Text>Язык аудита:</Text>
              <Select<'ru' | 'uz' | 'mixed'>
                value={auditLanguage}
                onChange={(v) => setAuditLanguage(v)}
                style={{ minWidth: 180 }}
                options={[
                  { value: 'mixed', label: 'uz + ru (по умолчанию)' },
                  { value: 'ru', label: 'Только русский' },
                  { value: 'uz', label: 'Только узбекский' },
                ]}
              />
            </div>
          </div>

          <Upload.Dragger {...uploadProps} style={{ padding: '12px 0' }}>
            <p className="ant-upload-drag-icon">
              <UploadOutlined />
            </p>
            <p className="ant-upload-text">Перетащите аудио сюда или нажмите для выбора</p>
            <p className="ant-upload-hint">
              mp3 / wav / m4a / ogg · до 25 МБ · до 60 минут
            </p>
          </Upload.Dragger>

          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            onClick={handleTranscribeAndAnalyze}
            loading={isLoading}
            disabled={!selectedFile}
            block
          >
            {progressText || 'Запустить 3 ИИ + Claude и проанализировать'}
          </Button>
        </Space>
      </Card>

      {/* ───────────── Engine status ───────────── */}
      {engines.length > 0 && (
        <Card
          title={
            <span>
              Состояние движков:&nbsp;
              <Tag color={successCount >= 2 ? 'green' : successCount === 1 ? 'gold' : 'red'}>
                {successCount} из 3 успешно
              </Tag>
              {mergeModel && mergeModel !== 'fallback' && mergeModel !== 'single-source' && (
                <Tag color="blue">Слияние: {mergeModel}</Tag>
              )}
              {mergeModel === 'single-source' && <Tag color="default">Только 1 источник</Tag>}
            </span>
          }
          size="small"
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {engines.map((e) => (
              <EngineBadge key={e.engine} engine={e} />
            ))}
          </div>
          {enginesUsed === 1 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message="Сработал только 1 движок"
              description="Слияние не выполнялось — используется текст одного источника. Проверьте ключи остальных STT в Render."
            />
          )}
        </Card>
      )}

      {/* ───────────── Final transcript ───────────── */}
      <Card
        title={
          <span>
            Финальный транскрипт{' '}
            {mergeModel && mergeModel !== 'fallback' && mergeModel !== 'single-source' && (
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>(собран Claude)</Text>
            )}
          </span>
        }
        extra={
          <Button type="text" icon={<CopyOutlined />} onClick={copyTranscript} disabled={!transcript}>
            Копировать
          </Button>
        }
      >
        {transcript ? (
          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{transcript}</Paragraph>
        ) : (
          <Text type="secondary">Загрузите аудио и нажмите кнопку — здесь появится финальный диалог.</Text>
        )}

        {disputedNote && (
          <Collapse
            ghost
            style={{ marginTop: 16 }}
            items={[{
              key: 'disputed',
              label: <Text type="secondary">Спорные места и решения Claude</Text>,
              children: <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{disputedNote}</Paragraph>,
            }]}
          />
        )}
      </Card>

      {/* ───────────── Analysis ───────────── */}
      <Card
        title={<span><AuditOutlined /> AI-аудит звонка</span>}
        extra={
          <Button type="text" icon={<CopyOutlined />} onClick={copyAnalysis} disabled={!analysis}>
            Копировать
          </Button>
        }
      >
        {(analyzeScore !== null || saleProbability !== null) && (
          <>
            <Space size={24} wrap style={{ width: '100%', marginBottom: 8 }}>
              {analyzeScore !== null && (
                <div style={{ minWidth: 220 }}>
                  <Text type="secondary">Оценка менеджера</Text>
                  <Progress
                    percent={Math.round((analyzeScore / 10) * 100)}
                    strokeColor={analyzeScore >= 7 ? '#52c41a' : analyzeScore >= 5 ? '#faad14' : '#ff4d4f'}
                    format={() => `${analyzeScore}/10`}
                  />
                </div>
              )}
              {saleProbability !== null && (
                <div style={{ minWidth: 220 }}>
                  <Text type="secondary">Вероятность продажи</Text>
                  <Progress
                    type="dashboard"
                    percent={saleProbability}
                    size={118}
                    strokeColor={saleProbability >= 70 ? '#52c41a' : saleProbability >= 40 ? '#faad14' : '#ff4d4f'}
                    format={(p) => `${p}%`}
                  />
                </div>
              )}
              <div style={{ minWidth: 220 }}>
                <Text type="secondary">Уровень риска</Text>
                <div style={{ marginTop: 8 }}>
                  <Tag color={analyzeScore !== null && analyzeScore >= 7 ? 'green' : analyzeScore !== null && analyzeScore >= 5 ? 'gold' : 'red'}>
                    {riskLevel}
                  </Tag>
                  <Tag color={stageDone >= 4 ? 'green' : stageDone >= 2 ? 'gold' : 'red'}>
                    Этапы: {stageDone}/5
                  </Tag>
                </div>
              </div>
            </Space>
            <Divider style={{ marginTop: 8, marginBottom: 12 }} />
          </>
        )}

        <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>Мини-радар этапов продаж</Title>
        <Space wrap size={[8, 8]} style={{ marginBottom: 10 }}>
          {stageItems.map((stage) => (
            <Tag key={stage.key} color={stageChecklist[stage.key] ? 'green' : 'red'}>
              {stageChecklist[stage.key] ? '✓' : '✗'} {stage.label}
            </Tag>
          ))}
        </Space>
        <Progress
          percent={Math.round((stageDone / 5) * 100)}
          strokeColor={stageDone >= 4 ? '#52c41a' : stageDone >= 2 ? '#faad14' : '#ff4d4f'}
          format={(p) => `Покрытие этапов: ${p}%`}
          style={{ marginBottom: 12 }}
        />

        {mentorTips.length > 0 && (
          <>
            <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>Советы от ментора</Title>
            <ul style={{ marginTop: 0, marginBottom: 12, paddingInlineStart: 20 }}>
              {mentorTips.map((tip, idx) => (
                <li key={`${idx}-${tip.slice(0, 20)}`} style={{ marginBottom: 6 }}>
                  <Text>{tip}</Text>
                </li>
              ))}
            </ul>
            <Button
              onClick={() => setMentorPlan(buildMentorPlan(mentorTips))}
              style={{ marginBottom: 10 }}
            >
              Сгенерировать 7-дневный план тренировки
            </Button>
            {mentorPlan.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {mentorPlan.map((item, idx) => (
                  <Card key={`plan-${idx}`} size="small" style={{ marginBottom: 8 }}>
                    <Text style={{ whiteSpace: 'pre-wrap' }}>{item}</Text>
                  </Card>
                ))}
              </div>
            )}
            <Divider style={{ marginTop: 8, marginBottom: 12 }} />
          </>
        )}

        {analysis ? (
          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{analysis}</Paragraph>
        ) : (
          <Text type="secondary">
            Аудит появится автоматически после распознавания.
          </Text>
        )}
      </Card>

      {/* ───────────── Knowledge editor (admins only) ───────────── */}
      {isTrainingEditor && (
        <Card
          title="Накачать знания в AI Training"
          extra={
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveKnowledge}
              loading={saveKnowledgeMutation.isPending}
            >
              Сохранить
            </Button>
          }
        >
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Text type="secondary">
              Добавьте правило/критерий — оно сразу попадёт в обучение AI ассистента и аудитора.
            </Text>
            <Upload
              accept={TRAINING_FILE_ACCEPT}
              showUploadList={false}
              beforeUpload={(file) => {
                uploadKnowledgeFileMutation.mutate(file as File);
                return false;
              }}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploadKnowledgeFileMutation.isPending}
              >
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
  );
}
