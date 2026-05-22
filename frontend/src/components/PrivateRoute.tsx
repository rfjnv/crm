import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { isSiteAdminUser } from '../lib/authUser';
import type { Permission, UserRole } from '../types';

interface Props {
  roles?: UserRole[];
  permission?: Permission;
  /** Только вход по email — админ-панель */
  supabaseAuthOnly?: boolean;
  /** Сотрудники CRM — без доступа к полному CRM для email-аккаунтов */
  crmStaffOnly?: boolean;
}

function homePath(user?: { authSource?: string; role?: string }) {
  return user && isSiteAdminUser(user) ? '/admin' : '/dashboard';
}

export default function PrivateRoute({ roles, permission, supabaseAuthOnly, crmStaffOnly }: Props) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const home = homePath(user ?? undefined);

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (supabaseAuthOnly && !isSiteAdminUser(user)) {
    return <Navigate to={home} replace />;
  }

  if (crmStaffOnly && isSiteAdminUser(user)) {
    return <Navigate to="/admin" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role as UserRole)) {
    return <Navigate to={home} replace />;
  }

  if (permission) {
    const role = user.role as UserRole;
    const has =
      role === 'SUPER_ADMIN'
      || (role === 'ADMIN' && !isSiteAdminUser(user))
      || (user.permissions ?? []).includes(permission);
    if (!has) {
      return <Navigate to={home} replace />;
    }
  }

  return <Outlet />;
}
