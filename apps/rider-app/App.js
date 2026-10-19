/**
 * OpenFood Rider App — Entry Point
 *
 * IMPORTANT: The background location task must be imported at the top level
 * of the entry point so that expo-task-manager can register it before the
 * app finishes launching. This is a hard requirement of the expo-task-manager
 * library — do not move this import.
 */

import './src/tasks/locationTask'; // registers the background task — KEEP AT TOP

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import DashboardScreen from './src/screens/DashboardScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" backgroundColor="#0F172A" />
      <Stack.Navigator
        initialRouteName="Dashboard"
        screenOptions={{
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: 'bold', fontSize: 18 },
        }}
      >
        <Stack.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ title: '🛵 OpenFood Rider' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
