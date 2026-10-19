/**
 * OpenFood Rider App — DashboardScreen
 *
 * Implements PRD Sections 2, 5.3, 5.4 & 6:
 *  - Online/Offline toggle (starts/stops background GPS tracking + updates `rider_profiles`)
 *  - Available Delivery Requests feed (unassigned `READY_FOR_PICKUP` orders) with 1-tap Accept
 *  - Active Assigned Deliveries feed with `PICKED_UP` and `DELIVERED` transitions
 *  - Manual / Simulated GPS Broadcast button for testing live PostGIS updates in emulators
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { supabase } from '../lib/supabase';
import { LOCATION_TASK_NAME } from '../tasks/locationTask';

const RIDER_ACTIONS = {
  PICKED_UP: { label: 'Confirm Picked Up 📦', nextStatus: 'PICKED_UP' },
  DELIVERED: { label: 'Mark as Delivered 🎉', nextStatus: 'DELIVERED' },
};

const STATUS_NEXT = {
  READY_FOR_PICKUP: RIDER_ACTIONS.PICKED_UP,
  PICKED_UP:        RIDER_ACTIONS.DELIVERED,
};

function DeliveryCard({ order, currentRiderId, onAccept, onAdvance }) {
  const isUnassigned = !order.rider_id;
  const nextAction = !isUnassigned ? STATUS_NEXT[order.status] : null;
  const createdAt = new Date(order.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.card, isUnassigned && styles.cardAvailable]}>
      <View style={styles.cardHeader}>
        <Text style={styles.orderId}>#{order.id.slice(0, 8).toUpperCase()}</Text>
        <Text style={styles.orderTime}>{createdAt}</Text>
      </View>

      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: isUnassigned
                ? '#A855F7'
                : order.status === 'PICKED_UP'
                ? '#F97316'
                : '#3B82F6',
            },
          ]}
        />
        <Text style={styles.statusText}>
          {isUnassigned ? 'AVAILABLE FOR PICKUP' : order.status.replace(/_/g, ' ')}
        </Text>
      </View>

      <Text style={styles.restaurantName}>
        🍽️ {order.restaurants?.name || 'Restaurant'}
      </Text>
      <Text style={styles.deliveryAddress} numberOfLines={2}>
        📍 {order.delivery_address}
      </Text>
      <Text style={styles.orderAmount}>
        Earn:{' '}
        <Text style={styles.orderAmountValue}>
          GH₵ {(parseFloat(order.total_amount) * 0.15).toFixed(2)}
        </Text>
        {'  '}Order Total: GH₵ {parseFloat(order.total_amount).toFixed(2)}
      </Text>

      {isUnassigned && (
        <TouchableOpacity
          style={[styles.actionButton, styles.acceptButton]}
          onPress={() => onAccept(order, currentRiderId)}
          activeOpacity={0.85}
        >
          <Text style={styles.actionButtonText}>Accept Delivery Request 🛵</Text>
        </TouchableOpacity>
      )}

      {nextAction && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => onAdvance(order, nextAction.nextStatus)}
          activeOpacity={0.85}
        >
          <Text style={styles.actionButtonText}>{nextAction.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function DashboardScreen() {
  const [isOnline, setIsOnline] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [orders, setOrders] = useState([]);
  const [lastCoords, setLastCoords] = useState({ lat: 5.6037, lng: -0.187 });
  const [broadcasting, setBroadcasting] = useState(false);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef(null);

  // Seed rider ID (Yaw Boateng)
  const RIDER_ID = 'a1b2c3d4-0003-0003-0003-000000000003';

  // Fetch both orders assigned to this rider AND unassigned READY_FOR_PICKUP orders
  const fetchOrders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          status,
          rider_id,
          total_amount,
          delivery_address,
          created_at,
          restaurants ( id, name, address )
        `)
        .or(`rider_id.eq.${RIDER_ID},and(rider_id.is.null,status.eq.READY_FOR_PICKUP)`)
        .not('status', 'in', '("DELIVERED","CANCELLED")')
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      setOrders(data || []);
    } catch (err) {
      console.warn('[DashboardScreen] fetchOrders warning:', err.message);
    } finally {
      setLoading(false);
    }
  }, [RIDER_ID]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Subscribe to Realtime changes on `orders` (both new pickups and assigned deliveries)
  useEffect(() => {
    channelRef.current = supabase
      .channel(`rider-orders:${RIDER_ID}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [RIDER_ID, fetchOrders]);

  // Broadcast a single GPS coordinate update to `rider_profiles.current_location`
  const broadcastGpsStep = useCallback(async () => {
    setBroadcasting(true);
    try {
      // Move slightly toward Airport Residential Area (5.6150, -0.1760) on each tap
      const nextLat = lastCoords.lat + (5.615 - lastCoords.lat) * 0.25;
      const nextLng = lastCoords.lng + (-0.176 - lastCoords.lng) * 0.25;
      const coords = { lat: nextLat, lng: nextLng };
      setLastCoords(coords);

      await supabase
        .from('rider_profiles')
        .update({
          current_location: `SRID=4326;POINT(${coords.lng} ${coords.lat})`,
          last_location_update: new Date().toISOString(),
        })
        .eq('id', RIDER_ID);
    } catch (err) {
      Alert.alert('GPS Broadcast Error', err.message);
    } finally {
      setBroadcasting(false);
    }
  }, [RIDER_ID, lastCoords]);

  const handleToggleOnline = useCallback(
    async (value) => {
      setTogglingStatus(true);
      try {
        if (value) {
          const { status: foreground } = await Location.requestForegroundPermissionsAsync();
          if (foreground !== 'granted') {
            Alert.alert(
              'Permission Required',
              'Location permission is required to go online. Please grant it in your device settings.'
            );
            return;
          }

          await Location.requestBackgroundPermissionsAsync().catch(() => {});

          const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(
            () => false
          );
          if (isRegistered) {
            await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
              accuracy: Location.Accuracy.High,
              timeInterval: 5000,
              distanceInterval: 10,
              showsBackgroundLocationIndicator: true,
              foregroundService: {
                notificationTitle: 'OpenFood Rider',
                notificationBody: 'Tracking your location for active delivery.',
                notificationColor: '#FF6B35',
              },
            }).catch(() => {});
          }

          await supabase
            .from('rider_profiles')
            .update({
              is_online: true,
              is_available: true,
              current_location: `SRID=4326;POINT(${lastCoords.lng} ${lastCoords.lat})`,
              last_location_update: new Date().toISOString(),
            })
            .eq('id', RIDER_ID);

          setIsOnline(true);
        } else {
          const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(
            () => false
          );
          if (isRegistered) {
            const isRunning = await Location.hasStartedLocationUpdatesAsync(
              LOCATION_TASK_NAME
            ).catch(() => false);
            if (isRunning) {
              await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
            }
          }

          await supabase
            .from('rider_profiles')
            .update({ is_online: false, is_available: false })
            .eq('id', RIDER_ID);

          setIsOnline(false);
        }
      } catch (err) {
        Alert.alert('Error', 'Failed to update your status: ' + err.message);
      } finally {
        setTogglingStatus(false);
      }
    },
    [RIDER_ID, lastCoords]
  );

  // Claim an unassigned READY_FOR_PICKUP order
  const handleAccept = useCallback(async (order, riderId) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ rider_id: riderId })
        .eq('id', order.id)
        .is('rider_id', null);

      if (error) throw new Error(error.message);

      await supabase
        .from('rider_profiles')
        .update({ is_available: false })
        .eq('id', riderId);

      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, rider_id: riderId } : o))
      );
    } catch (err) {
      Alert.alert('Accept Failed', err.message);
    }
  }, []);

  // Advance order status (PICKED_UP -> DELIVERED) and free rider availability on DELIVERED
  const handleAdvance = useCallback(
    async (order, nextStatus) => {
      try {
        const { error } = await supabase
          .from('orders')
          .update({ status: nextStatus })
          .eq('id', order.id);

        if (error) throw new Error(error.message);

        if (nextStatus === 'DELIVERED') {
          await supabase
            .from('rider_profiles')
            .update({ is_available: true })
            .eq('id', RIDER_ID);
        }

        setOrders((prev) =>
          nextStatus === 'DELIVERED'
            ? prev.filter((o) => o.id !== order.id)
            : prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o))
        );
      } catch (err) {
        Alert.alert('Update Failed', err.message);
      }
    },
    [RIDER_ID]
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Online / Offline Toggle Card */}
      <View style={[styles.onlineToggleCard, isOnline ? styles.onlineCard : styles.offlineCard]}>
        <View style={styles.onlineInfo}>
          <View
            style={[
              styles.statusIndicator,
              { backgroundColor: isOnline ? '#22C55E' : '#9CA3AF' },
            ]}
          />
          <View>
            <Text style={styles.onlineStatus}>
              {isOnline ? 'You are Online' : 'You are Offline'}
            </Text>
            <Text style={styles.onlineSubtext}>
              {isOnline
                ? `GPS Active (${lastCoords.lat.toFixed(4)}, ${lastCoords.lng.toFixed(4)})`
                : 'Toggle to start accepting deliveries'}
            </Text>
          </View>
        </View>
        {togglingStatus ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Switch
            value={isOnline}
            onValueChange={handleToggleOnline}
            trackColor={{ false: '#374151', true: '#22C55E' }}
            thumbColor="#FFF"
            ios_backgroundColor="#374151"
          />
        )}
      </View>

      {/* Manual GPS Broadcast Bar (for emulator / web testing) */}
      {isOnline && (
        <View style={styles.gpsBar}>
          <Text style={styles.gpsBarText}>
            📡 Broadcast PostGIS location to Customer Map:
          </Text>
          <TouchableOpacity
            style={styles.gpsStepButton}
            onPress={broadcastGpsStep}
            disabled={broadcasting}
          >
            <Text style={styles.gpsStepButtonText}>
              {broadcasting ? 'Sending…' : 'Step Rider GPS →'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Delivery Feed */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0F172A" />
          <Text style={styles.loadingText}>Loading your deliveries…</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DeliveryCard
              order={item}
              currentRiderId={RIDER_ID}
              onAccept={handleAccept}
              onAdvance={handleAdvance}
            />
          )}
          ListHeaderComponent={
            <Text style={styles.sectionTitle}>
              Deliveries & Pickup Requests {orders.length > 0 ? `(${orders.length})` : ''}
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyEmoji}>{isOnline ? '⏳' : '😴'}</Text>
              <Text style={styles.emptyText}>
                {isOnline
                  ? 'No deliveries assigned yet. Hang tight!'
                  : 'Go online to start receiving delivery requests.'}
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  onlineToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 14,
    padding: 18,
  },
  onlineCard: {
    backgroundColor: '#0F172A',
  },
  offlineCard: {
    backgroundColor: '#374151',
  },
  onlineInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  onlineStatus: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  onlineSubtext: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  gpsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E0F2FE',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  gpsBarText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0369A1',
    flex: 1,
  },
  gpsStepButton: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  gpsStepButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 12,
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  cardAvailable: {
    borderWidth: 2,
    borderColor: '#A855F7',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  orderId: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  orderTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  restaurantName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  deliveryAddress: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },
  orderAmount: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
  },
  orderAmountValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#22C55E',
  },
  actionButton: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: '#7E22CE',
  },
  actionButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 14,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
