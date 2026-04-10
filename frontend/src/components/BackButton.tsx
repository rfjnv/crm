import { useNavigate } from 'react-router-dom';
import { Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { APP_BUTTON } from './ui/AppClassNames';

interface Props {
  fallback?: string;
}

export default function BackButton({ fallback }: Props) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate(fallback || '/dashboard');
    }
  };

  return (
    <Button
      type="text"
      className={APP_BUTTON}
      icon={<ArrowLeftOutlined />}
      onClick={handleClick}
      style={{ padding: '4px 8px', marginRight: 8 }}
    >
      Назад
    </Button>
  );
}
