import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function DefaultHomeRedirect() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.authSource === 'supabase' ? '/admin' : '/dashboard'} replace />;
}
