import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import type { UserRole } from '../types';

interface Props {
  roles?: UserRole[];
}

export default function PrivateRoute({ roles }: Props) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role as UserRole)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
