import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Card, Heading, Pill, Screen, Subtext } from '../components/ui';
import { useGigsCache } from '../state/GigsCacheContext';
import { BrowseStackParamList } from '../navigation/types';
import { colors, fonts, fontSizes, spacing } from '../theme/tokens';

type DevPreviewState = 'loaded' | 'empty' | 'loading';

/**
 * Screen 10 — Browse / market feed. Professional view, Matching module
 * (handoff §10). The handoff's reference build has loaded/empty/loading
 * toggle buttons "for review; remove those toggles in the shipped
 * build" — kept here gated behind __DEV__ for the same reason, off in a
 * production build.
 */
export default function BrowseMarketScreen({
  navigation,
}: NativeStackScreenProps<BrowseStackParamList, 'BrowseMarket'>) {
  const { gigs } = useGigsCache();
  const [devState, setDevState] = useState<DevPreviewState>('loaded');
  const openGigs = gigs.filter((g) => g.status === 'open');

  const effectiveState: DevPreviewState = __DEV__ ? devState : openGigs.length === 0 ? 'empty' : 'loaded';

  return (
    <Screen>
      <Heading>Open gigs</Heading>
      <Subtext>FixedPriceAccept — first credible claim wins</Subtext>

      <Banner>
        GigsService.listGigs is still a stub (PLAN.md slice 5), so this
        reads from gigs published in this app session instead of a real
        server-side open-gigs list. Claiming isn't wired either — Matching/
        Escrow have no HTTP route (assignProfessional, holdStake are
        stubs).
      </Banner>

      {__DEV__ ? (
        <View style={styles.devToggleRow}>
          {(['loaded', 'empty', 'loading'] as DevPreviewState[]).map((s) => (
            <Pressable key={s} onPress={() => setDevState(s)} style={[styles.devToggle, devState === s && styles.devToggleActive]}>
              <Text style={styles.devToggleText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {effectiveState === 'loading' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={colors.greenPrimary} />
        </View>
      ) : effectiveState === 'empty' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Body style={{ textAlign: 'center' }}>No open gigs right now.</Body>
        </View>
      ) : (
        <FlatList
          data={openGigs}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ gap: spacing.md }}
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate('ClaimWork', { gigId: item.id })}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                  <Text style={styles.title}>Gig {item.id.slice(0, 8)}</Text>
                  <Pill label={item.matchingStrategy} />
                </View>
                <Text style={styles.bounty}>
                  {(item.bountyKobo / 100).toLocaleString('en-NG', {
                    style: 'currency',
                    currency: 'NGN',
                    maximumFractionDigits: 0,
                  })}
                </Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  devToggleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  devToggle: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  devToggleActive: { borderColor: colors.greenBright, backgroundColor: colors.greenMintBg },
  devToggleText: { fontFamily: fonts.sans, fontSize: fontSizes.xs, color: colors.textMuted },
  title: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textPrimary },
  bounty: { fontFamily: fonts.serifBold, fontSize: fontSizes.lg, color: colors.textPrimary },
});
