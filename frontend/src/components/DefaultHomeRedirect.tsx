import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { isSiteAdminUser } from '../lib/authUser';

export default function DefaultHomeRedirect() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={isSiteAdminUser(user) ? '/admin' : '/dashboard'} replace />;
}
