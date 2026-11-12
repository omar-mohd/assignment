import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
    const onUnauthorized = () => setUser(null);
    window.addEventListener('ajaia:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ajaia:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.login(email, password);
    setUser(r.user);
  }, []);
  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}
