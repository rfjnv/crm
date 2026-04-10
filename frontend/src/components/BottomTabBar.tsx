import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { getMobileBottomNavItems, resolveActiveMobileNavPath } from '../config/mobileBottomNav';
import type { UserRole, Permission } from '../types';
import './BottomTabBar.css';

export default function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
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
    <nav className="bottom-tab-bar" aria-label="Основная навигация">
      <div className="tab-container">
        {items.map((tab) => {
          const isActive = activePath === tab.path;
          const Icon = tab.Icon;
          return (
            <button
              key={tab.path}
              type="button"
              className={`tab-item${isActive ? ' active' : ''}`}
              onClick={() => navigate(tab.path)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.label}
            >
              <span className="tab-item__icon" aria-hidden>
                <Icon style={{ fontSize: 22, color: 'inherit' }} />
              </span>
              {isActive && <span className="tab-item__label">{tab.label}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
