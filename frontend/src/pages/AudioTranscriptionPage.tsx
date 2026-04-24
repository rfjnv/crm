import { useMemo, useState } from 'react';
import { Button, Card, Space, Typography, Upload, message } from 'antd';
import { CopyOutlined, UploadOutlined, AuditOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import { aiAssistantApi } from '../api/ai-assistant.api';

const { Title, Text } = Typography;

export default function AudioTranscriptionPage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [transcript, setTranscript] = useState('');
  const [analysis, setAnalysis] = useState('');

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
    } catch {
      // errors are handled inside mutation onError callbacks
    }
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
    </Space>
  );
}
