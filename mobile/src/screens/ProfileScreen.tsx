import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner, Body, Button, Card, Heading, Pill, Screen, Subtext, TextField } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { updateProfile } from '../api/identity';
import { ApiError } from '../api/client';
import { colors, fonts, fontSizes, radii, spacing } from '../theme/tokens';

// Keep in sync with server/src/common/nigerian-states.ts.
const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

/** Screen 09 — Profile. Both roles, Reputation module (handoff §09). */
export default function ProfileScreen() {
  const { user, signOut, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const isProfessional = user.roles.includes('professional');
  const isClient = user.roles.includes('client');

  function startEditing() {
    setName(user!.name ?? '');
    setPhone(user!.phone ?? '');
    setState(user!.state ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const input: { name?: string; phone?: string; state?: string } = {};
      if (name.trim()) input.name = name.trim();
      if (phone.trim()) input.phone = phone.trim();
      if (state) input.state = state;

      await updateProfile(input);
      await refreshUser();
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Heading>{user.name ?? user.phone}</Heading>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
        {user.roles.map((r) => (
          <Pill key={r} label={r === 'professional' ? 'Professional' : 'Client'} tone="active" />
        ))}
        <Pill label={`KYC: ${user.kycStatus}`} tone={user.kycStatus === 'verified' ? 'active' : 'neutral'} />
      </View>

      <Banner tone="warning">
        Reputation module has no HTTP route yet (getReputation/
        recordOutcome, HANDOFF.md §3.9). Numbers below are placeholders —
        HANDOFF.md §11 also flags whether Client-side reliability scoring
        ships in v1 at all as still undecided, so don't treat this Client
        variant as final either.
      </Banner>

      {isProfessional ? (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={styles.cardTitle}>Professional track record</Text>
          <StatRow label="Jobs completed" value="—" />
          <StatRow label="Dispute rate" value="—" />
          <StatRow label="No-dispute streak" value="—" />
        </Card>
      ) : null}

      {isClient ? (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={styles.cardTitle}>Client reliability</Text>
          <StatRow label="On-time sign-off rate" value="—" />
          <StatRow label="Dispute rate" value="—" />
          <StatRow label="Dispute loss rate" value="—" />
        </Card>
      ) : null}

      <Card style={{ marginBottom: spacing.xl }}>
        <Text style={styles.cardTitle}>Account</Text>

        {editing ? (
          <>
            <TextField label="Name" value={name} onChangeText={setName} />
            <TextField label="Phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
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

            {error ? <Banner tone="warning">{error}</Banner> : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} disabled={saving} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Save" onPress={handleSave} loading={saving} />
              </View>
            </View>
          </>
        ) : (
          <>
            <StatRow label="Phone" value={user.phone ?? '—'} />
            <StatRow label="Email" value={user.email ?? '—'} />
            <StatRow label="State" value={user.state ?? '—'} />
            <StatRow label="Verification & ID" value="Not built yet" />
            <StatRow label="Payout accounts" value="Not built yet" />
            <StatRow label="Skills & services" value="Not built yet" />
            <Body onPress={startEditing} style={styles.editLink}>
              Edit name, phone, state
            </Body>
          </>
        )}
      </Card>

      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textPrimary, marginBottom: spacing.sm },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel: { fontFamily: fonts.sans, fontSize: fontSizes.sm, color: colors.textMuted },
  statValue: { fontFamily: fonts.sansMedium, fontSize: fontSizes.sm, color: colors.textBody },
  editLink: { color: colors.greenPrimary, marginTop: spacing.sm },
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
