/**
 * OpenFood Customer App — HomeScreen
 *
 * Displays a searchable feed of active restaurants fetched from Supabase
 * (with automatic fallback to seed restaurants for instant demo mode).
 * Tapping a restaurant navigates to MenuScreen.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  SafeAreaView,
  TextInput,
} from 'react-native';
import { supabase } from '../lib/supabase';

const FALLBACK_RESTAURANTS = [
  {
    id: 'b1b2c3d4-0001-0001-0001-000000000001',
    name: 'Mama Akua Kitchen',
    address: '14 Cantonments Road, Osu, Accra, Ghana',
    is_active: true,
    lat: 5.6037,
    lng: -0.187,
  },
  {
    id: 'b1b2c3d4-0002-0002-0002-000000000002',
    name: 'Chop Bar Deluxe',
    address: '7 Labone Close, Labone, Accra, Ghana',
    is_active: true,
    lat: 5.59,
    lng: -0.173,
  },
];

function RestaurantCard({ restaurant, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(restaurant)} activeOpacity={0.85}>
      <View style={styles.imagePlaceholder}>
        <Text style={styles.imagePlaceholderText}>🍽️</Text>
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.restaurantName}>{restaurant.name}</Text>
        <Text style={styles.restaurantAddress} numberOfLines={1}>
          📍 {restaurant.address}
        </Text>
        <View style={styles.cardFooterRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>● Open Now</Text>
          </View>
          {typeof restaurant.distance_meters === 'number' && (
            <Text style={styles.distanceText}>
              {(restaurant.distance_meters / 1000).toFixed(1)} km away
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation }) {
  const [restaurants, setRestaurants] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRestaurants = useCallback(async () => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('restaurants')
        .select('id, name, address, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (!supabaseError && data && data.length > 0) {
        setRestaurants(data);
      } else {
        setRestaurants(FALLBACK_RESTAURANTS);
      }
    } catch {
      setRestaurants(FALLBACK_RESTAURANTS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRestaurants();
  }, [fetchRestaurants]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRestaurants();
  }, [fetchRestaurants]);

  const handleRestaurantPress = useCallback(
    (restaurant) => {
      navigation.navigate('Menu', { restaurant });
    },
    [navigation]
  );

  const filteredRestaurants = restaurants.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FF6B35" />
        <Text style={styles.loadingText}>Finding restaurants near you…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={filteredRestaurants}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RestaurantCard restaurant={item} onPress={handleRestaurantPress} />
        )}
        ListHeaderComponent={
          <View>
            <TextInput
              style={styles.searchInput}
              placeholder="🔍 Search restaurants (e.g. Mama Akua)…"
              placeholderTextColor="#9CA3AF"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <Text style={styles.sectionTitle}>Restaurants Near You</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No restaurants match your search. 😔</Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
        }
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#1A1A2E',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 14,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  imagePlaceholder: {
    height: 120,
    backgroundColor: '#FFF0EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    fontSize: 48,
  },
  cardContent: {
    padding: 14,
  },
  restaurantName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  restaurantAddress: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#D1FAE5',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF6B35',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  emptyText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
});
