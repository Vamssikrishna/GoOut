import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { AuthUser } from '../types/domain';
import { fetchMe, login as apiLogin, register as apiRegister, verifyLoginOtp as apiVerifyLoginOtp } from '../api/services/auth';
import { clearSessionStorage, getCachedUser, getToken, setCachedUser, setToken } from '../storage/tokenStorage';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<unknown>;
  verifyLoginOtp: (email: string, otp: string) => Promise<unknown>;
  register: (name: string, email: string, password: string, role: string) => Promise<unknown>;
  refreshUser: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const normalizeUser = (user: AuthUser | null): AuthUser | null => {
  if (!user) return null;
  return { ...user, id: user.id || user._id };
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrateSession = useCallback(async () => {
    const cached = normalizeUser(await getCachedUser());
    if (cached) {
      setUser(cached);
    }
    const token = await getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const me = normalizeUser(await fetchMe());
      setUser(me);
      await setCachedUser(me);
    } catch {
      await clearSessionStorage();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hydrateSession();
  }, [hydrateSession]);

  const applyAuthResult = useCallback(async (data: any) => {
    if (!data?.token) return data;
    await setToken(data.token);
    try {
      const me = normalizeUser(await fetchMe());
      setUser(me);
      await setCachedUser(me);
    } catch {
      const fallback = normalizeUser(data.user ?? null);
      setUser(fallback);
      await setCachedUser(fallback);
    }
    return data;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    if ((data as any)?.requiresOtp) return data;
    return applyAuthResult(data);
  }, [applyAuthResult]);

  const verifyLoginOtp = useCallback(async (email: string, otp: string) => {
    const data = await apiVerifyLoginOtp(email, otp);
    return applyAuthResult(data);
  }, [applyAuthResult]);

  const register = useCallback(async (name: string, email: string, password: string, role: string) => {
    const data = await apiRegister(name, email, password, role);
    return applyAuthResult(data);
  }, [applyAuthResult]);

  const refreshUser = useCallback(async () => {
    const token = await getToken();
    if (!token) return null;
    try {
      const me = normalizeUser(await fetchMe());
      setUser(me);
      await setCachedUser(me);
      return me;
    } catch {
      return null;
    }
  }, []);

  const logout = useCallback(async () => {
    await clearSessionStorage();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    login,
    verifyLoginOtp,
    register,
    refreshUser,
    logout,
  }), [user, loading, login, verifyLoginOtp, register, refreshUser, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
