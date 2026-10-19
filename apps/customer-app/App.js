/**
 * OpenFood Customer App — Entry Point
 *
 * Sets up React Navigation with a stack navigator:
 *   Home (Restaurant Discovery) → Menu (Item Customizer) → Cart (Checkout) → Tracking (Live OSM Map)
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import HomeScreen from './src/screens/HomeScreen';
import MenuScreen from './src/screens/MenuScreen';
import CartScreen from './src/screens/CartScreen';
import TrackingScreen from './src/screens/TrackingScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" backgroundColor="#FF6B35" />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#FF6B35',
          },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: {
            fontWeight: 'bold',
            fontSize: 18,
          },
        }}
      >
        {/* Home — Restaurant discovery feed */}
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: '🍽️ OpenFood' }}
        />

        {/* Menu — Browse items & customize */}
        <Stack.Screen
          name="Menu"
          component={MenuScreen}
          options={({ route }) => ({
            title: route.params?.restaurant?.name || 'Menu 📋',
          })}
        />

        {/* Cart — Review and place order */}
        <Stack.Screen
          name="Cart"
          component={CartScreen}
          options={{ title: 'Your Cart 🛒' }}
        />

        {/* Tracking — Live OpenStreetMap delivery tracking */}
        <Stack.Screen
          name="Tracking"
          component={TrackingScreen}
          options={{ title: 'Track Your Order 📍' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
