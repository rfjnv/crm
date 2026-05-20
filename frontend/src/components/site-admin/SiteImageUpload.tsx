import { useState } from 'react';
import { Upload, Image, Typography, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { siteCmsApi } from '../../api/siteCms.api';

type Props = {
  currentUrl: string | null;
  folder: string;
  onUploaded: (url: string) => void;
};

export default function SiteImageUpload({ currentUrl, folder, onUploaded }: Props) {
  const [loading, setLoading] = useState(false);

  return (
    <div>
      {currentUrl ? (
        <Image src={currentUrl} alt="" style={{ maxWidth: 180, marginBottom: 8 }} />
      ) : (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Нет фото
        </Typography.Text>
      )}
      <Upload
        showUploadList={false}
        accept="image/*"
        beforeUpload={(file) => {
          setLoading(true);
          siteCmsApi
            .uploadImage(file, folder)
            .then((url) => {
              onUploaded(url);
              message.success('Загружено');
            })
            .catch((err: { response?: { data?: { error?: string } } }) =>
              message.error(err.response?.data?.error || 'Ошибка загрузки'),
            )
            .finally(() => setLoading(false));
          return false;
        }}
      >
        <UploadOutlined /> {loading ? 'Загрузка…' : 'Загрузить'}
      </Upload>
    </div>
  );
}
