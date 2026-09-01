import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts as useInterFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts as useLoraFonts, Lora_600SemiBold, Lora_700Bold } from '@expo-google-fonts/lora';
import { AuthProvider } from './src/auth/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

function AppInner() {
  const { mode, colors } = useTheme();
  const [interLoaded] = useInterFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [loraLoaded] = useLoraFonts({ Lora_600SemiBold, Lora_700Bold });

  if (!interLoaded || !loraLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgApp, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.greenPrimary} />
      </View>
    );
  }

  return (
    <AuthProvider>
      <RootNavigator />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppInner />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
