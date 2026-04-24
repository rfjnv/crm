import { useMemo, useState } from 'react';
import { Button, Card, Input, Space, Typography, Upload, message } from 'antd';
import { CopyOutlined, UploadOutlined, AuditOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import { aiAssistantApi, aiTrainingApi } from '../api/ai-assistant.api';
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
  const [knowledgeText, setKnowledgeText] = useState('');
  const role = useAuthStore((s) => s.user?.role);
  const isTrainingEditor = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const selectedFile = useMemo(() => fileList[0]?.originFileObj ?? null, [fileList]);

  const transcribeMutation = useMutation({
    mutationFn: async (file: File) => aiAssistantApi.transcribeAudio(file),
    onSuccess: (data) => {
      setTranscript(data.text || '');
      setAnalysis('');
      if (!data.text) message.warning('Распознавание завершено, но текст пустой');
    },
    onError: (error: any) => {
      const serverMessage = error?.response?.data?.message;
      message.error(serverMessage || 'Не удалось распознать аудио');
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (text: string) => aiAssistantApi.analyzeSalesCall(text),
    onSuccess: (data) => {
      setAnalysis(data.analysis || '');
      if (!data.analysis) message.warning('Анализ завершен, но ответ пустой');
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
    },
    onRemove: () => {
      setTranscript('');
      setAnalysis('');
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
      const transcribeRes = await transcribeMutation.mutateAsync(selectedFile);
      const text = (transcribeRes?.text || '').trim();
      setTranscript(text);

      if (!text) {
        message.warning('Распознавание завершено, но текст пустой');
        return;
      }

      const analyzeRes = await analyzeMutation.mutateAsync(text);
      setAnalysis(analyzeRes?.analysis || '');
      if (!analyzeRes?.analysis) {
        message.warning('Анализ завершен, но ответ пустой');
      }
      if (!knowledgeText.trim() && analyzeRes?.analysis) {
        setKnowledgeText(`Konkret qoida:\n${analyzeRes.analysis}\n\nTalab: har bir xulosa iqtibos bilan bo'lsin.`);
      }
    } catch {
      // errors are handled inside mutation onError callbacks
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
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>Аудио в текст</Title>
        <Text type="secondary">
          Загрузите аудио файл, система отправит его в OpenAI и вернет расшифровку.
        </Text>
      </div>

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
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
            Распознать + Анализировать
          </Button>
        </Space>
      </Card>

      <Card
        title="Транскрипт"
        extra={(
          <Button
            type="text"
            icon={<CopyOutlined />}
            onClick={copyResult}
            disabled={!transcript}
          >
            Копировать
          </Button>
        )}
      >
        {transcript ? (
          <Text style={{ whiteSpace: 'pre-wrap' }}>{transcript}</Text>
        ) : (
          <Text type="secondary">Пока нет расшифровки</Text>
        )}
      </Card>

      <Card
        title="Анализ менеджера (AI-аудит)"
        extra={(
          <Space>
            <Button
              type="text"
              icon={<CopyOutlined />}
              onClick={copyAnalysis}
              disabled={!analysis}
            >
              Копировать
            </Button>
          </Space>
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
