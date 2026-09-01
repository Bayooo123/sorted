import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Banner, Body, Card, Heading, Pill, Screen, Subtext } from '../components/ui';
import { listGigs } from '../api/gigs';
import { ApiError } from '../api/client';
import { BrowseStackParamList } from '../navigation/types';
import { GigRecord } from '../api/types';
import { fonts, fontSizes, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

/**
 * Screen 10 — Browse / market feed. Professional view, Matching module
 * (handoff §10). Backed by the real public GET /gigs?status=open now
 * (PLAN.md slice 5) — the server already excludes draft gigs regardless
 * of what status is requested, so this never needs to filter that itself.
 */
export default function BrowseMarketScreen({
  navigation,
}: NativeStackScreenProps<BrowseStackParamList, 'BrowseMarket'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [gigs, setGigs] = useState<GigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listGigs({ status: 'open' })
      .then(setGigs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load open gigs — try again'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  return (
    <Screen>
      <Heading>Open gigs</Heading>
      <Subtext>FixedPriceAccept — first credible claim wins</Subtext>

      {error ? <Banner tone="warning">{error}</Banner> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.greenPrimary} />
        </View>
      ) : gigs.length === 0 ? (
        <View style={styles.center}>
          <Body style={{ textAlign: 'center' }}>No open gigs right now.</Body>
        </View>
      ) : (
        <FlatList
          data={gigs}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ gap: spacing.md }}
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate('ClaimWork', { gigId: item.id })}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  <Pill label={item.matchingStrategy} />
                </View>
                <Text style={styles.location} numberOfLines={1}>{item.locationText}</Text>
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    title: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
    location: { fontFamily: fonts.sans, fontSize: fontSizes.sm, color: colors.textMuted, marginBottom: spacing.xs },
    bounty: { fontFamily: fonts.serifBold, fontSize: fontSizes.lg, color: colors.textPrimary },
  });
}
