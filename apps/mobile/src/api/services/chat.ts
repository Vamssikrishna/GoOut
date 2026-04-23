import { api } from '../http';
import type { ChatMessage } from '../../types/domain';

export async function getGroup(groupId: string) {
  const { data } = await api.get(`/buddies/groups/${groupId}`);
  return data;
}

export async function getGroupMessages(groupId: string) {
  const { data } = await api.get<ChatMessage[]>(`/chat/${groupId}`);
  return Array.isArray(data) ? data : [];
}

export async function uploadGroupFile(groupId: string, file: {
  uri: string;
  name: string;
  type: string;
}) {
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as unknown as Blob);

  const { data } = await api.post(`/chat/${groupId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
