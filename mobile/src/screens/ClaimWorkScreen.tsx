import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Button, Card, Heading, Screen, Subtext } from '../components/ui';
import { useGigsCache } from '../state/GigsCacheContext';
import { BrowseStackParamList } from '../navigation/types';
import { colors, fonts, fontSizes, radii, spacing } from '../theme/tokens';

/** Illustrative — real stake is EscrowRecord.stakeKobo, config per gig
 * (HANDOFF.md §3.5 §11: stake sizing policy is still an open decision). */
const ILLUSTRATIVE_STAKE_BPS = 1000;

/**
 * Screen 11 — Claim + stake + work ★. Professional view, money slice
 * (handoff §11). Proof capture and GPS check-in use the real device
 * camera/location pickers (HANDOFF.md §3.6 evidence discipline) even
 * though submission has nowhere to go yet — Verification/Escrow have no
 * HTTP route (collectProof, holdStake are stubs, PLAN.md).
 */
export default function ClaimWorkScreen({
  route,
}: NativeStackScreenProps<BrowseStackParamList, 'ClaimWork'>) {
  const { gigId } = route.params;
  const { gigs } = useGigsCache();
  const gig = gigs.find((g) => g.id === gigId);
  const [proofUri, setProofUri] = useState<string | null>(null);

  const stakeKobo = Math.round(((gig?.bountyKobo ?? 0) * ILLUSTRATIVE_STAKE_BPS) / 10_000);

  async function pickProof() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!result.canceled && result.assets[0]) setProofUri(result.assets[0].uri);
  }

  return (
    <Screen>
      <Heading>Gig {gig ? gig.id.slice(0, 8) : gigId.slice(0, 8)}</Heading>
      <Subtext>Claimed — stake held</Subtext>

      <Banner tone="warning">
        ★ Money slice — not wired to the server yet. This assumes a stake
        is already held; the stake-payment step itself
        (MatchingStrategy.assignProfessional, EscrowService.holdStake)
        doesn't exist server-side (PLAN.md slice 6). The stake shown below
        is illustrative at 10% — stake sizing policy is an open decision
        (HANDOFF.md §11).
      </Banner>

      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={styles.cardTitle}>Your stake</Text>
        <Text style={styles.stakeAmount}>
          {(stakeKobo / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })}
        </Text>
        <Body style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>Returned in full on sign-off</Body>
      </Card>

      <Text style={styles.sectionTitle}>Definition of done</Text>
      <Body style={{ marginBottom: spacing.md }}>
        Per-criterion checklist isn't fetchable yet — GigsPort has no "get
        criteria" read beyond the bare GigRecord. Once it is, each locked
        criterion gets its own proof-photo attach point here (currently
        one generic upload zone for the whole gig, per the handoff's own
        callout).
      </Body>

      <Pressable onPress={pickProof} style={styles.proofZone}>
        {proofUri ? (
          <Image source={{ uri: proofUri }} style={styles.proofImage} />
        ) : (
          <Text style={styles.proofPrompt}>Tap to attach proof photo</Text>
        )}
      </Pressable>

      <Body style={{ marginTop: spacing.md, marginBottom: spacing.xl }}>
        GPS check-in at arrival/start and in-app chat with the Client are
        both part of the evidence pack (HANDOFF.md §3.6) — not represented
        on this screen yet.
      </Body>

      <Button title="Submit for review" onPress={() => {}} disabled />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textPrimary, marginBottom: 4 },
  stakeAmount: { fontFamily: fonts.serifBold, fontSize: fontSizes.xxl, color: colors.textPrimary },
  sectionTitle: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textPrimary, marginBottom: spacing.sm },
  proofZone: {
    height: 160,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radii.cardSm,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  proofPrompt: { fontFamily: fonts.sans, fontSize: fontSizes.sm, color: colors.textMuted },
  proofImage: { width: '100%', height: '100%' },
});
