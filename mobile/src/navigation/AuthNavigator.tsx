import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SignInScreen from '../screens/SignInScreen';
import AccountTypeScreen from '../screens/AccountTypeScreen';
import { AuthStackParamList } from './types';
import { useAuth, isMidSignup } from '../auth/AuthContext';
import { colors } from '../theme/tokens';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/**
 * Signed-out flow (screen 01, login/signup combined), plus screen 03 for a
 * signed-in-but-mid-signup user (roles: []) — RootNavigator routes here in
 * both cases rather than duplicating AccountType into the main tab tree.
 */
export default function AuthNavigator() {
  const { user } = useAuth();
  const midSignup = isMidSignup(user);

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgApp },
      }}
    >
      {midSignup ? (
        <Stack.Screen name="AccountType" component={AccountTypeScreen} />
      ) : (
        <>
          <Stack.Screen name="SignIn" component={SignInScreen} />
          <Stack.Screen name="AccountType" component={AccountTypeScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
