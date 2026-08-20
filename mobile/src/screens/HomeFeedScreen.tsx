import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Button, Card, Heading, Pill, Screen, Subtext } from '../components/ui';
import { useGigsCache } from '../state/GigsCacheContext';
import { GigStackParamList } from '../navigation/types';
import { GigRecord } from '../api/types';
import { colors, fonts, fontSizes, spacing } from '../theme/tokens';

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

/** Screen 04 — Home / gig feed. Client view (handoff §04). */
export default function HomeFeedScreen({
  navigation,
}: NativeStackScreenProps<GigStackParamList, 'HomeFeed'>) {
  const { gigs } = useGigsCache();

  return (
    <Screen>
      <Heading>Your gigs</Heading>
      <Subtext>Posted by you, this session</Subtext>

      <Banner>
        There's no "list my gigs" endpoint yet (GigsService.listGigs is
        still a stub — PLAN.md slice 5). This shows gigs you've posted in
        this app session only; nothing is fetched from the server here.
      </Banner>

      {gigs.length === 0 ? (
        <View style={styles.empty}>
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
                <Text style={styles.gigTitle}>Gig {item.id.slice(0, 8)}</Text>
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

const styles = StyleSheet.create({
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  gigTitle: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textPrimary },
  gigBounty: { fontFamily: fonts.serifBold, fontSize: fontSizes.lg, color: colors.textPrimary, marginBottom: spacing.xs },
  link: { fontFamily: fonts.sansMedium, fontSize: fontSizes.sm, color: colors.greenPrimary, marginTop: spacing.xs },
});
