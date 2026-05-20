import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

/** Маршруты управления пользователями Supabase — только superadmin. */
export default function SupabaseSuperadminRoute() {
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.supabaseRole !== 'superadmin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
