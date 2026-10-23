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
    // key 'default' — страницу открыли напрямую (новая вкладка, ссылка): позади нет страницы CRM.
    // Раньше смотрели на window.history.length, и из вкладки, открытой сразу на аналитике,
    // «Назад» выкидывал в общий список клиентов.
    if (location.key !== 'default') {
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
