import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { APP_BUTTON } from './ui/AppClassNames';

interface Props {
  fallback?: string;
}

type BackNavigationState = {
  from?: string;
};

export default function BackButton({ fallback }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleClick = () => {
    const returnTo = (location.state as BackNavigationState | null)?.from;
    if (window.history.length > 2) {
      navigate(-1);
      return;
    }
    if (returnTo) {
      navigate(returnTo);
      return;
    }
    navigate(fallback || '/dashboard');
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
