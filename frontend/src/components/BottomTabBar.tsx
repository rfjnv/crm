import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { theme } from 'antd';
import { useAuthStore } from '../store/authStore';
import {
  getMobileBottomNavItems,
  resolveActiveMobileNavPath,
  MOBILE_TAB_BAR_BASE_PX,
} from '../config/mobileBottomNav';
import type { UserRole, Permission } from '../types';

export default function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);

  const items = useMemo(() => {
    if (!user?.role) return [];
    const role = user.role as UserRole;
    const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
    const hasPermission = (p: Permission) =>
      isAdmin || (user.permissions ?? []).includes(p);
    return getMobileBottomNavItems({ role, isAdmin, hasPermission });
  }, [user]);

  const activePath = resolveActiveMobileNavPath(location.pathname, items);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Основная навигация"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        background: token.colorBgContainer,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: token.boxShadowSecondary,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'stretch',
          minHeight: MOBILE_TAB_BAR_BASE_PX,
          maxWidth: 560,
          margin: '0 auto',
        }}
      >
        {items.map((tab) => {
          const isActive = activePath === tab.path;
          const color = isActive ? token.colorPrimary : token.colorTextSecondary;
          const Icon = tab.Icon;
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => navigate(tab.path)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                minHeight: MOBILE_TAB_BAR_BASE_PX,
                padding: '6px 4px',
                border: 'none',
                background: isActive ? token.colorPrimaryBg : 'transparent',
                color,
                cursor: 'pointer',
                fontSize: 10,
                lineHeight: 1.15,
                WebkitTapHighlightColor: 'transparent',
                borderRadius: isActive ? 8 : 0,
                margin: '4px 2px',
                maxWidth: 88,
              }}
            >
              <Icon style={{ fontSize: 22 }} />
              <span style={{ fontWeight: isActive ? 600 : 400 }}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
