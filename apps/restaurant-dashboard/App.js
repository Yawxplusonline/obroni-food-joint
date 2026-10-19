/**
 * OpenFood Restaurant Dashboard — Entry Point
 *
 * Entry point for the restaurant owner tablet/web dashboard.
 * Uses a simple stack navigator; in a full build this would be a
 * tab navigator with Orders, Menu Management, and Analytics tabs.
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import OrdersScreen from './src/screens/OrdersScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" backgroundColor="#1A1A2E" />
      <Stack.Navigator
        initialRouteName="Orders"
        screenOptions={{
          headerStyle: { backgroundColor: '#1A1A2E' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: 'bold', fontSize: 18 },
        }}
      >
        <Stack.Screen
          name="Orders"
          component={OrdersScreen}
          options={{ title: '📋 Live Orders — OpenFood' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
