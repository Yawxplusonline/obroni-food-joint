/**
 * OpenFood Customer App — MenuScreen
 *
 * Displays a restaurant's menu items and allows the customer to customize
 * quantities and special instructions before proceeding to the CartScreen.
 *
 * Route params:
 *   restaurant {object} — selected restaurant from HomeScreen
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  TextInput,
} from 'react-native';
import { supabase } from '../lib/supabase';

// Fallback seed menu items so the app works out-of-the-box in demo mode
const FALLBACK_MENU_BY_RESTAURANT = {
  'b1b2c3d4-0001-0001-0001-000000000001': [
    {
      id: 'c1b2c3d4-0001-0001-0001-000000000001',
      name: 'Jollof Rice & Chicken',
      description: 'Perfectly spiced Ghanaian jollof rice served with grilled chicken and coleslaw.',
      price: 35.0,
      is_available: true,
    },
    {
      id: 'c1b2c3d4-0002-0002-0002-000000000002',
      name: 'Banku & Tilapia',
      description: 'Fermented corn and cassava dumpling served with grilled tilapia and pepper sauce.',
      price: 45.0,
      is_available: true,
    },
    {
      id: 'c1b2c3d4-0003-0003-0003-000000000003',
      name: 'Kelewele',
      description: 'Spiced fried plantain cubes — the perfect snack or side dish.',
      price: 15.0,
      is_available: true,
    },
  ],
  'b1b2c3d4-0002-0002-0002-000000000002': [
    {
      id: 'c1b2c3d4-0004-0004-0004-000000000004',
      name: 'Fufu & Light Soup',
      description: 'Pounded cassava and plantain in a light tomato and pepper soup with meat.',
      price: 40.0,
      is_available: true,
    },
    {
      id: 'c1b2c3d4-0005-0005-0005-000000000005',
      name: 'Rice & Stew',
      description: 'Plain white rice with Ghanaian tomato stew and your choice of protein.',
      price: 30.0,
      is_available: true,
    },
  ],
};

function MenuItemCard({ item, quantity, onAdd, onRemove }) {
  return (
    <View style={[styles.menuCard, !item.is_available && styles.menuCardUnavailable]}>
      <View style={styles.menuInfo}>
        <Text style={styles.itemName}>{item.name}</Text>
        {!!item.description && (
          <Text style={styles.itemDescription} numberOfLines={2}>
            {item.description}
          </Text>
        )}
        <Text style={styles.itemPrice}>GH₵ {parseFloat(item.price).toFixed(2)}</Text>
      </View>

      {!item.is_available ? (
        <View style={styles.soldOutBadge}>
          <Text style={styles.soldOutText}>Sold Out</Text>
        </View>
      ) : quantity > 0 ? (
        <View style={styles.qtyControls}>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => onRemove(item)}>
            <Text style={styles.qtyBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.qtyCount}>{quantity}</Text>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => onAdd(item)}>
            <Text style={styles.qtyBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.addBtn} onPress={() => onAdd(item)} activeOpacity={0.85}>
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function MenuScreen({ route, navigation }) {
  const { restaurant } = route.params || {};
  const [menuItems, setMenuItems] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [orderNotes, setOrderNotes] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchMenu = useCallback(async () => {
    try {
      setLoading(true);
      if (restaurant?.id) {
        const { data, error } = await supabase
          .from('menu_items')
          .select('id, name, description, price, is_available')
          .eq('restaurant_id', restaurant.id)
          .order('name', { ascending: true });

        if (!error && data && data.length > 0) {
          setMenuItems(data);
          return;
        }
      }
      // Fallback to seed menu items for instant local testing
      const fallback =
        FALLBACK_MENU_BY_RESTAURANT[restaurant?.id] ||
        FALLBACK_MENU_BY_RESTAURANT['b1b2c3d4-0001-0001-0001-000000000001'];
      setMenuItems(fallback);
    } catch {
      const fallback =
        FALLBACK_MENU_BY_RESTAURANT[restaurant?.id] ||
        FALLBACK_MENU_BY_RESTAURANT['b1b2c3d4-0001-0001-0001-000000000001'];
      setMenuItems(fallback);
    } finally {
      setLoading(false);
    }
  }, [restaurant?.id]);

  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  // Subscribe to live menu item availability changes (Supabase Realtime)
  useEffect(() => {
    if (!restaurant?.id) return;
    const channel = supabase
      .channel(`menu:${restaurant.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'menu_items',
          filter: `restaurant_id=eq.${restaurant.id}`,
        },
        (payload) => {
          setMenuItems((prev) =>
            prev.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurant?.id]);

  const handleAdd = useCallback((item) => {
    setQuantities((prev) => ({
      ...prev,
      [item.id]: (prev[item.id] || 0) + 1,
    }));
  }, []);

  const handleRemove = useCallback((item) => {
    setQuantities((prev) => {
      const current = prev[item.id] || 0;
      if (current <= 1) {
        const next = { ...prev };
        delete next[item.id];
        return next;
      }
      return { ...prev, [item.id]: current - 1 };
    });
  }, []);

  const selectedItems = menuItems
    .filter((item) => quantities[item.id] > 0 && item.is_available)
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: parseFloat(item.price),
      quantity: quantities[item.id],
    }));

  const totalCount = selectedItems.reduce((sum, i) => sum + i.quantity, 0);
  const totalAmount = selectedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const handleProceedToCart = useCallback(() => {
    navigation.navigate('Cart', {
      restaurant,
      cartItems: selectedItems,
      orderNotes: orderNotes.trim(),
    });
  }, [navigation, restaurant, selectedItems, orderNotes]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FF6B35" />
        <Text style={styles.loadingText}>Loading menu…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={menuItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MenuItemCard
            item={item}
            quantity={quantities[item.id] || 0}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
        )}
        ListHeaderComponent={
          <View style={styles.headerBanner}>
            <Text style={styles.restaurantTitle}>{restaurant?.name || 'Restaurant Menu'}</Text>
            {!!restaurant?.address && (
              <Text style={styles.restaurantAddress}>📍 {restaurant.address}</Text>
            )}
          </View>
        }
        ListFooterComponent={
          <View style={styles.notesSection}>
            <Text style={styles.notesLabel}>Special Instructions / Customizations</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="E.g. Extra shito, less spicy, no onions…"
              placeholderTextColor="#9CA3AF"
              value={orderNotes}
              onChangeText={setOrderNotes}
              multiline
            />
          </View>
        }
        contentContainerStyle={styles.listContent}
      />

      {totalCount > 0 && (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.viewCartButton}
            onPress={handleProceedToCart}
            activeOpacity={0.9}
          >
            <View style={styles.cartCountBadge}>
              <Text style={styles.cartCountText}>{totalCount}</Text>
            </View>
            <Text style={styles.viewCartText}>View Cart & Checkout</Text>
            <Text style={styles.viewCartTotal}>GH₵ {totalAmount.toFixed(2)}</Text>
          </TouchableOpacity>
        </View>
      )}
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
    paddingBottom: 100,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#6B7280',
    fontSize: 14,
  },
  headerBanner: {
    backgroundColor: '#FFF0EB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  restaurantTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  restaurantAddress: {
    fontSize: 13,
    color: '#6B7280',
  },
  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  menuCardUnavailable: {
    opacity: 0.55,
  },
  menuInfo: {
    flex: 1,
    paddingRight: 12,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  itemDescription: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FF6B35',
  },
  addBtn: {
    backgroundColor: '#FFF0EB',
    borderWidth: 1,
    borderColor: '#FF6B35',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  addBtnText: {
    color: '#FF6B35',
    fontWeight: '700',
    fontSize: 14,
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qtyBtn: {
    backgroundColor: '#FF6B35',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  qtyCount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    minWidth: 20,
    textAlign: 'center',
  },
  soldOutBadge: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  soldOutText: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '700',
  },
  notesSection: {
    marginTop: 12,
  },
  notesLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 8,
  },
  notesInput: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    fontSize: 14,
    color: '#1A1A2E',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: 'rgba(248, 249, 250, 0.95)',
  },
  viewCartButton: {
    backgroundColor: '#FF6B35',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 6,
  },
  cartCountBadge: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  cartCountText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  viewCartText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 16,
  },
  viewCartTotal: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 16,
  },
});
