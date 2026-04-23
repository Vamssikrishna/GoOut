import { api } from '../http';
import type { BuddyGroup } from '../../types/domain';

export async function getMyGroups() {
  const { data } = await api.get<BuddyGroup[]>('/buddies/groups');
  return Array.isArray(data) ? data : [];
}

export async function joinGroup(groupId: string) {
  await api.post(`/buddies/groups/${groupId}/join`);
}

export async function leaveGroup(groupId: string) {
  await api.post(`/buddies/groups/${groupId}/leave`);
}
