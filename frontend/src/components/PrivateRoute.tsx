import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import type { Permission, UserRole } from '../types';

interface Props {
  roles?: UserRole[];
  permission?: Permission;
  /** Только вход по email — админ-панель */
  supabaseAuthOnly?: boolean;
  /** Сотрудники CRM — без доступа к полному CRM для email-аккаунтов */
  crmStaffOnly?: boolean;
}

function homePath(authSource?: string) {
  return authSource === 'supabase' ? '/admin' : '/dashboard';
}

export default function PrivateRoute({ roles, permission, supabaseAuthOnly, crmStaffOnly }: Props) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const home = homePath(user?.authSource);

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (supabaseAuthOnly && user.authSource !== 'supabase') {
    return <Navigate to={home} replace />;
  }

  if (crmStaffOnly && user.authSource === 'supabase') {
    return <Navigate to="/admin" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role as UserRole)) {
    return <Navigate to={home} replace />;
  }

  if (permission) {
    const role = user.role as UserRole;
    const has =
      role === 'SUPER_ADMIN'
      || role === 'ADMIN'
      || (user.permissions ?? []).includes(permission);
    if (!has) {
      return <Navigate to={home} replace />;
    }
  }

  return <Outlet />;
}
