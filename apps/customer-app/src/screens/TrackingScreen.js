/**
 * OpenFood Customer App — TrackingScreen
 *
 * Renders an OpenStreetMap (OSM) live delivery tracking view:
 *   - Uses free OpenStreetMap tiles via <UrlTile> (no API key or credit card required)
 *   - Parses PostGIS GEOMETRY(Point, 4326) (WKT, EWKT, GeoJSON, and Hex EWKB)
 *   - Subscribes to Supabase Realtime for both order status changes and rider GPS updates
 *   - Includes a live simulation toggle for testing end-to-end movement in emulators
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
} from 'react-native';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import { supabase } from '../lib/supabase';
import { parsePostGISPoint, calculateDistanceKm } from '../utils/postgis';

const STATUS_STEPS = [
  { key: 'PENDING',          label: 'Order Placed',      emoji: '📋' },
  { key: 'ACCEPTED',         label: 'Accepted',          emoji: '✅' },
  { key: 'PREPARING',        label: 'Preparing',         emoji: '👨‍🍳' },
  { key: 'READY_FOR_PICKUP', label: 'Ready for Pickup',  emoji: '📦' },
  { key: 'PICKED_UP',        label: 'On the Way',        emoji: '🛵' },
  { key: 'DELIVERED',        label: 'Delivered',         emoji: '🎉' },
];

export default function TrackingScreen({ route, navigation }) {
  const {
    orderId = 'd1b2c3d4-0001-0001-0001-000000000001',
    riderId: initialRiderId = null,
    restaurantLocation = { lat: 5.6037, lng: -0.187 },
    deliveryLocation = { lat: 5.615, lng: -0.176 },
    restaurantName = 'Mama Akua Kitchen',
  } = route.params || {};

  const [orderStatus, setOrderStatus] = useState('PENDING');
  const [activeRiderId, setActiveRiderId] = useState(initialRiderId);
  const [riderLocation, setRiderLocation] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for the rider marker
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.25, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 600, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Helper to update rider location and smoothly pan camera
  const applyRiderCoordinates = useCallback((coords) => {
    if (!coords) return;
    setRiderLocation(coords);
    if (mapRef.current) {
      mapRef.current.animateCamera(
        {
          center: { latitude: coords.lat, longitude: coords.lng },
        },
        { duration: 800 }
      );
    }
  }, []);

  // Fetch initial order & rider status, then subscribe to order updates
  useEffect(() => {
    let isMounted = true;

    async function initialFetch() {
      try {
        const { data: order } = await supabase
          .from('orders')
          .select('status, rider_id')
          .eq('id', orderId)
          .single();

        if (isMounted && order) {
          setOrderStatus(order.status);
          if (order.rider_id) {
            setActiveRiderId(order.rider_id);
          }
        }
      } catch (err) {
        console.warn('[TrackingScreen] Initial order fetch warning:', err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    initialFetch();

    const orderSubscription = supabase
      .channel(`order:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          if (payload.new?.status) {
            setOrderStatus(payload.new.status);
          }
          if (payload.new?.rider_id) {
            setActiveRiderId(payload.new.rider_id);
          }
          if (payload.new?.status === 'DELIVERED') {
            setTimeout(() => navigation.goBack(), 4500);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(orderSubscription);
    };
  }, [orderId, navigation]);

  // Fetch and subscribe to the assigned rider's real-time PostGIS location
  useEffect(() => {
    if (!activeRiderId) return;

    async function fetchRiderInitialLocation() {
      const { data: riderProfile } = await supabase
        .from('rider_profiles')
        .select('current_location, last_location_update')
        .eq('id', activeRiderId)
        .single();

      if (riderProfile?.current_location) {
        const parsed = parsePostGISPoint(riderProfile.current_location);
        if (parsed) {
          applyRiderCoordinates(parsed);
          return;
        }
      }
      // Default to restaurant coordinates if rider location hasn't been broadcast yet
      applyRiderCoordinates(restaurantLocation);
    }

    fetchRiderInitialLocation();

    const riderSubscription = supabase
      .channel(`rider:${activeRiderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rider_profiles',
          filter: `id=eq.${activeRiderId}`,
        },
        (payload) => {
          const parsed = parsePostGISPoint(payload.new?.current_location);
          if (parsed) {
            applyRiderCoordinates(parsed);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(riderSubscription);
    };
  }, [activeRiderId, restaurantLocation, applyRiderCoordinates]);

  // Built-in GPS route simulator for testing without a second physical device
  useEffect(() => {
    if (!simulating) return;

    let step = 0;
    const totalSteps = 12;
    const startPoint = riderLocation || restaurantLocation;

    const timer = setInterval(() => {
      step += 1;
      const ratio = Math.min(step / totalSteps, 1);
      const nextLat = startPoint.lat + (deliveryLocation.lat - startPoint.lat) * ratio;
      const nextLng = startPoint.lng + (deliveryLocation.lng - startPoint.lng) * ratio;
      applyRiderCoordinates({ lat: nextLat, lng: nextLng });

      if (step === 2 && orderStatus === 'PENDING') setOrderStatus('ACCEPTED');
      if (step === 4) setOrderStatus('PREPARING');
      if (step === 6) setOrderStatus('READY_FOR_PICKUP');
      if (step === 8) setOrderStatus('PICKED_UP');
      if (step >= totalSteps) {
        setOrderStatus('DELIVERED');
        setSimulating(false);
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [simulating, deliveryLocation, restaurantLocation, riderLocation, orderStatus, applyRiderCoordinates]);

  const currentStepIndex = Math.max(
    0,
    STATUS_STEPS.findIndex((s) => s.key === orderStatus)
  );
  const currentStep = STATUS_STEPS[currentStepIndex] || STATUS_STEPS[0];

  const remainingDistanceKm = riderLocation
    ? calculateDistanceKm(riderLocation, deliveryLocation)
    : calculateDistanceKm(restaurantLocation, deliveryLocation);
  const etaMinutes = Math.max(2, Math.round(remainingDistanceKm * 3.5));

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FF6B35" />
        <Text style={styles.loadingText}>Loading your order tracking…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* OpenStreetMap (OSM) MapView — 100% Free Tile Rendering */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: (restaurantLocation.lat + deliveryLocation.lat) / 2,
          longitude: (restaurantLocation.lng + deliveryLocation.lng) / 2,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        }}
      >
        {/* OpenStreetMap Tile Layer (PRD Section 3) */}
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
        />

        {/* Restaurant Pickup Marker */}
        <Marker
          coordinate={{ latitude: restaurantLocation.lat, longitude: restaurantLocation.lng }}
          title={restaurantName}
          description="Pickup Restaurant"
        >
          <View style={styles.restaurantMarker}>
            <Text style={styles.markerEmoji}>🍽️</Text>
          </View>
        </Marker>

        {/* Customer Delivery Marker */}
        <Marker
          coordinate={{ latitude: deliveryLocation.lat, longitude: deliveryLocation.lng }}
          title="Your Location"
          description="Delivery destination"
          pinColor="#FF6B35"
        />

        {/* Live Animated Rider Marker */}
        {riderLocation && (
          <Marker
            coordinate={{ latitude: riderLocation.lat, longitude: riderLocation.lng }}
            title="Your Rider"
            description={`ETA ~${etaMinutes} mins`}
          >
            <Animated.View style={[styles.riderMarker, { transform: [{ scale: pulseAnim }] }]}>
              <Text style={styles.markerEmoji}>🛵</Text>
            </Animated.View>
          </Marker>
        )}

        {/* Route Polyline */}
        <Polyline
          coordinates={[
            riderLocation
              ? { latitude: riderLocation.lat, longitude: riderLocation.lng }
              : { latitude: restaurantLocation.lat, longitude: restaurantLocation.lng },
            { latitude: deliveryLocation.lat, longitude: deliveryLocation.lng },
          ]}
          strokeColor="#FF6B35"
          strokeWidth={3}
          lineDashPattern={[6, 4]}
        />
      </MapView>

      {/* OSM Attribution Pill */}
      <View style={styles.osmBadge}>
        <Text style={styles.osmBadgeText}>🗺️ OpenStreetMap • Live PostGIS</Text>
      </View>

      {/* Status Card */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeaderRow}>
          <View style={styles.statusTitleGroup}>
            <Text style={styles.currentStatusEmoji}>{currentStep.emoji}</Text>
            <View>
              <Text style={styles.currentStatusLabel}>{currentStep.label}</Text>
              <Text style={styles.etaSubtext}>
                {orderStatus === 'DELIVERED'
                  ? 'Arrived at destination'
                  : `Est. arrival in ~${etaMinutes} mins (${remainingDistanceKm.toFixed(1)} km)`}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.simBtn, simulating && styles.simBtnActive]}
            onPress={() => {
              if (!riderLocation) setRiderLocation(restaurantLocation);
              setSimulating((s) => !s);
            }}
          >
            <Text style={styles.simBtnText}>{simulating ? '⏸ Pause' : '▶ Demo Sim'}</Text>
          </TouchableOpacity>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressBar}>
          {STATUS_STEPS.map((step, index) => (
            <View
              key={step.key}
              style={[
                styles.progressSegment,
                index <= currentStepIndex
                  ? styles.progressSegmentActive
                  : styles.progressSegmentInactive,
              ]}
            />
          ))}
        </View>

        {/* Step Emojis */}
        <View style={styles.stepLabels}>
          {STATUS_STEPS.map((step, index) => (
            <Text
              key={step.key}
              style={[
                styles.stepLabel,
                index <= currentStepIndex ? styles.stepLabelActive : styles.stepLabelInactive,
              ]}
            >
              {step.emoji}
            </Text>
          ))}
        </View>

        {orderStatus === 'DELIVERED' && (
          <Text style={styles.deliveredText}>
            🎉 Your order has been delivered! Enjoy your meal!
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
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
  osmBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    elevation: 3,
  },
  osmBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
  },
  restaurantMarker: {
    backgroundColor: '#FFF0EB',
    borderRadius: 20,
    padding: 6,
    borderWidth: 2,
    borderColor: '#FF6B35',
  },
  riderMarker: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 6,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    borderWidth: 2,
    borderColor: '#22C55E',
  },
  markerEmoji: {
    fontSize: 20,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statusTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  currentStatusEmoji: {
    fontSize: 34,
  },
  currentStatusLabel: {
    fontSize: 19,
    fontWeight: '800',
    color: '#1A1A2E',
  },
  etaSubtext: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  simBtn: {
    backgroundColor: '#FFF0EB',
    borderWidth: 1,
    borderColor: '#FF6B35',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  simBtnActive: {
    backgroundColor: '#FF6B35',
  },
  simBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  progressBar: {
    flexDirection: 'row',
    width: '100%',
    gap: 4,
    marginBottom: 8,
  },
  progressSegment: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
  progressSegmentActive: {
    backgroundColor: '#FF6B35',
  },
  progressSegmentInactive: {
    backgroundColor: '#E5E7EB',
  },
  stepLabels: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
  },
  stepLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
  },
  stepLabelActive: {
    opacity: 1,
  },
  stepLabelInactive: {
    opacity: 0.3,
  },
  deliveredText: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '700',
    color: '#065F46',
    textAlign: 'center',
  },
});
