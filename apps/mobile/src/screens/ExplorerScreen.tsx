import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { getLiveOffers, getNearbyBusinesses } from '../api/services/explorer';
import type { Business } from '../types/domain';

const FALLBACK_LAT = 28.6139;
const FALLBACK_LNG = 77.209;

export function ExplorerScreen() {
  const [query, setQuery] = useState('');
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const search = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [nextBusinesses, nextOffers] = await Promise.all([
        getNearbyBusinesses({ lat: FALLBACK_LAT, lng: FALLBACK_LNG, q: query.trim() }),
        getLiveOffers(FALLBACK_LAT, FALLBACK_LNG),
      ]);
      setBusinesses(nextBusinesses);
      setOffers(nextOffers);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not load nearby places.');
    } finally {
      setBusy(false);
    }
  }, [query]);

  return (
    <Screen>
      <View style={styles.row}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search: cafe, park, pottery..."
        />
        <Pressable style={styles.searchBtn} onPress={search} disabled={busy}>
          <Text style={styles.searchBtnLabel}>{busy ? '...' : 'Apply'}</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {offers.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Flash Deals</Text>
          {offers.slice(0, 3).map((offer) => (
            <Text key={offer._id} style={styles.offerLine}>
              {offer.title} - INR {offer.offerPrice}
            </Text>
          ))}
        </View>
      )}

      <FlatList
        data={businesses}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={<Text style={styles.sectionTitle}>Nearby places</Text>}
        ListEmptyComponent={!busy ? <Text style={styles.empty}>No places yet. Try a different query.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{item.category || 'Uncategorized'}</Text>
            {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 24 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchBtn: {
    backgroundColor: '#0f766e',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  searchBtnLabel: { color: '#fff', fontWeight: '700' },
  error: { color: '#b91c1c', marginBottom: 8 },
  section: { marginBottom: 12, backgroundColor: '#ecfeff', padding: 10, borderRadius: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6, color: '#0f172a' },
  offerLine: { color: '#0f172a', marginBottom: 3 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 8,
  },
  name: { fontWeight: '700', color: '#0f172a' },
  meta: { color: '#334155', marginTop: 2 },
  desc: { color: '#475569', marginTop: 4 },
  empty: { color: '#64748b' },
});
