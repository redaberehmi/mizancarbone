import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/auth/me');
      setUser(data.user);
      setCompany(data.company);
    } catch {
      setUser(null);
      setCompany(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const register = async (payload) => {
    const data = await api.post('/auth/register', payload);
    setUser(data.user);
    setCompany(data.company);
    return data;
  };

  const login = async (payload) => {
    const data = await api.post('/auth/login', payload);
    await refresh();
    return data;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
    setCompany(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, company, loading, register, login, logout, refresh, setCompany }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider.');
  return ctx;
}
