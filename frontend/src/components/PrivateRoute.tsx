import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import type { Permission, UserRole } from '../types';

interface Props {
  roles?: UserRole[];
  /** SUPER_ADMIN всегда проходит; остальные — только если право есть в массиве permissions. */
  permission?: Permission;
  /** Скрыть маршрут для Supabase admin (user_metadata.role === 'admin') */
  hideForSupabaseAdmin?: boolean;
}

export default function PrivateRoute({ roles, permission, hideForSupabaseAdmin }: Props) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (hideForSupabaseAdmin && user.supabaseRole === 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role as UserRole)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (permission) {
    const role = user.role as UserRole;
    const has =
      role === 'SUPER_ADMIN'
      || role === 'ADMIN'
      || (user.permissions ?? []).includes(permission);
    if (!has) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <Outlet />;
}
