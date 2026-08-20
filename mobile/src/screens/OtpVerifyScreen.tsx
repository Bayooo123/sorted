import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Body, Button, Heading, Screen, Subtext, TextField } from '../components/ui';
import { requestOtp, verifyOtp } from '../api/identity';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthStackParamList } from '../navigation/types';
import { colors, fonts } from '../theme/tokens';

/** Screen 02 — OTP verify. Both roles (handoff §02). */
export default function OtpVerifyScreen({
  route,
  navigation,
}: NativeStackScreenProps<AuthStackParamList, 'OtpVerify'>) {
  const { phone, requestId: initialRequestId } = route.params;
  const [requestId, setRequestId] = useState(initialRequestId);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const { signIn } = useAuth();

  async function submit(fullCode: string) {
    setError(null);
    setLoading(true);
    try {
      const { accessToken, user } = await verifyOtp(requestId, fullCode);
      await signIn(accessToken, user);
      // Routing handled by RootNavigator watching `user` — mid-signup
      // (roles: []) lands on AccountType, an existing account lands on
      // Home/Browse. This is the "number already registered -> different
      // flow" edge case from the handoff, resolved by what the server
      // returns rather than guessed client-side.
    } catch (err) {
      setCode('');
      setError(err instanceof ApiError ? err.message : 'Incorrect code — try again');
    } finally {
      setLoading(false);
    }
  }

  function handleChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) submit(digits);
  }

  async function handleResend() {
    setResending(true);
    setError(null);
    try {
      const res = await requestOtp(phone);
      setRequestId(res.requestId);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend — try again');
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Heading>Enter the code</Heading>
        <Subtext>We sent a 6-digit code to {phone}</Subtext>

        <TextField
          value={code}
          onChangeText={handleChange}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          error={error ?? undefined}
          style={{ letterSpacing: 8, fontSize: 22, textAlign: 'center' }}
          placeholder="000000"
        />

        <Button title="Verify" onPress={() => submit(code)} loading={loading} disabled={code.length !== 6} />

        <Body
          onPress={resending ? undefined : handleResend}
          style={{
            marginTop: 20,
            textAlign: 'center',
            color: colors.greenPrimary,
            fontFamily: fonts.sansMedium,
          }}
        >
          {resending ? 'Sending…' : "Didn't get a code? Resend"}
        </Body>
      </View>
    </Screen>
  );
}
