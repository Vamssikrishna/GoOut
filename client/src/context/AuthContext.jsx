import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);
const USER_CACHE_KEY = 'goout_user';

async function applySessionFromToken(data) {
  localStorage.setItem('goout_token', data.token);
  try {
    const me = await api.get('/auth/me');
    const nextUser = { ...me.data, id: me.data._id || me.data.id };
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(nextUser));
    return nextUser;
  } catch {
    const nextUser = { ...data.user, id: data.user.id || data.user._id };
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(nextUser));
    return nextUser;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('goout_token');
    const cachedUserRaw = localStorage.getItem(USER_CACHE_KEY);
    if (cachedUserRaw) {
      try {
        const cachedUser = JSON.parse(cachedUserRaw);
        if (cachedUser && (cachedUser.id || cachedUser._id)) {
          setUser({ ...cachedUser, id: cachedUser.id || cachedUser._id });
        }
      } catch {

      }
    }
    if (!token) {
      setLoading(false);
      return;
    }
    api.get('/auth/me').
    then(({ data }) => {
      const nextUser = { ...data, id: data._id || data.id };
      setUser(nextUser);
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(nextUser));
    }).
    catch((err) => {
      if (err?.response?.status === 401) {
        localStorage.removeItem('goout_token');
        localStorage.removeItem(USER_CACHE_KEY);
        setUser(null);
      }
    }).
    finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.requiresOtp) {
      return { requiresOtp: true, email: data.email, message: data.message };
    }
    const nextUser = await applySessionFromToken(data);
    setUser(nextUser);
    return data;
  };

  const verifyLoginOtp = async (email, otp) => {
    const { data } = await api.post('/auth/verify-login-otp', { email, otp });
    const nextUser = await applySessionFromToken(data);
    setUser(nextUser);
    return data;
  };

  const register = async (name, email, password, role) => {
    const { data } = await api.post('/auth/register', { name, email, password, role });
    const nextUser = await applySessionFromToken(data);
    setUser(nextUser);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('goout_token');
    localStorage.removeItem(USER_CACHE_KEY);
    setUser(null);
  };

  const updateUser = (data) =>
  setUser((u) => {
    if (!u) return null;
    const nextUser = { ...u, ...data };
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(nextUser));
    return nextUser;
  });

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyLoginOtp, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>);

}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}