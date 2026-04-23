import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { Screen } from '../components/Screen';
import { getGroup, getGroupMessages } from '../api/services/chat';
import { getToken } from '../storage/tokenStorage';
import { env } from '../config/env';
import type { ChatMessage } from '../types/domain';

interface Props {
  route: { params: { groupId: string } };
}

export function GroupChatScreen({ route }: Props) {
  const { groupId } = route.params;
  const [group, setGroup] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const socketRef = useRef<Socket | null>(null);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => Number(new Date(a.createdAt || 0)) - Number(new Date(b.createdAt || 0))),
    [messages]
  );

  useEffect(() => {
    getGroup(groupId).then(setGroup).catch(() => null);
    getGroupMessages(groupId).then(setMessages).catch(() => null);
  }, [groupId]);

  useEffect(() => {
    let disconnected = false;
    (async () => {
      const token = await getToken();
      if (!token || disconnected) return;
      const socket = io(env.socketUrl, { auth: { token } });
      socketRef.current = socket;
      socket.on('connect', () => socket.emit('join-group', groupId));
      socket.on('new-message', (msg) => setMessages((prev) => [...prev, msg]));
    })();
    return () => {
      disconnected = true;
      socketRef.current?.emit('leave-group', groupId);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [groupId]);

  return (
    <Screen>
      <Text style={styles.title}>{group?.activity || 'Group Chat'}</Text>
      <FlatList
        data={sortedMessages}
        keyExtractor={(item, index) => String(item._id || index)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.message}>
            <Text style={styles.sender}>{item.userName || 'User'}</Text>
            <Text style={styles.body}>{item.message || ''}</Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message"
        />
        <Pressable
          style={styles.send}
          onPress={() => {
            const message = input.trim();
            if (!message || !socketRef.current) return;
            socketRef.current.emit('chat-message', { groupId, message });
            setInput('');
          }}
        >
          <Text style={styles.sendLabel}>Send</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: '#0f172a' },
  message: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  sender: { fontWeight: '700', color: '#0f172a', marginBottom: 2 },
  body: { color: '#334155' },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  send: { backgroundColor: '#0f766e', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  sendLabel: { color: '#fff', fontWeight: '700' },
});
