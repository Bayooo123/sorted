import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Body, Button, Heading, Screen, Subtext } from '../components/ui';
import { completeRoleProfile, listSubmarkets } from '../api/identity';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Role, Submarket } from '../api/types';
import { colors, fonts, fontSizes, radii, spacing } from '../theme/tokens';

type AccountType = 'professional' | 'client' | 'hybrid';

const ROLES_BY_TYPE: Record<AccountType, Role[]> = {
  professional: ['professional'],
  client: ['client'],
  hybrid: ['client', 'professional'],
};

/**
 * Screen 03 — Account type. Professional / Client / Hybrid, Hybrid
 * recommended default (handoff §03). The handoff flags the "fill in both
 * lists" step as not yet designed on the reference screen — implemented
 * here as a second step on the same screen, since the real
 * completeRoleProfile endpoint 400s if a required list is empty for
 * either selected role (identity.service.ts) — there's no "fill in
 * later" the app can rely on.
 */
export default function AccountTypeScreen() {
  const [accountType, setAccountType] = useState<AccountType>('hybrid');
  const [submarkets, setSubmarkets] = useState<Submarket[]>([]);
  const [offering, setOffering] = useState<Set<string>>(new Set());
  const [seeking, setSeeking] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { refreshUser } = useAuth();

  useEffect(() => {
    listSubmarkets()
      .then(setSubmarkets)
      .catch(() => setSubmarkets([]));
  }, []);

  const roles = ROLES_BY_TYPE[accountType];
  const needsOffering = roles.includes('professional');
  const needsSeeking = roles.includes('client');
  const canSubmit =
    (!needsOffering || offering.size > 0) && (!needsSeeking || seeking.size > 0);

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  async function handleContinue() {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await completeRoleProfile({
        roles,
        serviceOfferingSubmarketIds: needsOffering ? Array.from(offering) : undefined,
        seekingCategorySubmarketIds: needsSeeking ? Array.from(seeking) : undefined,
      });
      await refreshUser();
      // RootNavigator switches to Main once roles is non-empty.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Heading>What brings you to Sorted?</Heading>
        <Subtext>Hybrid is recommended — you can post gigs and get hired.</Subtext>

        <View style={styles.typeRow}>
          {(['professional', 'client', 'hybrid'] as AccountType[]).map((type) => (
            <Pressable
              key={type}
              onPress={() => setAccountType(type)}
              style={[styles.typeCard, accountType === type && styles.typeCardActive]}
            >
              <Text style={[styles.typeLabel, accountType === type && styles.typeLabelActive]}>
                {type === 'professional' ? 'Professional' : type === 'client' ? 'Client' : 'Hybrid'}
              </Text>
              {type === 'hybrid' ? <Text style={styles.typeBadge}>Recommended</Text> : null}
            </Pressable>
          ))}
        </View>

        {needsOffering ? (
          <View style={styles.section}>
            <Body style={styles.sectionTitle}>What services do you offer?</Body>
            <Subtext style={{ marginBottom: spacing.sm }}>Pick at least one — required, no skipping.</Subtext>
            <CategoryGrid
              submarkets={submarkets}
              selected={offering}
              onToggle={(id) => toggle(offering, setOffering, id)}
            />
          </View>
        ) : null}

        {needsSeeking ? (
          <View style={styles.section}>
            <Body style={styles.sectionTitle}>What are you most likely to post gigs for?</Body>
            <Subtext style={{ marginBottom: spacing.sm }}>Pick at least one — required, no skipping.</Subtext>
            <CategoryGrid
              submarkets={submarkets}
              selected={seeking}
              onToggle={(id) => toggle(seeking, setSeeking, id)}
            />
          </View>
        ) : null}

        {error ? <Banner tone="warning">{error}</Banner> : null}

        <Button title="Finish setup" onPress={handleContinue} loading={loading} disabled={!canSubmit} />
      </ScrollView>
    </Screen>
  );
}

function CategoryGrid({
  submarkets,
  selected,
  onToggle,
}: {
  submarkets: Submarket[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (submarkets.length === 0) {
    return <Subtext>Loading categories…</Subtext>;
  }
  return (
    <View style={styles.chipWrap}>
      {submarkets.map((s) => {
        const active = selected.has(s.id);
        return (
          <Pressable
            key={s.id}
            onPress={() => onToggle(s.id)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  typeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  typeCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.cardSm,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  typeCardActive: { borderColor: colors.greenPrimary, backgroundColor: colors.greenMintBg },
  typeLabel: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textBody },
  typeLabelActive: { color: colors.greenDeep },
  typeBadge: { fontFamily: fonts.sans, fontSize: 10, color: colors.greenDeep },
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontFamily: fonts.sansSemiBold, marginBottom: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
