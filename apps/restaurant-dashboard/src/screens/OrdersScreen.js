/**
 * OpenFood Restaurant Dashboard — OrdersScreen
 *
 * Implements PRD Sections 2, 5.2, 5.3 & 6 + Real-Time Payment Confirmation:
 *  - Live order feed via Supabase Realtime (`INSERT` & `UPDATE` on `orders`)
 *  - Instant audio chime (Web Audio API) + vibration + visual flash banner on new orders & payments
 *  - Displays Customer Payment Status (Mobile Money / Bank Card) + 1-tap "Confirm Payment" button
 *  - Order stage workflow: PENDING → ACCEPTED → PREPARING → READY_FOR_PICKUP
 *  - Menu Availability Manager tab (`MENU`) to toggle `menu_items.is_available` in real time
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Switch,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  Vibration,
  Platform,
  TextInput,
} from 'react-native';
import { supabase } from '../lib/supabase';

const DEFAULT_RESTAURANT_ID = 'b1b2c3d4-0001-0001-0001-000000000001';

const STATUS_COLORS = {
  PENDING:          { bg: '#FFF7ED', border: '#F97316', text: '#C2410C' },
  ACCEPTED:         { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8' },
  PREPARING:        { bg: '#F0FDF4', border: '#22C55E', text: '#15803D' },
  READY_FOR_PICKUP: { bg: '#FAF5FF', border: '#A855F7', text: '#7E22CE' },
  PICKED_UP:        { bg: '#F0F9FF', border: '#0EA5E9', text: '#0369A1' },
  DELIVERED:        { bg: '#F0FDF4', border: '#6EE7B7', text: '#065F46' },
  CANCELLED:        { bg: '#FEF2F2', border: '#EF4444', text: '#B91C1C' },
};

const NEXT_ACTION = {
  PENDING:   { label: 'Accept Order ✅',                    nextStatus: 'ACCEPTED' },
  ACCEPTED:  { label: 'Start Preparing 👨‍🍳',               nextStatus: 'PREPARING' },
  PREPARING: { label: 'Mark as Ready 📦 (Dispatch Rider)', nextStatus: 'READY_FOR_PICKUP' },
  READY_FOR_PICKUP: null,
  PICKED_UP:        null,
  DELIVERED:        null,
  CANCELLED:        null,
};

function triggerNewOrderAlarm() {
  try {
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 400, 200, 400]);
    } else if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const notes = [587.33, 880.0, 1174.66];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.16);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.16 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.16);
        osc.stop(ctx.currentTime + idx * 0.16 + 0.35);
      });
    }
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

function OrderCard({ order, onAdvance, onCancel, onConfirmPayment }) {
  const colors = STATUS_COLORS[order.status] || STATUS_COLORS.PENDING;
  const nextAction = NEXT_ACTION[order.status];
  const paymentStatus = order.payment_status || 'UNPAID';
  const createdAt = new Date(order.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.card, { borderLeftColor: colors.border, backgroundColor: colors.bg }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.orderId}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>
        <View style={[styles.statusBadge, { backgroundColor: colors.border }]}>
          <Text style={styles.statusBadgeText}>{order.status.replace(/_/g, ' ')}</Text>
        </View>
      </View>

      <Text style={styles.customerName}>👤 {order.users?.full_name || 'Customer'}</Text>

      {order.order_items?.map((item) => (
        <Text key={item.id} style={styles.itemLine}>
          • {item.quantity}× {item.menu_items?.name || 'Menu Item'} @ GH₵{item.unit_price}
        </Text>
      ))}

      <Text style={styles.deliveryAddress} numberOfLines={2}>
        📍 {order.delivery_address}
      </Text>

      {/* Payment Status & Restaurant Confirmation Section */}
      <View
        style={[
          styles.paymentSection,
          paymentStatus === 'CONFIRMED'
            ? styles.paymentConfirmedBox
            : paymentStatus === 'PAID_PENDING_CONFIRMATION'
            ? styles.paymentPendingBox
            : styles.paymentUnpaidBox,
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.paymentLabel}>
            {paymentStatus === 'CONFIRMED'
              ? '✅ PAYMENT CONFIRMED'
              : paymentStatus === 'PAID_PENDING_CONFIRMATION'
              ? '⏳ CUSTOMER PAID — AWAITING CONFIRMATION'
              : '⚠️ UNPAID (Waiting for Customer MoMo / Card)'}
          </Text>
          {order.payment_method && (
            <Text style={styles.paymentMeta}>
              Method: {order.payment_method.replace('MOMO_', 'MoMo ')} • Acct:{' '}
              {order.payment_account || 'N/A'} • Ref: {order.payment_reference || 'N/A'}
            </Text>
          )}
        </View>

        {paymentStatus === 'PAID_PENDING_CONFIRMATION' && (
          <TouchableOpacity
            style={styles.confirmPaymentBtn}
            onPress={() => onConfirmPayment(order)}
          >
            <Text style={styles.confirmPaymentBtnText}>💳 Confirm Payment</Text>
          </TouchableOpacity>
        )}
      </View>

      {order.rider_id && (
        <Text style={styles.riderAssignedText}>
          🛵 Rider Assigned: #{order.rider_id.slice(0, 8).toUpperCase()}
        </Text>
      )}

      <View style={styles.cardFooter}>
        <Text style={styles.totalAmount}>
          Total:{' '}
          <Text style={styles.totalAmountValue}>
            GH₵ {parseFloat(order.total_amount).toFixed(2)}
          </Text>
        </Text>
        <Text style={styles.orderTime}>{createdAt}</Text>
      </View>

      <View style={styles.cardActions}>
        {nextAction && (
          <TouchableOpacity
            style={styles.advanceButton}
            onPress={() => onAdvance(order, nextAction.nextStatus)}
            activeOpacity={0.85}
          >
            <Text style={styles.advanceButtonText}>{nextAction.label}</Text>
          </TouchableOpacity>
        )}
        {order.status === 'PENDING' && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => onCancel(order)}
            activeOpacity={0.85}
          >
            <Text style={styles.cancelButtonText}>Reject ✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function MenuItemRow({ item, onToggle }) {
  return (
    <View style={styles.menuRowCard}>
      <View style={styles.menuRowInfo}>
        <Text style={styles.menuRowName}>{item.name}</Text>
        <Text style={styles.menuRowPrice}>GH₵ {parseFloat(item.price).toFixed(2)}</Text>
      </View>
      <View style={styles.menuToggleGroup}>
        <Text
          style={[
            styles.availabilityLabel,
            { color: item.is_available ? '#15803D' : '#B91C1C' },
          ]}
        >
          {item.is_available ? 'In Stock' : 'Sold Out'}
        </Text>
        <Switch
          value={item.is_available}
          onValueChange={(val) => onToggle(item, val)}
          trackColor={{ false: '#D1D5DB', true: '#22C55E' }}
          thumbColor="#FFF"
        />
      </View>
    </View>
  );
}

export default function OrdersScreen() {
  const [orders, setOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('ACTIVE');
  const [newOrderBanner, setNewOrderBanner] = useState(null);

  // Add New Stock Form State
  const [newStockName, setNewStockName] = useState('');
  const [newStockPrice, setNewStockPrice] = useState('');
  const [newStockDesc, setNewStockDesc] = useState('');

  // Add New Rider Form State
  const [newRiderName, setNewRiderName] = useState('');
  const [newRiderPhone, setNewRiderPhone] = useState('');

  const channelRef = useRef(null);

  const fetchOrders = useCallback(async () => {
    try {
      let query = supabase
        .from('orders')
        .select(`
          id,
          status,
          total_amount,
          delivery_address,
          payment_method,
          payment_status,
          payment_reference,
          payment_account,
          created_at,
          updated_at,
          customer_id,
          restaurant_id,
          rider_id,
          users!orders_customer_id_fkey ( id, full_name, phone ),
          order_items (
            id,
            quantity,
            unit_price,
            subtotal,
            menu_items ( id, name )
          )
        `)
        .order('created_at', { ascending: false });

      if (filter === 'ACTIVE') {
        query = query.not('status', 'in', '("DELIVERED","CANCELLED")');
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      setOrders(data || []);
    } catch (err) {
      console.warn('[OrdersScreen] fetchOrders warning:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  const fetchMenuItems = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select('id, name, description, price, is_available, restaurant_id')
        .eq('restaurant_id', DEFAULT_RESTAURANT_ID)
        .order('name', { ascending: true });

      if (!error && data) {
        setMenuItems(data);
      }
    } catch (err) {
      console.warn('[OrdersScreen] fetchMenuItems warning:', err.message);
    }
  }, []);

  const fetchRiders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('rider_profiles')
        .select(`
          id,
          is_online,
          is_available,
          last_location_update,
          users!inner ( id, full_name, phone, role )
        `);

      if (!error && data) {
        setRiders(data);
      }
    } catch (err) {
      console.warn('[OrdersScreen] fetchRiders warning:', err.message);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    fetchMenuItems();
    fetchRiders();
  }, [fetchOrders, fetchMenuItems, fetchRiders]);

  useEffect(() => {
    channelRef.current = supabase
      .channel('restaurant-orders-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          triggerNewOrderAlarm();
          setNewOrderBanner(
            `🔔 New Order #${payload.new.id.slice(0, 8).toUpperCase()} — GH₵ ${parseFloat(
              payload.new.total_amount || 0
            ).toFixed(2)}`
          );
          fetchOrders();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.new?.payment_status === 'PAID_PENDING_CONFIRMATION') {
            triggerNewOrderAlarm();
            setNewOrderBanner(
              `💳 Payment Submitted for Order #${payload.new.id
                .slice(0, 8)
                .toUpperCase()} — Please Confirm!`
            );
          }
          setOrders((prev) =>
            prev.map((o) => (o.id === payload.new.id ? { ...o, ...payload.new } : o))
          );
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [fetchOrders]);

  // Confirm Customer Payment (Mobile Money / Bank Card)
  const handleConfirmPayment = useCallback(async (order) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          payment_status: 'CONFIRMED',
          payment_confirmed_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      if (error) throw new Error(error.message);

      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, payment_status: 'CONFIRMED' } : o))
      );
    } catch (err) {
      Alert.alert('Payment Confirmation Error', err.message);
    }
  }, []);

  const handleAdvance = useCallback(async (order, nextStatus) => {
    try {
      const { data: updated, error } = await supabase
        .from('orders')
        .update({ status: nextStatus })
        .eq('id', order.id)
        .select('id, status, rider_id')
        .single();

      if (error) throw new Error(error.message);

      let assignedRiderId = updated?.rider_id || order.rider_id;

      if (nextStatus === 'READY_FOR_PICKUP' && !assignedRiderId) {
        const { data: rpcData } = await supabase.rpc('dispatch_nearest_rider', {
          p_order_id: order.id,
          p_radius_meters: 5000,
        });
        if (rpcData?.length > 0) {
          assignedRiderId = rpcData[0].assigned_rider_id;
        }
      }

      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, status: nextStatus, rider_id: assignedRiderId } : o
        )
      );
    } catch (err) {
      Alert.alert('Update Failed', err.message);
    }
  }, []);

  const handleCancel = useCallback(
    (order) => {
      Alert.alert(
        'Reject Order',
        `Are you sure you want to reject order #${order.id.slice(0, 8).toUpperCase()}?`,
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes, Reject',
            style: 'destructive',
            onPress: async () => {
              try {
                const { error } = await supabase
                  .from('orders')
                  .update({ status: 'CANCELLED' })
                  .eq('id', order.id);

                if (error) throw new Error(error.message);

                setOrders((prev) =>
                  filter === 'ACTIVE'
                    ? prev.filter((o) => o.id !== order.id)
                    : prev.map((o) =>
                        o.id === order.id ? { ...o, status: 'CANCELLED' } : o
                      )
                );
              } catch (err) {
                Alert.alert('Error', err.message);
              }
            },
          },
        ]
      );
    },
    [filter]
  );

  const handleToggleMenuItem = useCallback(async (item, isAvailable) => {
    setMenuItems((prev) =>
      prev.map((m) => (m.id === item.id ? { ...m, is_available: isAvailable } : m))
    );
    const { error } = await supabase
      .from('menu_items')
      .update({ is_available: isAvailable })
      .eq('id', item.id);

    if (error) {
      Alert.alert('Update Failed', error.message);
      setMenuItems((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, is_available: !isAvailable } : m))
      );
    }
  }, []);

  // Add New Stock Item to Menu
  const handleAddStockItem = useCallback(async () => {
    const trimmedName = newStockName.trim();
    const numericPrice = parseFloat(newStockPrice);
    if (!trimmedName || Number.isNaN(numericPrice) || numericPrice <= 0) {
      Alert.alert('Invalid Input', 'Please enter a valid item name and price (GH₵).');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('menu_items')
        .insert({
          restaurant_id: DEFAULT_RESTAURANT_ID,
          name: trimmedName,
          description: newStockDesc.trim() || 'Freshly prepared dish',
          price: numericPrice,
          is_available: true,
        })
        .select('id, name, description, price, is_available, restaurant_id')
        .single();

      if (error) throw new Error(error.message);

      setMenuItems((prev) => [...prev, data]);
      setNewStockName('');
      setNewStockPrice('');
      setNewStockDesc('');
      Alert.alert('Stock Added', `"${data.name}" has been added to the live menu!`);
    } catch (err) {
      Alert.alert('Add Stock Error', err.message);
    }
  }, [newStockName, newStockPrice, newStockDesc]);

  // Add New Delivery Rider
  const handleAddRider = useCallback(async () => {
    const trimmedName = newRiderName.trim();
    const trimmedPhone = newRiderPhone.trim();
    if (!trimmedName || !trimmedPhone) {
      Alert.alert('Invalid Input', 'Please enter the rider full name and phone number.');
      return;
    }

    try {
      const { data: user, error: userErr } = await supabase
        .from('users')
        .insert({
          full_name: trimmedName,
          phone: trimmedPhone,
          role: 'RIDER',
        })
        .select('id, full_name, phone, role')
        .single();

      if (userErr) throw new Error(userErr.message);

      const { data: profile, error: profErr } = await supabase
        .from('rider_profiles')
        .insert({
          id: user.id,
          is_online: true,
          is_available: true,
          current_location: 'SRID=4326;POINT(-0.1820 5.5600)',
          last_location_update: new Date().toISOString(),
        })
        .select('id, is_online, is_available, last_location_update')
        .single();

      if (profErr) throw new Error(profErr.message);

      setRiders((prev) => [...prev, { ...profile, users: user }]);
      setNewRiderName('');
      setNewRiderPhone('');
      Alert.alert('Rider Registered', `🛵 ${user.full_name} added to active fleet!`);
    } catch (err) {
      Alert.alert('Add Rider Error', err.message);
    }
  }, [newRiderName, newRiderPhone]);

  const activeCount = orders.filter(
    (o) => !['DELIVERED', 'CANCELLED'].includes(o.status)
  ).length;

  return (
    <SafeAreaView style={styles.container}>
      {newOrderBanner && (
        <TouchableOpacity
          style={styles.alertBanner}
          onPress={() => setNewOrderBanner(null)}
          activeOpacity={0.9}
        >
          <Text style={styles.alertBannerText}>{newOrderBanner}</Text>
          <Text style={styles.alertBannerDismiss}>Tap to dismiss ✕</Text>
        </TouchableOpacity>
      )}

      <View style={styles.filterTabs}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'ACTIVE' && styles.filterTabActive]}
          onPress={() => setFilter('ACTIVE')}
        >
          <Text style={[styles.filterTabText, filter === 'ACTIVE' && styles.filterTabTextActive]}>
            Active {activeCount > 0 && `(${activeCount})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'ALL' && styles.filterTabActive]}
          onPress={() => setFilter('ALL')}
        >
          <Text style={[styles.filterTabText, filter === 'ALL' && styles.filterTabTextActive]}>
            All Orders
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'MENU' && styles.filterTabActive]}
          onPress={() => setFilter('MENU')}
        >
          <Text style={[styles.filterTabText, filter === 'MENU' && styles.filterTabTextActive]}>
            🍽️ Stock (+Add)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'RIDERS' && styles.filterTabActive]}
          onPress={() => setFilter('RIDERS')}
        >
          <Text style={[styles.filterTabText, filter === 'RIDERS' && styles.filterTabTextActive]}>
            🛵 Riders (+Add)
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1A1A2E" />
          <Text style={styles.loadingText}>Loading dashboard…</Text>
        </View>
      ) : filter === 'MENU' ? (
        <FlatList
          data={menuItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MenuItemRow item={item} onToggle={handleToggleMenuItem} />
          )}
          ListHeaderComponent={
            <View>
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>➕ Add New Stock Item to Menu</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Dish / Stock Name (e.g. Assorted Fried Rice)"
                  value={newStockName}
                  onChangeText={setNewStockName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Price in GH₵ (e.g. 60.00)"
                  keyboardType="decimal-pad"
                  value={newStockPrice}
                  onChangeText={setNewStockPrice}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Short Description"
                  value={newStockDesc}
                  onChangeText={setNewStockDesc}
                />
                <TouchableOpacity style={styles.addBtn} onPress={handleAddStockItem}>
                  <Text style={styles.addBtnText}>➕ Add Stock to Menu</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.menuSectionTitle}>
                Toggle Item Availability (Updates Customer App in Real Time)
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      ) : filter === 'RIDERS' ? (
        <FlatList
          data={riders}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.menuRowCard}>
              <View style={styles.menuRowInfo}>
                <Text style={styles.menuRowName}>
                  🛵 {item.users?.full_name || 'Delivery Rider'}
                </Text>
                <Text style={styles.menuRowPrice}>📞 {item.users?.phone || 'N/A'}</Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: item.is_online ? '#16A34A' : '#6B7280' },
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {item.is_online
                    ? item.is_available
                      ? 'ONLINE • READY'
                      : 'ON DELIVERY'
                    : 'OFFLINE'}
                </Text>
              </View>
            </View>
          )}
          ListHeaderComponent={
            <View>
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>🛵 Register New Delivery Rider</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Rider Full Name (e.g. Yaw Boateng)"
                  value={newRiderName}
                  onChangeText={setNewRiderName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Phone Number (e.g. +233249998877)"
                  keyboardType="phone-pad"
                  value={newRiderPhone}
                  onChangeText={setNewRiderPhone}
                />
                <TouchableOpacity style={styles.addBtn} onPress={handleAddRider}>
                  <Text style={styles.addBtnText}>🛵 + Add Rider to Fleet</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.menuSectionTitle}>
                Active Registered Delivery Riders ({riders.length})
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              onAdvance={handleAdvance}
              onCancel={handleCancel}
              onConfirmPayment={handleConfirmPayment}
            />
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyEmoji}>🎉</Text>
              <Text style={styles.emptyText}>
                {filter === 'ACTIVE'
                  ? 'No active orders right now. Sit tight!'
                  : 'No orders yet today.'}
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                fetchOrders();
              }}
              tintColor="#1A1A2E"
            />
          }
          contentContainerStyle={styles.listContent}
        />
      )}

      <View style={styles.liveIndicator}>
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>Live — Supabase Realtime + Payment Verification</Text>
        <TouchableOpacity
          style={styles.testSoundBtn}
          onPress={() => {
            triggerNewOrderAlarm();
            setNewOrderBanner('🔔 Test Audio Alarm — Ready for incoming orders & payments!');
          }}
        >
          <Text style={styles.testSoundText}>🔔 Test Alarm</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  alertBanner: {
    backgroundColor: '#EA580C',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  alertBannerText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  alertBannerDismiss: {
    color: '#FFEDD5',
    fontSize: 12,
    fontWeight: '600',
  },
  filterTabs: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  filterTab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  filterTabActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#1A1A2E',
  },
  filterTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  filterTabTextActive: {
    color: '#1A1A2E',
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  menuSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4B5563',
    marginBottom: 12,
  },
  menuRowCard: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
  },
  menuRowInfo: {
    flex: 1,
  },
  menuRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  menuRowPrice: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '600',
  },
  menuToggleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  availabilityLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    borderRadius: 12,
    borderLeftWidth: 5,
    padding: 16,
    marginBottom: 14,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderId: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1A2E',
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  customerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  itemLine: {
    fontSize: 13,
    color: '#6B7280',
    marginLeft: 4,
    marginBottom: 2,
  },
  deliveryAddress: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 6,
    marginBottom: 8,
  },
  paymentSection: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  paymentUnpaidBox: {
    backgroundColor: '#FEE2E2',
  },
  paymentPendingBox: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  paymentConfirmedBox: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#22C55E',
  },
  paymentLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1F2937',
  },
  paymentMeta: {
    fontSize: 11,
    color: '#4B5563',
    marginTop: 2,
  },
  confirmPaymentBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  confirmPaymentBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  riderAssignedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7E22CE',
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  totalAmount: {
    fontSize: 13,
    color: '#6B7280',
  },
  totalAmountValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  orderTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
  },
  advanceButton: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  advanceButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },
  cancelButton: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#B91C1C',
    fontWeight: '700',
    fontSize: 13,
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
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  liveText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
    flex: 1,
  },
  testSoundBtn: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  testSoundText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  formCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  formTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A1A2E',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    marginBottom: 8,
    backgroundColor: '#F9FAFB',
    color: '#111827',
  },
  addBtn: {
    backgroundColor: '#EA580C',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 4,
  },
  addBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 13,
  },
});
