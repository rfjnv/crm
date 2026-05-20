import { Alert, Typography } from 'antd';
import { CMS_SCHEMA_HINT } from '../../site-admin/supabaseErrors';

export default function CmsSchemaAlert() {
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      message="Таблицы сайта не найдены в Supabase"
      description={
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          {CMS_SCHEMA_HINT}
        </Typography.Paragraph>
      }
    />
  );
}
