import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function DefaultHomeRedirect() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  const siteAdmin = user.authSource === 'supabase' || user.role === 'SITE_ADMIN';
  return <Navigate to={siteAdmin ? '/admin' : '/dashboard'} replace />;
}
