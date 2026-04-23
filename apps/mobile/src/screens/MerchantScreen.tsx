import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { createOffer, getMyBusinesses, updateBusiness } from '../api/services/merchant';

export function MerchantScreen() {
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [offerTitle, setOfferTitle] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [loading, setLoading] = useState(false);

  const selected = useMemo(
    () => businesses.find((b) => String(b._id) === String(selectedBusinessId)),
    [businesses, selectedBusinessId]
  );

  const loadBusinesses = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getMyBusinesses();
      setBusinesses(rows);
      if (rows.length > 0) {
        const first = rows[0];
        setSelectedBusinessId(String(first._id));
        setName(first.name || '');
        setDescription(first.description || '');
      }
    } catch (err: any) {
      Alert.alert('Could not load merchant data', err?.response?.data?.error || 'Try again later.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBusinesses();
  }, [loadBusinesses]);

  useEffect(() => {
    if (!selected) return;
    setName(selected.name || '');
    setDescription(selected.description || '');
  }, [selected]);

  if (!loading && businesses.length === 0) {
    return (
      <Screen>
        <Text style={styles.empty}>No business linked yet. Register a business on web dashboard first.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>Merchant dashboard</Text>
        {selected ? (
          <View style={styles.card}>
            <Text style={styles.label}>Business name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} />
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              multiline
            />
            <Pressable
              style={styles.primary}
              onPress={async () => {
                await updateBusiness(String(selected._id), { name, description });
                Alert.alert('Saved', 'Business profile updated.');
                loadBusinesses();
              }}
            >
              <Text style={styles.primaryLabel}>Save profile</Text>
            </Pressable>
          </View>
        ) : null}

        {selected ? (
          <View style={styles.card}>
            <Text style={styles.offerHeader}>Create Flash Deal</Text>
            <TextInput style={styles.input} placeholder="Offer title" value={offerTitle} onChangeText={setOfferTitle} />
            <TextInput
              style={styles.input}
              placeholder="Offer price (INR)"
              keyboardType="numeric"
              value={offerPrice}
              onChangeText={setOfferPrice}
            />
            <Pressable
              style={styles.primary}
              onPress={async () => {
                await createOffer({
                  businessId: selected._id,
                  title: offerTitle,
                  offerPrice: Number(offerPrice),
                  durationMinutes: 30,
                });
                setOfferTitle('');
                setOfferPrice('');
                Alert.alert('Created', 'Flash deal created.');
              }}
            >
              <Text style={styles.primaryLabel}>Create offer</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 24, gap: 12 },
  header: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  card: {
    backgroundColor: '#fff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  label: { color: '#334155', fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  primary: { backgroundColor: '#0f766e', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  primaryLabel: { color: '#fff', fontWeight: '700' },
  offerHeader: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  empty: { color: '#334155' },
});
