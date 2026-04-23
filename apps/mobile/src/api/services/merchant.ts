import { api } from '../http';

export async function getMyBusinesses() {
  const { data } = await api.get('/businesses/mine');
  return Array.isArray(data) ? data : [];
}

export async function updateBusiness(businessId: string, payload: Record<string, unknown>) {
  const { data } = await api.put(`/businesses/${businessId}`, payload);
  return data;
}

export async function createOffer(payload: Record<string, unknown>) {
  const { data } = await api.post('/offers', payload);
  return data;
}
