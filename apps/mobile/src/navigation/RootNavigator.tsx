import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { WebAppScreen } from '../screens/WebAppScreen';

const RootStack = createNativeStackNavigator<RootStackParamList>();

/**
 * Full website runs inside WebView (same UI as `client/`). Start Vite dev server for local dev.
 */
export function RootNavigator() {
  return (
    <RootStack.Navigator>
      <RootStack.Screen name="WebApp" component={WebAppScreen} options={{ headerShown: false }} />
    </RootStack.Navigator>
  );
}
