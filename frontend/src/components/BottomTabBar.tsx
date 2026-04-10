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
          gap: 'var(--space-2)',
          minHeight: MOBILE_TAB_BAR_BASE_PX,
          maxWidth: 560,
          margin: '0 auto',
          paddingLeft: 'calc(var(--space-3) + env(safe-area-inset-left, 0px))',
          paddingRight: 'calc(var(--space-3) + env(safe-area-inset-right, 0px))',
          boxSizing: 'border-box',
        }}
      >
        {items.map((tab) => {
          const isActive = activePath === tab.path;
          const inactiveColor = token.colorTextSecondary;
          const activeColor = token.colorPrimary;
          const fg = isActive ? activeColor : inactiveColor;
          const Icon = tab.Icon;
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => navigate(tab.path)}
              aria-current={isActive ? 'page' : undefined}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                minHeight: 44,
                padding: 'var(--space-1)',
                border: 'none',
                background: 'transparent',
                color: fg,
                cursor: 'pointer',
                fontSize: 11,
                lineHeight: 1.35,
                fontWeight: 500,
                WebkitTapHighlightColor: 'transparent',
                minWidth: 0,
                maxWidth: 'none',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: isActive ? 'scale(1.08)' : 'scale(1)',
                  transformOrigin: 'center center',
                  transition: 'transform 0.15s ease',
                }}
              >
                <Icon style={{ fontSize: 22, color: fg }} />
              </span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
