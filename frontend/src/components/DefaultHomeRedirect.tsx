import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { homePathForUser } from '../lib/authUser';

export default function DefaultHomeRedirect() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homePathForUser(user)} replace />;
}
