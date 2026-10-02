import { useRef, useState } from 'react';
import { Button, Modal, Space, Typography, message } from 'antd';
import { PictureOutlined, UndoOutlined } from '@ant-design/icons';
import defaultBackground from '../assets/glass-bg.webp';
import { MAX_UPLOAD_BYTES } from '../lib/customBackground';
import { useBackgroundStore } from '../store/backgroundStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Выбор фона для стеклянного дизайна. Фон хранится только на этом устройстве. */
export default function BackgroundPickerModal({ open, onClose }: Props) {
  const { url, setFromFile, reset } = useBackgroundStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      message.error('Это не картинка — выберите фото');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      message.error('Фото больше 25 МБ — выберите поменьше');
      return;
    }
    setBusy(true);
    try {
      await setFromFile(file);
      message.success('Фон обновлён');
    } catch {
      message.error('Не удалось открыть фото — попробуйте другое');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} title="Фон" width={480}>
      <div
        style={{
          height: 220,
          borderRadius: 16,
          background: `url("${url ?? defaultBackground}") center / cover no-repeat`,
          marginBottom: 16,
        }}
      />
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Фон хранится только на этом устройстве: на телефоне и на компьютере можно поставить разные фото.
      </Typography.Paragraph>
      <Space wrap>
        <Button type="primary" icon={<PictureOutlined />} loading={busy} onClick={() => inputRef.current?.click()}>
          Загрузить фото
        </Button>
        <Button icon={<UndoOutlined />} disabled={!url || busy} onClick={() => void reset()}>
          Вернуть стандартный
        </Button>
      </Space>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </Modal>
  );
}
