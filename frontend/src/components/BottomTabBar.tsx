import { useLocation, useNavigate } from 'react-router-dom';
import { theme } from 'antd';
import {
  DashboardOutlined,
  FundProjectionScreenOutlined,
  TeamOutlined,
  ShopOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';

const TABS = [
  { key: '/dashboard', icon: DashboardOutlined, label: 'Главная' },
  { key: '/deals', icon: FundProjectionScreenOutlined, label: 'Сделки' },
  { key: '/clients', icon: TeamOutlined, label: 'Клиенты' },
  { key: '/inventory/warehouse', icon: ShopOutlined, label: 'Склад' },
  { key: '/inventory/movements', icon: SwapOutlined, label: 'Движение' },
];

export default function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const role = useAuthStore((s) => s.user?.role);

  const tabs = TABS.map((tab) =>
    tab.key === '/deals' && role === 'MANAGER'
      ? { ...tab, label: 'Заявки' }
      : tab,
  );

  const activeKey = tabs.find(t => location.pathname.startsWith(t.key))?.key;

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: 56,
      background: token.colorBgContainer,
      borderTop: `1px solid ${token.colorBorderSecondary}`,
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      zIndex: 1000,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {tabs.map(tab => {
        const isActive = activeKey === tab.key;
        const color = isActive ? token.colorPrimary : token.colorTextSecondary;
        const Icon = tab.icon;
        return (
          <div
            key={tab.key}
            onClick={() => navigate(tab.key)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color,
              fontSize: 10,
              gap: 2,
              height: '100%',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <Icon style={{ fontSize: 20 }} />
            <span>{tab.label}</span>
          </div>
        );
      })}
    </div>
  );
}
