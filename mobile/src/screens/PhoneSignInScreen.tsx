import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Button, Heading, Screen, Subtext, TextField } from '../components/ui';
import { requestOtp } from '../api/identity';
import { ApiError } from '../api/client';
import { AuthStackParamList } from '../navigation/types';

/** Screen 01 — Phone sign-in. Entry point, both roles (handoff §01). */
export default function PhoneSignInScreen({
  navigation,
}: NativeStackScreenProps<AuthStackParamList, 'PhoneSignIn'>) {
  const [localNumber, setLocalNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const phone = `+234${localNumber.replace(/^0+/, '')}`;
  const isValid = /^\d{7,11}$/.test(localNumber.replace(/\s/g, ''));

  async function handleContinue() {
    if (!isValid) {
      setError('Enter a valid Nigerian phone number');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { requestId } = await requestOtp(phone);
      navigation.navigate('OtpVerify', { phone, requestId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Heading>Consider it sorted.</Heading>
        <Subtext>Enter your phone number to sign in or create an account.</Subtext>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
          <View style={{ width: 72 }}>
            <TextField value="+234" editable={false} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              placeholder="801 234 5678"
              keyboardType="phone-pad"
              value={localNumber}
              onChangeText={setLocalNumber}
              error={error ?? undefined}
              autoFocus
            />
          </View>
        </View>

        {error ? null : (
          <Body style={{ color: '#7E8F8D', fontSize: 12.5, marginBottom: 16 }}>
            No email or password — just your number.
          </Body>
        )}

        <Button title="Continue" onPress={handleContinue} loading={loading} disabled={!isValid} />
      </View>
    </Screen>
  );
}
