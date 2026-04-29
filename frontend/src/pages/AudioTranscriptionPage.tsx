import { useMemo, useState } from 'react';
import { Button, Card, Input, Select, Space, Tag, Tabs, Typography, Upload, message } from 'antd';
import { CopyOutlined, UploadOutlined, AuditOutlined, SaveOutlined, FileTextOutlined, HistoryOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import { aiAssistantApi, aiTrainingApi, type AsrLanguageMode } from '../api/ai-assistant.api';
import { useAuthStore } from '../store/authStore';

const { Title, Text } = Typography;
const TRAINING_MAX_LEN = 5000;
const TRAINING_FILE_ACCEPT = '.txt,.md,.csv,.json';

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

export default function AudioTranscriptionPage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [transcript, setTranscript] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [languageMode, setLanguageMode] = useState<AsrLanguageMode>('auto');
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [needsHumanReview, setNeedsHumanReview] = useState<boolean | null>(null);
  const [auditRecommended, setAuditRecommended] = useState<boolean | null>(null);
  const [audioWarnings, setAudioWarnings] = useState<string[]>([]);
  const [knowledgeText, setKnowledgeText] = useState('');
  const [progressText, setProgressText] = useState('');
  const [manualTranscript, setManualTranscript] = useState('');
  const [manualAnalysis, setManualAnalysis] = useState('');
  const [auditLanguage, setAuditLanguage] = useState<'ru' | 'uz' | 'mixed'>('mixed');
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isTrainingEditor = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const selectedFile = useMemo(() => fileList[0]?.originFileObj ?? null, [fileList]);

  const transcribeMutation = useMutation({
    mutationFn: async (file: File) => aiAssistantApi.transcribeAudio(file, languageMode),
    onSuccess: (data) => {
      setTranscript(data.text || '');
      setAnalysis('');
      setQualityScore(typeof data.qualityScore === 'number' ? data.qualityScore : null);
      setNeedsHumanReview(typeof data.needsHumanReview === 'boolean' ? data.needsHumanReview : null);
      setAuditRecommended(typeof data.auditRecommended === 'boolean' ? data.auditRecommended : null);
      setAudioWarnings(Array.isArray(data.audioQuality?.warnings) ? data.audioQuality.warnings : []);
      if (!data.text) message.warning('Распознавание завершено, но текст пустой');
    },
    onError: (error: any) => {
      const serverMessage = error?.response?.data?.message;
      message.error(serverMessage || 'Не удалось распознать аудио (проверьте размер файла и сеть)');
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
      if (!data.analysis) message.warning('Анализ завершен, но ответ пустой');
    },
    onError: (error: any) => {
      const serverMessage = error?.response?.data?.message;
      message.error(serverMessage || 'Не удалось проанализировать звонок (таймаут или перегрузка)');
    },
  });

  const manualAnalyzeMutation = useMutation({
    mutationFn: async (text: string) => aiAssistantApi.analyzeSalesCall(text, auditLanguage, { source: 'text' }),
    onSuccess: (data) => {
      setManualAnalysis(data.analysis || '');
      if (!data.analysis) message.warning('Анализ завершен, но ответ пустой');
    },
    onError: (error: any) => {
      const serverMessage = error?.response?.data?.message;
      message.error(serverMessage || 'Не удалось проанализировать (таймаут или перегрузка)');
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
      if (!content) {
        throw new Error('Файл пустой');
      }
      const chunks = splitIntoChunks(content, TRAINING_MAX_LEN);
      if (chunks.length === 0) {
        throw new Error('Файл пустой');
      }
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
      setTranscript('');
      setAnalysis('');
      setQualityScore(null);
      setNeedsHumanReview(null);
      setAuditRecommended(null);
      setAudioWarnings([]);
    },
    onRemove: () => {
      setTranscript('');
      setAnalysis('');
      setQualityScore(null);
      setNeedsHumanReview(null);
      setAuditRecommended(null);
      setAudioWarnings([]);
    },
  };

  const copyResult = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
    message.success('Текст скопирован');
  };

  const copyAnalysis = async () => {
    if (!analysis) return;
    await navigator.clipboard.writeText(analysis);
    message.success('Анализ скопирован');
  };

  const handleTranscribeAndAnalyze = async () => {
    if (!selectedFile) {
      message.warning('Сначала выберите аудио файл');
      return;
    }

    try {
      setProgressText('Шаг 1/2: распознаем аудио...');
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
        setProgressText('');
        return;
      }

      setProgressText('Шаг 2/2: анализируем разговор...');
      const analyzeRes = await analyzeMutation.mutateAsync({
        text,
        duration: transcribeRes?.audioQuality?.durationSec,
        qScore: transcribeRes?.qualityScore ?? undefined,
      });
      setAnalysis(analyzeRes?.analysis || '');
      if (!analyzeRes?.analysis) {
        message.warning('Анализ завершен, но ответ пустой');
      }
      if (!knowledgeText.trim() && analyzeRes?.analysis) {
        setKnowledgeText(`Konkret qoida:\n${analyzeRes.analysis}\n\nTalab: har bir xulosa iqtibos bilan bo'lsin.`);
      }
    } catch {
      // errors are handled inside mutation onError callbacks
    } finally {
      setProgressText('');
    }
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>Аудио в текст — Ментор менеджеров</Title>
          <Text type="secondary">
            Загрузите аудио или вставьте готовый текст — AI проведёт строгий аудит звонка.
          </Text>
        </div>
        <Button icon={<HistoryOutlined />} onClick={() => navigate('/ai-assistant/call-audits')}>
          История аудитов
        </Button>
      </div>

      <Tabs
        defaultActiveKey="audio"
        items={[
          {
            key: 'audio',
            label: <span><UploadOutlined /> Аудио файл</span>,
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card>
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Text>Язык ASR:</Text>
                        <Select<AsrLanguageMode>
                          value={languageMode}
                          onChange={(v) => setLanguageMode(v)}
                          style={{ minWidth: 200 }}
                          options={[
                            { value: 'auto', label: 'auto (рекомендуется)' },
                            { value: 'mixed', label: 'mixed (ru+uz)' },
                            { value: 'ru', label: 'ru' },
                            { value: 'uz', label: 'uz' },
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
                        Поддерживаются стандартные аудио форматы (mp3, wav, m4a и т.д.)
                      </p>
                    </Upload.Dragger>

                    <Button
                      type="primary"
                      icon={<AuditOutlined />}
                      onClick={handleTranscribeAndAnalyze}
                      loading={transcribeMutation.isPending || analyzeMutation.isPending}
                      disabled={!selectedFile}
                    >
                      {progressText || 'Распознать + Анализировать'}
                    </Button>
                  </Space>
                </Card>

                <Card
                  title="Транскрипт"
                  extra={(
                    <Space wrap>
                      {qualityScore !== null && (
                        <Tag color={qualityScore >= 7 ? 'green' : qualityScore >= 5 ? 'gold' : 'red'}>
                          Quality: {qualityScore}/10
                        </Tag>
                      )}
                      {needsHumanReview === true && <Tag color="gold">Проверь вручную</Tag>}
                      {auditRecommended === false && <Tag color="default">Аудит пропущен</Tag>}
                      <Button type="text" icon={<CopyOutlined />} onClick={copyResult} disabled={!transcript}>
                        Копировать
                      </Button>
                    </Space>
                  )}
                >
                  {audioWarnings.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <Text type="secondary">Предупреждения аудио: </Text>
                      <Text>{audioWarnings.join(', ')}</Text>
                    </div>
                  )}
                  {transcript ? (
                    <Text style={{ whiteSpace: 'pre-wrap' }}>{transcript}</Text>
                  ) : (
                    <Text type="secondary">Пока нет расшифровки</Text>
                  )}
                </Card>

                <Card
                  title="Анализ менеджера (AI-аудит)"
                  extra={(
                    <Button type="text" icon={<CopyOutlined />} onClick={copyAnalysis} disabled={!analysis}>
                      Копировать
                    </Button>
                  )}
                >
                  {analysis ? (
                    <Text style={{ whiteSpace: 'pre-wrap' }}>{analysis}</Text>
                  ) : (
                    <Text type="secondary">
                      Нажмите «Распознать + Анализировать», чтобы получить строгий аудит разговора менеджера.
                    </Text>
                  )}
                </Card>
              </Space>
            ),
          },
          {
            key: 'text',
            label: <span><FileTextOutlined /> Готовый текст</span>,
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card title="Вставьте транскрипт вручную">
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Text type="secondary">
                      Если у вас уже есть расшифровка звонка — вставьте её сюда и нажмите «Анализировать».
                    </Text>
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
                    <Input.TextArea
                      value={manualTranscript}
                      onChange={(e) => {
                        setManualTranscript(e.target.value);
                        setManualAnalysis('');
                      }}
                      rows={10}
                      placeholder="Вставьте текст разговора...&#10;&#10;Например:&#10;Менеджер: Алло, добрый день!&#10;Клиент: Здравствуйте, интересует ламинация..."
                      style={{ fontFamily: 'monospace', fontSize: 13 }}
                    />
                    <Button
                      type="primary"
                      icon={<AuditOutlined />}
                      loading={manualAnalyzeMutation.isPending}
                      disabled={manualTranscript.trim().length < 20}
                      onClick={() => manualAnalyzeMutation.mutate(manualTranscript.trim())}
                    >
                      Анализировать
                    </Button>
                  </Space>
                </Card>

                <Card
                  title="Анализ менеджера (AI-аудит)"
                  extra={(
                    <Button
                      type="text"
                      icon={<CopyOutlined />}
                      disabled={!manualAnalysis}
                      onClick={async () => {
                        await navigator.clipboard.writeText(manualAnalysis);
                        message.success('Анализ скопирован');
                      }}
                    >
                      Копировать
                    </Button>
                  )}
                >
                  {manualAnalysis ? (
                    <Text style={{ whiteSpace: 'pre-wrap' }}>{manualAnalysis}</Text>
                  ) : (
                    <Text type="secondary">
                      Вставьте текст разговора выше и нажмите «Анализировать».
                    </Text>
                  )}
                </Card>
              </Space>
            ),
          },
        ]}
      />

      {isTrainingEditor && (
        <Card
          title="Накачать знания в CRM"
          extra={(
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveKnowledge}
              loading={saveKnowledgeMutation.isPending}
            >
              Сохранить в AI Training
            </Button>
          )}
        >
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Text type="secondary">
              Добавьте сюда правило/критерий, и оно сразу попадет в обучение AI ассистента.
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
                Загрузить текстовый файл в AI Training
              </Button>
            </Upload>
            <Input.TextArea
              value={knowledgeText}
              onChange={(e) => setKnowledgeText(e.target.value)}
              rows={8}
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
