/**
 * OpenFood Customer App — CartScreen
 *
 * Displays the customer's cart items for a selected restaurant, acquires
 * the customer's GPS coordinates via expo-location (with Accra fallback),
 * calculates dynamic delivery fees, and submits the order to Supabase
 * (triggering the Restaurant Dashboard's Realtime listener).
 *
 * Route params:
 *   restaurant {object} — selected restaurant
 *   cartItems  {Array}  — items chosen on MenuScreen
 *   orderNotes {string} — special instructions from MenuScreen
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  TextInput,
} from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { calculateDistanceKm } from '../utils/postgis';

const DEFAULT_CUSTOMER_ID = 'a1b2c3d4-0001-0001-0001-000000000001'; // Seed customer (Akosua Mensah)
const DEFAULT_COORDS = { lat: 5.615, lng: -0.176 }; // Airport Residential Area, Accra

function CartItem({ item, onIncrement, onDecrement }) {
  return (
    <View style={styles.cartItem}>
      <View style={styles.cartItemInfo}>
        <Text style={styles.cartItemName}>{item.name}</Text>
        <Text style={styles.cartItemPrice}>GH₵ {(item.price * item.quantity).toFixed(2)}</Text>
      </View>
      <View style={styles.quantityControl}>
        <TouchableOpacity style={styles.qtyButton} onPress={() => onDecrement(item)}>
          <Text style={styles.qtyButtonText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.qtyValue}>{item.quantity}</Text>
        <TouchableOpacity style={styles.qtyButton} onPress={() => onIncrement(item)}>
          <Text style={styles.qtyButtonText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function CartScreen({ route, navigation }) {
  const {
    restaurant,
    cartItems: initialCartItems,
    orderNotes = '',
  } = route.params || {};

  const [cartItems, setCartItems] = useState(
    initialCartItems?.length
      ? initialCartItems
      : [
          {
            id: 'c1b2c3d4-0001-0001-0001-000000000001',
            name: 'Jollof Rice & Chicken',
            price: 35.0,
            quantity: 1,
          },
          {
            id: 'c1b2c3d4-0003-0003-0003-000000000003',
            name: 'Kelewele',
            price: 15.0,
            quantity: 2,
          },
        ]
  );

  const [deliveryAddress, setDeliveryAddress] = useState('22 Airport Residential Area, Accra');
  const [deliveryCoords, setDeliveryCoords] = useState(DEFAULT_COORDS);
  const [locating, setLocating] = useState(false);
  const [placing, setPlacing] = useState(false);

  // Acquire customer's live GPS coordinates on mount (falls back to Accra coords)
  const useCurrentGpsLocation = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setDeliveryCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      }
    } catch {
      // Keep default Accra coordinates if running in simulator/web without GPS
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    useCurrentGpsLocation();
  }, [useCurrentGpsLocation]);

  // Cart & distance-based delivery fee calculation
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const restCoords = {
    lat: restaurant?.lat || 5.6037,
    lng: restaurant?.lng || -0.187,
  };
  const distanceKm = calculateDistanceKm(restCoords, deliveryCoords);
  const deliveryFee = Math.max(8.0, Math.min(25.0, Math.round((6 + distanceKm * 2.5) * 2) / 2));
  const total = subtotal + deliveryFee;

  const handleIncrement = useCallback((item) => {
    setCartItems((prev) =>
      prev.map((ci) => (ci.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci))
    );
  }, []);

  const handleDecrement = useCallback((item) => {
    setCartItems((prev) =>
      prev
        .map((ci) => (ci.id === item.id ? { ...ci, quantity: ci.quantity - 1 } : ci))
        .filter((ci) => ci.quantity > 0)
    );
  }, []);

  // Place Order → Inserts into Supabase `orders` + `order_items` (triggers Realtime on Restaurant Dashboard)
  const handlePlaceOrder = useCallback(async () => {
    if (!deliveryAddress.trim()) {
      Alert.alert('Missing Address', 'Please enter your delivery address before placing the order.');
      return;
    }
    if (cartItems.length === 0) {
      Alert.alert('Empty Cart', 'Add some items to your cart first!');
      return;
    }

    setPlacing(true);
    try {
      const effectiveRestaurantId =
        restaurant?.id || 'b1b2c3d4-0001-0001-0001-000000000001';

      // Check if an authenticated Supabase user exists; otherwise use seed customer
      const { data: authData } = await supabase.auth.getUser().catch(() => ({ data: null }));
      const customerId = authData?.user?.id || DEFAULT_CUSTOMER_ID;

      const fullAddress = orderNotes
        ? `${deliveryAddress.trim()} (Note: ${orderNotes})`
        : deliveryAddress.trim();

      // 1. Insert order into Supabase (PostGIS POINT: lng first, then lat)
      const { data: createdOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_id: customerId,
          restaurant_id: effectiveRestaurantId,
          status: 'PENDING',
          total_amount: total.toFixed(2),
          delivery_address: fullAddress,
          delivery_location: `SRID=4326;POINT(${deliveryCoords.lng} ${deliveryCoords.lat})`,
        })
        .select('id, status, rider_id')
        .single();

      let createdOrderId = createdOrder?.id;

      if (!orderError && createdOrderId) {
        // 2. Insert order_items
        const itemsPayload = cartItems.map((item) => ({
          order_id: createdOrderId,
          menu_item_id: item.id,
          quantity: item.quantity,
          unit_price: item.price,
        }));
        await supabase.from('order_items').insert(itemsPayload);
      } else {
        // Offline / unconfigured Supabase fallback for instant UI testing
        createdOrderId = 'd1b2c3d4-0001-0001-0001-000000000001';
      }

      navigation.replace('Tracking', {
        orderId: createdOrderId,
        riderId: createdOrder?.rider_id || null,
        restaurantLocation: restCoords,
        deliveryLocation: deliveryCoords,
        restaurantName: restaurant?.name || 'Mama Akua Kitchen',
      });
    } catch (err) {
      Alert.alert('Order Failed', err.message || 'Something went wrong. Please try again.');
    } finally {
      setPlacing(false);
    }
  }, [cartItems, deliveryAddress, deliveryCoords, orderNotes, restaurant, restCoords, total, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={cartItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <CartItem item={item} onIncrement={handleIncrement} onDecrement={handleDecrement} />
        )}
        ListHeaderComponent={
          <View>
            {restaurant && (
              <View style={styles.restaurantHeader}>
                <Text style={styles.restaurantHeaderText}>🍽️ {restaurant.name}</Text>
              </View>
            )}
            <Text style={styles.sectionTitle}>Your Items</Text>
          </View>
        }
        ListFooterComponent={
          <View>
            <View style={styles.addressHeaderRow}>
              <Text style={styles.sectionTitle}>Delivery Address</Text>
              <TouchableOpacity onPress={useCurrentGpsLocation} disabled={locating}>
                <Text style={styles.gpsLinkText}>
                  {locating ? 'Locating…' : '📍 Refresh GPS'}
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.addressInput}
              placeholder="Enter your full delivery address…"
              value={deliveryAddress}
              onChangeText={setDeliveryAddress}
              multiline
              numberOfLines={2}
              placeholderTextColor="#9CA3AF"
            />
            <Text style={styles.coordsCaption}>
              GPS: ({deliveryCoords.lat.toFixed(4)}, {deliveryCoords.lng.toFixed(4)})
              {!!orderNotes && ` • Note: "${orderNotes}"`}
            </Text>

            {/* Order Summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Order Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryValue}>GH₵ {subtotal.toFixed(2)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  Delivery Fee ({distanceKm.toFixed(1)} km)
                </Text>
                <Text style={styles.summaryValue}>GH₵ {deliveryFee.toFixed(2)}</Text>
              </View>
              <View style={[styles.summaryRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>GH₵ {total.toFixed(2)}</Text>
              </View>
            </View>

            {/* Place Order Button */}
            <TouchableOpacity
              style={[styles.placeOrderButton, placing && styles.placeOrderButtonDisabled]}
              onPress={handlePlaceOrder}
              disabled={placing}
              activeOpacity={0.85}
            >
              {placing ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.placeOrderButtonText}>
                  Place Order — GH₵ {total.toFixed(2)}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Your cart is empty. Go back and add some items!</Text>
        }
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
  restaurantHeader: {
    backgroundColor: '#FFF0EB',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  restaurantHeaderText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF6B35',
  },
  addressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gpsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF6B35',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 12,
    marginTop: 8,
  },
  cartItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  cartItemInfo: {
    flex: 1,
  },
  cartItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  cartItemPrice: {
    fontSize: 14,
    color: '#FF6B35',
    fontWeight: '700',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qtyButton: {
    backgroundColor: '#FF6B35',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  qtyValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    minWidth: 20,
    textAlign: 'center',
  },
  addressInput: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    fontSize: 14,
    color: '#1A1A2E',
    marginBottom: 6,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  coordsCaption: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  summaryValue: {
    fontSize: 14,
    color: '#1A1A2E',
    fontWeight: '500',
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 10,
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FF6B35',
  },
  placeOrderButton: {
    backgroundColor: '#FF6B35',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  placeOrderButtonDisabled: {
    backgroundColor: '#FDB594',
  },
  placeOrderButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 15,
    marginTop: 40,
  },
});
