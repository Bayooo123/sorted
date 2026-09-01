import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Banner, Body, Button, Card, Heading, Pill, Screen, Subtext } from '../components/ui';
import { listMyGigs } from '../api/gigs';
import { ApiError } from '../api/client';
import { GigStackParamList } from '../navigation/types';
import { GigRecord } from '../api/types';
import { fonts, fontSizes, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

const STATUS_LABEL: Record<GigRecord['status'], string> = {
  draft: 'Draft',
  escrow_pending: 'Awaiting funding',
  open: 'Open — matching',
  claimed: 'Claimed',
  in_progress: 'In progress',
  submitted: 'Awaiting sign-off',
  signed_off: 'Signed off',
  disputed: 'Disputed',
  released: 'Complete',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

/** Screen 04 — Home / gig feed. Client view (handoff §04). Backed by the real GET /gigs/mine now (PLAN.md slice 5). */
export default function HomeFeedScreen({
  navigation,
}: NativeStackScreenProps<GigStackParamList, 'HomeFeed'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [gigs, setGigs] = useState<GigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listMyGigs()
      .then(setGigs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your gigs — try again'))
      .finally(() => setLoading(false));
  }, []);

  // Refetch every time this screen gains focus — e.g. right after posting
  // a gig on PostGigScreen, or coming back from FundEscrow/ReviewSignOff
  // having changed a gig's status.
  useFocusEffect(load);

  return (
    <Screen>
      <Heading>Your gigs</Heading>
      <Subtext>Everything you've posted</Subtext>

      {error ? <Banner tone="warning">{error}</Banner> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.greenPrimary} />
        </View>
      ) : gigs.length === 0 ? (
        <View style={styles.center}>
          <Body style={{ textAlign: 'center', marginBottom: spacing.lg }}>
            No gigs posted yet. Tap below to post your first one.
          </Body>
        </View>
      ) : (
        <FlatList
          data={gigs}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ gap: spacing.md }}
          renderItem={({ item }) => (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={styles.gigTitle} numberOfLines={1}>{item.title}</Text>
                <Pill label={STATUS_LABEL[item.status]} tone={item.status === 'open' ? 'active' : 'neutral'} />
              </View>
              <Text style={styles.gigBounty}>{(item.bountyKobo / 100).toLocaleString('en-NG', {
                style: 'currency',
                currency: 'NGN',
                maximumFractionDigits: 0,
              })}</Text>
              {item.status === 'escrow_pending' ? (
                <Pressable onPress={() => navigation.navigate('FundEscrow', { gigId: item.id })}>
                  <Text style={styles.link}>Fund escrow →</Text>
                </Pressable>
              ) : null}
              {item.status === 'submitted' ? (
                <Pressable onPress={() => navigation.navigate('ReviewSignOff', { gigId: item.id })}>
                  <Text style={styles.link}>Review & sign off →</Text>
                </Pressable>
              ) : null}
            </Card>
          )}
        />
      )}

      <View style={{ marginTop: spacing.lg }}>
        <Button title="Post a gig" onPress={() => navigation.navigate('PostGig')} />
      </View>
    </Screen>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    gigTitle: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
    gigBounty: { fontFamily: fonts.serifBold, fontSize: fontSizes.lg, color: colors.textPrimary, marginBottom: spacing.xs },
    link: { fontFamily: fonts.sansMedium, fontSize: fontSizes.sm, color: colors.greenPrimary, marginTop: spacing.xs },
  });
}
