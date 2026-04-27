import axios from 'axios';

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '/api').trim();

export function getApiOrigin() {
  const fallbackOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  try {
    if (/^https?:\/\//i.test(apiBaseUrl)) {
      return new URL(apiBaseUrl).origin;
    }
    return fallbackOrigin;
  } catch {
    return fallbackOrigin;
  }
}

export function getAssetUrl(pathLike) {
  const raw = String(pathLike || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  if (raw.startsWith('/uploads/')) return `${getApiOrigin()}${raw}`;
  if (raw.startsWith('/')) return raw;
  return raw;
}

const api = axios.create({
  baseURL: apiBaseUrl || '/api',
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('goout_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('goout_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;