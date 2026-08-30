import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Button, Heading, Screen, Subtext, TextField } from '../components/ui';
import { login, signup } from '../api/identity';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthStackParamList } from '../navigation/types';
import { colors, fonts, fontSizes, radii, spacing } from '../theme/tokens';

// Keep in sync with server/src/common/nigerian-states.ts.
const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = 'login' | 'signup';

/**
 * Screen 01 — Sign in. Entry point, both roles (handoff §01). Replaces
 * the earlier phone+OTP flow (PhoneSignInScreen/OtpVerifyScreen) — auth
 * moved to email/phone + password, see PLAN.md "Password-based auth".
 */
export default function SignInScreen(_props: NativeStackScreenProps<AuthStackParamList, 'SignIn'>) {
  const [mode, setMode] = useState<Mode>('login');
  const { signIn } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleLogin() {
    if (!identifier.trim() || !loginPassword) {
      setError('Enter your email or phone number and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { accessToken, user } = await login(identifier.trim(), loginPassword);
      await signIn(accessToken, user);
      // Routing handled by RootNavigator watching `user` — mid-signup
      // (roles: []) lands on AccountType, an existing account lands on
      // Home/Browse.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    if (!name.trim()) {
      setError('Enter your full name.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (!phone.trim()) {
      setError('Enter your phone number.');
      return;
    }
    if (!state) {
      setError('Select your state.');
      return;
    }
    if (signupPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { accessToken, user } = await signup({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        state,
        password: signupPassword,
      });
      await signIn(accessToken, user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Heading>Consider it sorted.</Heading>
        <Subtext>Log in or create an account to get started.</Subtext>

        <View style={styles.tabRow}>
          <Pressable style={[styles.tab, mode === 'login' && styles.tabActive]} onPress={() => switchMode('login')}>
            <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Log in</Text>
          </Pressable>
          <Pressable style={[styles.tab, mode === 'signup' && styles.tabActive]} onPress={() => switchMode('signup')}>
            <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Sign up</Text>
          </Pressable>
        </View>

        {mode === 'login' ? (
          <>
            <TextField
              placeholder="Email or phone number"
              autoCapitalize="none"
              autoCorrect={false}
              value={identifier}
              onChangeText={setIdentifier}
              autoFocus
            />
            <TextField
              placeholder="Password"
              secureTextEntry
              value={loginPassword}
              onChangeText={setLoginPassword}
            />
          </>
        ) : (
          <>
            <TextField placeholder="Full name" value={name} onChangeText={setName} autoFocus />
            <TextField
              placeholder="you@email.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextField placeholder="Phone number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            <TextField value="Nigeria" editable={false} />
            <Text style={styles.stateLabel}>State</Text>
            <View style={styles.chipWrap}>
              {NIGERIAN_STATES.map((s) => {
                const active = state === s;
                return (
                  <Pressable key={s} onPress={() => setState(s)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextField
              placeholder="Password (min. 8 characters)"
              secureTextEntry
              value={signupPassword}
              onChangeText={setSignupPassword}
            />
          </>
        )}

        {error ? <Banner tone="warning">{error}</Banner> : null}

        <Button
          title={mode === 'login' ? 'Log in' : 'Sign up'}
          onPress={mode === 'login' ? handleLogin : handleSignup}
          loading={loading}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.bgApp,
    borderRadius: 12,
    padding: 4,
    marginBottom: spacing.lg,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabActive: { backgroundColor: colors.surface },
  tabText: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textMuted },
  tabTextActive: { color: colors.textPrimary },
  stateLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: fontSizes.sm,
    color: colors.textBody,
    marginBottom: spacing.xs,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.greenBright, backgroundColor: colors.greenMintBg },
  chipText: { fontFamily: fonts.sans, fontSize: fontSizes.sm, color: colors.textBody },
  chipTextActive: { color: colors.greenDeep, fontFamily: fonts.sansMedium },
});
