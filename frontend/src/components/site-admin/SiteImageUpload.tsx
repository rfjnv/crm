import { useState } from 'react';
import { Upload, Image, Typography, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { uploadSiteImage } from '../../site-admin/storage';

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
          uploadSiteImage(file, folder)
            .then((url) => {
              onUploaded(url);
              message.success('Загружено');
            })
            .catch((e: Error) => message.error(e.message))
            .finally(() => setLoading(false));
          return false;
        }}
      >
        <UploadOutlined /> {loading ? 'Загрузка…' : 'Загрузить'}
      </Upload>
    </div>
  );
}
