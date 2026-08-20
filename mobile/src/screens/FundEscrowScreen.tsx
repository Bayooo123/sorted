import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Button, Card, Heading, Screen, Subtext } from '../components/ui';
import { useGigsCache } from '../state/GigsCacheContext';
import { GigStackParamList } from '../navigation/types';
import { colors, fonts, fontSizes, spacing } from '../theme/tokens';

/** Illustrative only — real platform_fee_bps is config PER GIG (HANDOFF.md
 * §3.5), returned by EscrowService.fundGig() once slice 4 exists. There is
 * no Escrow HTTP controller yet, so this can't be fetched for real. */
const ILLUSTRATIVE_FEE_BPS = 1000; // 10%, matches the worked example in HANDOFF.md §5
const ILLUSTRATIVE_STAKE_BPS = 1000; // ~10%, HANDOFF.md §3.5 "why the stake exists"

function formatNaira(kobo: number) {
  return (kobo / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
}

/** Screen 06 — Fund escrow ★. Client view, money slice (handoff §06). */
export default function FundEscrowScreen({
  route,
}: NativeStackScreenProps<GigStackParamList, 'FundEscrow'>) {
  const { gigId } = route.params;
  const { gigs } = useGigsCache();
  const gig = gigs.find((g) => g.id === gigId);

  const bountyKobo = gig?.bountyKobo ?? 0;
  const feeKobo = Math.round((bountyKobo * ILLUSTRATIVE_FEE_BPS) / 10_000);
  const stakeKobo = Math.round((bountyKobo * ILLUSTRATIVE_STAKE_BPS) / 10_000);

  return (
    <Screen>
      <Heading>Fund escrow</Heading>
      <Subtext>Your gig is published and criteria are locked.</Subtext>

      <Banner tone="warning">
        ★ Money slice — not wired to the server yet. EscrowService.fundGig
        and the Payments module have no HTTP route (PLAN.md: slice 4,
        "first money slice — supervise"). The numbers below are
        illustrative at a 10% fee / 10% stake, matching HANDOFF.md §5's
        worked example — they must bind to the real per-gig
        platform_fee_bps once that slice ships, not stay hardcoded.
      </Banner>

      <Card>
        <Row label="Bounty" value={formatNaira(bountyKobo)} />
        <Row label="Professional stake (returned on sign-off)" value={formatNaira(stakeKobo)} muted />
        <Row label="Platform fee" value={formatNaira(feeKobo)} muted />
        <View style={styles.divider} />
        <Row label="You pay now" value={formatNaira(bountyKobo)} bold />
      </Card>

      <View style={{ height: spacing.lg }} />
      <Body style={{ marginBottom: spacing.md }}>
        Payment method: real screen needs Monnify's funding UI (virtual
        account / bank transfer instructions) once slice 4 wires it up —
        not a card-style selector.
      </Body>

      <Button title="Authorize funding" onPress={() => {}} disabled />
    </Screen>
  );
}

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowLabelMuted]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowValueBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  rowLabel: { fontFamily: fonts.sans, fontSize: fontSizes.base, color: colors.textBody, flex: 1, paddingRight: spacing.sm },
  rowLabelMuted: { color: colors.textMuted, fontSize: fontSizes.sm },
  rowValue: { fontFamily: fonts.sansMedium, fontSize: fontSizes.base, color: colors.textPrimary },
  rowValueBold: { fontFamily: fonts.serifBold, fontSize: fontSizes.lg },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
});
