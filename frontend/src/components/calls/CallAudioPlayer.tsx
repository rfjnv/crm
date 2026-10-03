import { useEffect, useRef, useState } from 'react';
import { Button, Segmented, Space, message } from 'antd';
import { CaretRightOutlined } from '@ant-design/icons';
import { callsApi } from '../../api/calls.api';
import { apiErrorMessage } from './callsUi';

const RATES = [1, 1.5, 2];

/**
 * Плеер записи. Ссылка (signed URL на час) запрашивается только по нажатию «Слушать» —
 * чтобы не выпускать ссылки на все записи страницы и не платить за лишние запросы.
 */
export default function CallAudioPlayer({ callId, block }: { callId: string; block?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rate, setRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, url]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await callsApi.audioUrl(callId);
      setUrl(res.url);
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось получить запись'));
    } finally {
      setLoading(false);
    }
  };

  if (!url) {
    return (
      <Button size="small" icon={<CaretRightOutlined />} loading={loading} onClick={(e) => { e.stopPropagation(); void load(); }}>
        Слушать
      </Button>
    );
  }

  return (
    <Space size={6} wrap style={block ? { width: '100%' } : undefined} onClick={(e) => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={url}
        controls
        autoPlay
        preload="none"
        style={{ height: 32, width: block ? '100%' : 240, maxWidth: '100%' }}
        onLoadedMetadata={(e) => { e.currentTarget.playbackRate = rate; }}
        // Ссылка живёт час: если истекла — попросить новую при следующем нажатии
        onError={() => setUrl(null)}
      />
      <Segmented
        size="small"
        value={rate}
        onChange={(v) => setRate(Number(v))}
        options={RATES.map((r) => ({ value: r, label: `${r}×` }))}
      />
    </Space>
  );
}
