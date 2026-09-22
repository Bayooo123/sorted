import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Button, Card, Heading, Pill, Screen, Subtext } from '../components/ui';
import { listProfessionals, listSubmarkets } from '../api/identity';
import { ApiError } from '../api/client';
import { GigStackParamList } from '../navigation/types';
import { ProfessionalDirectoryEntry, Submarket } from '../api/types';
import { fonts, fontSizes, radii, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

/**
 * PLAN.md "Professional directory" — clients browse professionals BY
 * CATEGORY (category-only for v1, no location filter). Distinct from
 * BrowseMarketScreen, which lists open GIGS for professionals, not
 * people. "Hire" doesn't contact a professional directly — it opens
 * PostGig pre-filled with that professional invited (restrictedToProfessionalId),
 * so the job still goes through escrow, same as every other gig.
 */
export default function DirectoryScreen({
  navigation,
}: NativeStackScreenProps<GigStackParamList, 'Directory'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [submarkets, setSubmarkets] = useState<Submarket[]>([]);
  const [submarketKey, setSubmarketKey] = useState<string | null>(null);
  const [professionals, setProfessionals] = useState<ProfessionalDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSubmarkets()
      .then((s) => {
        setSubmarkets(s);
        if (s[0]) setSubmarketKey(s[0].key);
      })
      .catch(() => setError('Could not load categories — check your connection and try again.'));
  }, []);

  useEffect(() => {
    if (!submarketKey) return;
    setLoading(true);
    setError(null);
    listProfessionals(submarketKey)
      .then(setProfessionals)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load professionals — try again'))
      .finally(() => setLoading(false));
  }, [submarketKey]);

  return (
    <Screen>
      <Heading>Find a professional</Heading>
      <Subtext>Browse by category, then hire straight into an escrow-protected gig.</Subtext>

      <View style={styles.chipWrap}>
        {submarkets.map((s) => {
          const active = s.key === submarketKey;
          return (
            <Pressable
              key={s.key}
              onPress={() => setSubmarketKey(s.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Banner tone="warning">{error}</Banner> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.greenPrimary} />
        </View>
      ) : professionals.length === 0 ? (
        <View style={styles.center}>
          <Body style={{ textAlign: 'center' }}>No professionals in this category yet.</Body>
        </View>
      ) : (
        <FlatList
          data={professionals}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ gap: spacing.md }}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.row}>
                <View style={styles.avatarWrap}>
                  {item.avatarBase64 ? (
                    <Image source={{ uri: item.avatarBase64 }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarInitial}>{item.displayName.charAt(0).toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.name}>{item.displayName}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                    {item.accountType === 'business' ? <Pill label="Business" /> : null}
                    {item.kycStatus === 'verified' ? <Pill label="Verified" tone="active" /> : null}
                  </View>
                </View>
              </View>
              <View style={{ marginTop: spacing.md }}>
                <Button
                  title="Hire"
                  onPress={() =>
                    navigation.navigate('PostGig', {
                      hireProfessionalId: item.id,
                      hireProfessionalName: item.displayName,
                      hireSubmarketKey: submarketKey ?? undefined,
                    })
                  }
                />
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xl },
    row: { flexDirection: 'row', alignItems: 'center' },
    avatarWrap: {
      width: 44,
      height: 44,
      borderRadius: 999,
      backgroundColor: colors.greenMintBg,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: { width: 44, height: 44 },
    avatarInitial: { fontFamily: fonts.serifBold, fontSize: fontSizes.lg, color: colors.greenDeep },
    name: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textPrimary },
  });
}
