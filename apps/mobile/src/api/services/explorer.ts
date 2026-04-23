import { api } from '../http';
import type { Business } from '../../types/domain';

interface NearbyParams {
  lat: number;
  lng: number;
  q?: string;
  city?: string;
}

export async function getNearbyBusinesses(params: NearbyParams) {
  const { data } = await api.get<Business[]>('/businesses/nearby', { params });
  return Array.isArray(data) ? data : [];
}

export async function getLiveOffers(lat: number, lng: number, city?: string) {
  const { data } = await api.get('/offers/live', { params: { lat, lng, city } });
  return Array.isArray(data) ? data : [];
}
