import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-mizan-gris">Chargement…</div>;
  }

  if (!user) {
    return <Navigate to="/connexion" replace />;
  }

  return children;
}
