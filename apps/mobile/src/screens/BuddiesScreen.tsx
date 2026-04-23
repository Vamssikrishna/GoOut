import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { getMyGroups, leaveGroup } from '../api/services/buddies';
import type { BuddyGroup } from '../types/domain';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function BuddiesScreen() {
  const nav = useNavigation<Nav>();
  const [groups, setGroups] = useState<BuddyGroup[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const data = await getMyGroups();
      setGroups(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not load your groups.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Screen>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={groups}
        keyExtractor={(item) => item._id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={!refreshing ? <Text style={styles.empty}>No buddy groups yet.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>{item.activity || 'Group activity'}</Text>
            {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
            <Text style={styles.meta}>
              Members: {item.members?.length || 0}
            </Text>
            <View style={styles.row}>
              <Pressable
                style={styles.primary}
                onPress={() => nav.navigate('GroupChat', { groupId: item._id })}
              >
                <Text style={styles.primaryLabel}>Open Chat</Text>
              </Pressable>
              <Pressable
                style={styles.secondary}
                onPress={async () => {
                  await leaveGroup(item._id);
                  refresh();
                }}
              >
                <Text style={styles.secondaryLabel}>Leave</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: '#b91c1c', marginBottom: 8 },
  empty: { color: '#64748b' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 10,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  desc: { color: '#475569', marginTop: 4 },
  meta: { color: '#64748b', marginTop: 6 },
  row: { flexDirection: 'row', gap: 8, marginTop: 10 },
  primary: { backgroundColor: '#0f766e', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  primaryLabel: { color: '#fff', fontWeight: '700' },
  secondary: {
    borderColor: '#cbd5e1',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  secondaryLabel: { color: '#334155', fontWeight: '600' },
});
