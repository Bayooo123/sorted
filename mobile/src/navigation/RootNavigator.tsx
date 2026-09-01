import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import AuthNavigator from './AuthNavigator';
import MainNavigator from './MainNavigator';
import { isMidSignup, useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';

export default function RootNavigator() {
  const { user } = useAuth();
  const { colors } = useTheme();

  if (user === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgApp, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.greenPrimary} />
      </View>
    );
  }

  const showMain = !!user && !isMidSignup(user);

  return <NavigationContainer>{showMain ? <MainNavigator /> : <AuthNavigator />}</NavigationContainer>;
}
