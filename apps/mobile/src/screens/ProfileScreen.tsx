import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/http';

export function ProfileScreen() {
  const { user, refreshUser, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [interests, setInterests] = useState('');

  return (
    <Screen>
      <View style={styles.card}>
        <Text style={styles.heading}>Your Profile</Text>
        <Text style={styles.meta}>Role: {user?.role || 'explorer'}</Text>
        <Text style={styles.meta}>Email: {user?.email || 'N/A'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Display name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} />
        <Text style={styles.label}>Emergency contact</Text>
        <TextInput style={styles.input} value={emergencyContact} onChangeText={setEmergencyContact} />
        <Text style={styles.label}>Interests (comma-separated)</Text>
        <TextInput style={styles.input} value={interests} onChangeText={setInterests} />
        <Pressable
          style={styles.primary}
          onPress={async () => {
            await api.put('/users/profile', {
              name: name.trim(),
              emergencyContact: emergencyContact.trim(),
              interests: interests.split(',').map((x) => x.trim()).filter(Boolean),
            });
            await refreshUser();
            Alert.alert('Saved', 'Profile updated.');
          }}
        >
          <Text style={styles.primaryLabel}>Save profile</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.logout}
        onPress={async () => {
          await logout();
        }}
      >
        <Text style={styles.logoutLabel}>Log out</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  heading: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  meta: { color: '#475569' },
  label: { color: '#334155', fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  primary: { backgroundColor: '#0f766e', borderRadius: 8, alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  primaryLabel: { color: '#fff', fontWeight: '700' },
  logout: {
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 10,
  },
  logoutLabel: { color: '#b91c1c', fontWeight: '700' },
});
