import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Body, Button, Heading, Screen, Subtext, TextField } from '../components/ui';
import { completeRoleProfile, listSubmarkets } from '../api/identity';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Role, Submarket } from '../api/types';
import { fonts, fontSizes, radii, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [accountType, setAccountType] = useState<AccountType>('hybrid');
  const [submarkets, setSubmarkets] = useState<Submarket[]>([]);
  const [offering, setOffering] = useState<Set<string>>(new Set());
  const [seeking, setSeeking] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { refreshUser } = useAuth();

  // PLAN.md "Individual vs business accounts" — only relevant once
  // "professional" is one of the selected roles (a business account is a
  // registered service provider, e.g. a dry cleaner; a client-only
  // account has no company to register). This same flow is reused as the
  // conversion path for an already-registered account — see
  // ConvertToBusinessScreen (Settings), which calls completeRoleProfile
  // the same way with the user's existing roles/submarkets preserved.
  const [isBusiness, setIsBusiness] = useState(false);
  const [companyRegistrationNumber, setCompanyRegistrationNumber] = useState('');
  const [directorNamesText, setDirectorNamesText] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');

  useEffect(() => {
    listSubmarkets()
      .then(setSubmarkets)
      .catch(() => setSubmarkets([]));
  }, []);

  const roles = ROLES_BY_TYPE[accountType];
  const needsOffering = roles.includes('professional');
  const needsSeeking = roles.includes('client');
  const directorNames = directorNamesText
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const businessFieldsComplete =
    !needsOffering ||
    !isBusiness ||
    (companyRegistrationNumber.trim().length > 0 &&
      directorNames.length > 0 &&
      businessEmail.trim().length > 0 &&
      businessPhone.trim().length > 0 &&
      businessAddress.trim().length > 0);
  const canSubmit =
    (!needsOffering || offering.size > 0) && (!needsSeeking || seeking.size > 0) && businessFieldsComplete;

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
        accountType: needsOffering && isBusiness ? 'business' : undefined,
        businessProfile:
          needsOffering && isBusiness
            ? {
                companyRegistrationNumber: companyRegistrationNumber.trim(),
                directorNames,
                businessEmail: businessEmail.trim(),
                businessPhone: businessPhone.trim(),
                businessAddress: businessAddress.trim(),
              }
            : undefined,
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
              styles={styles}
            />
          </View>
        ) : null}

        {needsOffering ? (
          <View style={styles.section}>
            <Body style={styles.sectionTitle}>Are you registering as an individual or a business?</Body>
            <Subtext style={{ marginBottom: spacing.sm }}>
              Business is for a registered company (e.g. a dry-cleaning shop) — individual is for a sole operator.
            </Subtext>
            <View style={styles.typeRow}>
              {([false, true] as const).map((business) => (
                <Pressable
                  key={String(business)}
                  onPress={() => setIsBusiness(business)}
                  style={[styles.typeCard, isBusiness === business && styles.typeCardActive]}
                >
                  <Text style={[styles.typeLabel, isBusiness === business && styles.typeLabelActive]}>
                    {business ? 'Business' : 'Individual'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {isBusiness ? (
              <View style={{ marginTop: spacing.md }}>
                <TextField
                  label="Company registration number"
                  value={companyRegistrationNumber}
                  onChangeText={setCompanyRegistrationNumber}
                  autoCapitalize="characters"
                />
                <TextField
                  label="Director name(s) — comma-separated if more than one"
                  value={directorNamesText}
                  onChangeText={setDirectorNamesText}
                />
                <TextField
                  label="Business contact email"
                  value={businessEmail}
                  onChangeText={setBusinessEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextField
                  label="Business contact phone"
                  value={businessPhone}
                  onChangeText={setBusinessPhone}
                  keyboardType="phone-pad"
                />
                <TextField
                  label="Business address"
                  value={businessAddress}
                  onChangeText={setBusinessAddress}
                />
              </View>
            ) : null}
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
              styles={styles}
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
  styles,
}: {
  submarkets: Submarket[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  styles: ReturnType<typeof createStyles>;
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
}
