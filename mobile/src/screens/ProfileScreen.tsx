import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Banner, Body, Button, Card, Heading, Pill, Screen, Subtext } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { colors, fonts, fontSizes, spacing } from '../theme/tokens';

/** Screen 09 — Profile. Both roles, Reputation module (handoff §09). */
export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  const isProfessional = user.roles.includes('professional');
  const isClient = user.roles.includes('client');

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
        <StatRow label="Phone" value={user.phone} />
        <StatRow label="Verification & ID" value="Not built yet" />
        <StatRow label="Payout accounts" value="Not built yet" />
        <StatRow label="Skills & services" value="Not built yet" />
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
});
