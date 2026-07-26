import { Tag } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';

export default function ReceiptPunchedTag({ isReceiptPunched }: { isReceiptPunched?: boolean }) {
  if (!isReceiptPunched) return null;
  return (
    <Tag color="green" icon={<CheckCircleFilled />}>
      Чек пробит
    </Tag>
  );
}
