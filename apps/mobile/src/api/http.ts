import axios from 'axios';
import { apiUrl } from '../config/env';
import { clearSessionStorage, getToken } from '../storage/tokenStorage';

export const api = axios.create({
  baseURL: apiUrl,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.status === 401) {
      await clearSessionStorage();
    }
    return Promise.reject(error);
  }
);
