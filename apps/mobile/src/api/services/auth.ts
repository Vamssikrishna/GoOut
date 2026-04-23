import { api } from '../http';
import type { AuthResponse, AuthUser } from '../../types/domain';

export async function login(email: string, password: string) {
  const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
  return data;
}

export async function verifyLoginOtp(email: string, otp: string) {
  const { data } = await api.post<AuthResponse>('/auth/verify-login-otp', { email, otp });
  return data;
}

export async function register(name: string, email: string, password: string, role: string) {
  const { data } = await api.post<AuthResponse>('/auth/register', { name, email, password, role });
  return data;
}

export async function fetchMe() {
  const { data } = await api.get<AuthUser>('/auth/me');
  return data;
}
