/**
 * OpenFood Customer App — TrackingScreen
 *
 * Renders an OpenStreetMap (OSM) live delivery tracking view + Post-Order Payment:
 *   - Uses free OpenStreetMap tiles via <UrlTile>
 *   - Allows customer to pay via Mobile Money (MTN, Telecel, AT) or Bank Card after placing order
 *   - Shows live payment confirmation status when the Restaurant confirms payment
 *   - Subscribes to Supabase Realtime for order status, payment confirmation, and rider GPS updates
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  TextInput,
  Alert,
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

const PAYMENT_METHODS = [
  { key: 'MOMO_MTN',     label: '📱 MTN MoMo' },
  { key: 'MOMO_TELECEL', label: '📱 Telecel Cash' },
  { key: 'MOMO_AT',      label: '📱 AT Money' },
  { key: 'BANK_CARD',    label: '💳 Bank Card' },
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
  const [paymentStatus, setPaymentStatus] = useState('UNPAID'); // 'UNPAID' | 'PAID_PENDING_CONFIRMATION' | 'CONFIRMED'
  const [paymentMethod, setPaymentMethod] = useState('MOMO_MTN');
  const [paymentAccount, setPaymentAccount] = useState('024 123 4567');
  const [paymentRef, setPaymentRef] = useState(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const [activeRiderId, setActiveRiderId] = useState(initialRiderId);
  const [riderLocation, setRiderLocation] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

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

  // Fetch initial order & payment status, then subscribe to Realtime updates
  useEffect(() => {
    let isMounted = true;

    async function initialFetch() {
      try {
        const { data: order } = await supabase
          .from('orders')
          .select('status, rider_id, payment_status, payment_method, payment_reference')
          .eq('id', orderId)
          .single();

        if (isMounted && order) {
          setOrderStatus(order.status);
          if (order.payment_status) setPaymentStatus(order.payment_status);
          if (order.payment_method) setPaymentMethod(order.payment_method);
          if (order.payment_reference) setPaymentRef(order.payment_reference);
          if (order.rider_id) setActiveRiderId(order.rider_id);
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
          if (payload.new?.status) setOrderStatus(payload.new.status);
          if (payload.new?.payment_status) setPaymentStatus(payload.new.payment_status);
          if (payload.new?.payment_reference) setPaymentRef(payload.new.payment_reference);
          if (payload.new?.rider_id) setActiveRiderId(payload.new.rider_id);
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

  // Submit Mobile Money or Bank Card Payment
  const handleMakePayment = useCallback(async () => {
    if (!paymentAccount.trim()) {
      Alert.alert(
        'Missing Details',
        paymentMethod === 'BANK_CARD'
          ? 'Please enter your bank card number.'
          : 'Please enter your Mobile Money phone number.'
      );
      return;
    }

    setSubmittingPayment(true);
    try {
      const prefix = paymentMethod === 'BANK_CARD' ? 'CARD' : 'MOMO';
      const generatedRef = `TXN-${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;

      await supabase
        .from('orders')
        .update({
          payment_method: paymentMethod,
          payment_account: paymentAccount.trim(),
          payment_reference: generatedRef,
          payment_status: 'PAID_PENDING_CONFIRMATION',
          paid_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      setPaymentRef(generatedRef);
      setPaymentStatus('PAID_PENDING_CONFIRMATION');
    } catch {
      // Demo fallback if offline
      const generatedRef = `TXN-MOMO-${Math.floor(100000 + Math.random() * 900000)}`;
      setPaymentRef(generatedRef);
      setPaymentStatus('PAID_PENDING_CONFIRMATION');
    } finally {
      setSubmittingPayment(false);
    }
  }, [orderId, paymentMethod, paymentAccount]);

  // Built-in GPS route simulator
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

      if (step === 2 && paymentStatus === 'PAID_PENDING_CONFIRMATION') {
        setPaymentStatus('CONFIRMED');
      }
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
  }, [
    simulating,
    deliveryLocation,
    restaurantLocation,
    riderLocation,
    orderStatus,
    paymentStatus,
    applyRiderCoordinates,
  ]);

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
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
        />

        <Marker
          coordinate={{ latitude: restaurantLocation.lat, longitude: restaurantLocation.lng }}
          title={restaurantName}
          description="Pickup Restaurant"
        >
          <View style={styles.restaurantMarker}>
            <Text style={styles.markerEmoji}>🍽️</Text>
          </View>
        </Marker>

        <Marker
          coordinate={{ latitude: deliveryLocation.lat, longitude: deliveryLocation.lng }}
          title="Your Location"
          description="Delivery destination"
          pinColor="#FF6B35"
        />

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

      <View style={styles.osmBadge}>
        <Text style={styles.osmBadgeText}>🗺️ OpenStreetMap • Live PostGIS</Text>
      </View>

      {/* Bottom Status & Payment Card */}
      <View style={styles.statusCard}>
        {/* Payment Box (Mobile Money & Bank Card + Live Restaurant Confirmation) */}
        {paymentStatus === 'UNPAID' && (
          <View style={styles.paymentBox}>
            <Text style={styles.paymentTitle}>💳 Complete Payment for Your Order</Text>
            <View style={styles.methodChipsRow}>
              {PAYMENT_METHODS.map((pm) => (
                <TouchableOpacity
                  key={pm.key}
                  style={[
                    styles.methodChip,
                    paymentMethod === pm.key && styles.methodChipSelected,
                  ]}
                  onPress={() => {
                    setPaymentMethod(pm.key);
                    setPaymentAccount(
                      pm.key === 'BANK_CARD' ? '4242 •••• •••• 4242' : '024 123 4567'
                    );
                  }}
                >
                  <Text
                    style={[
                      styles.methodChipText,
                      paymentMethod === pm.key && styles.methodChipTextSelected,
                    ]}
                  >
                    {pm.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.payInputRow}>
              <TextInput
                style={styles.payInput}
                value={paymentAccount}
                onChangeText={setPaymentAccount}
                placeholder={
                  paymentMethod === 'BANK_CARD'
                    ? 'Card Number (e.g. 4242 **** 4242)'
                    : 'MoMo Number (e.g. 024 123 4567)'
                }
              />
              <TouchableOpacity
                style={styles.payNowBtn}
                onPress={handleMakePayment}
                disabled={submittingPayment}
              >
                <Text style={styles.payNowBtnText}>
                  {submittingPayment ? 'Paying…' : 'Pay Now'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {paymentStatus === 'PAID_PENDING_CONFIRMATION' && (
          <View style={styles.paymentPendingBanner}>
            <Text style={styles.paymentPendingTitle}>
              ⏳ Payment Sent ({paymentMethod.replace('MOMO_', '')}) • Ref: {paymentRef || 'TXN'}
            </Text>
            <Text style={styles.paymentPendingSub}>
              Waiting for {restaurantName} to confirm receipt of your payment…
            </Text>
          </View>
        )}

        {paymentStatus === 'CONFIRMED' && (
          <View style={styles.paymentConfirmedBanner}>
            <Text style={styles.paymentConfirmedTitle}>
              ✅ Payment Confirmed by Restaurant!
            </Text>
            <Text style={styles.paymentConfirmedSub}>
              Verified ({paymentMethod.replace('MOMO_', '')} • Ref: {paymentRef || 'TXN-VERIFIED'})
            </Text>
          </View>
        )}

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
    padding: 18,
    elevation: 12,
  },
  paymentBox: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  paymentTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#9A3412',
    marginBottom: 8,
  },
  methodChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  methodChip: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  methodChipSelected: {
    backgroundColor: '#FF6B35',
    borderColor: '#FF6B35',
  },
  methodChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
  },
  methodChipTextSelected: {
    color: '#FFF',
  },
  payInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  payInput: {
    flex: 1,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  payNowBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  payNowBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 13,
  },
  paymentPendingBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  paymentPendingTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
  },
  paymentPendingSub: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
  },
  paymentConfirmedBanner: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#22C55E',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  paymentConfirmedTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  paymentConfirmedSub: {
    fontSize: 11,
    color: '#15803D',
    marginTop: 2,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  statusTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  currentStatusEmoji: {
    fontSize: 32,
  },
  currentStatusLabel: {
    fontSize: 18,
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
