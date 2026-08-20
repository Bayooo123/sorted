import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Button, Card, Heading, Screen, Subtext } from '../components/ui';
import { useGigsCache } from '../state/GigsCacheContext';
import { GigStackParamList } from '../navigation/types';
import { colors, fonts, fontSizes, spacing } from '../theme/tokens';

/** Screen 07 — Review & sign off ★. Client view, money slice (handoff §07). */
export default function ReviewSignOffScreen({
  route,
}: NativeStackScreenProps<GigStackParamList, 'ReviewSignOff'>) {
  const { gigId } = route.params;
  const { gigs } = useGigsCache();
  const gig = gigs.find((g) => g.id === gigId);
  const [inspectionRequested, setInspectionRequested] = useState(false);

  return (
    <Screen>
      <Heading>Review & sign off</Heading>
      <Subtext>Gig {gig ? gig.id.slice(0, 8) : gigId.slice(0, 8)}</Subtext>

      <Banner tone="warning">
        ★ Money slice — not wired to the server yet. "Approve" must call
        EscrowService.releaseToProfessional, never flip status
        client-side only; that method and the criteria/proof read are
        stubs until slice 7 (PLAN.md). Nothing below is a real submit.
      </Banner>

      <Card style={{ marginBottom: spacing.lg }}>
        <Body style={{ marginBottom: spacing.sm, fontFamily: fonts.sansSemiBold }}>
          Criteria review isn't wired up yet
        </Body>
        <Body>
          Per-criterion proof photos aren't fetchable — GigsPort has no
          "get criteria + proof" read yet beyond the bare GigRecord. This
          screen will show each locked criterion with its submitted proof
          photo and a met / not-met toggle once slice 6 (proof submission)
          and slice 7 (sign-off) exist.
        </Body>
      </Card>

      <ToggleLink
        label={inspectionRequested ? 'Inspection requested' : 'Request inspection instead'}
        active={inspectionRequested}
        onPress={() => setInspectionRequested((v) => !v)}
      />
      <Body style={{ marginTop: spacing.xs, marginBottom: spacing.xl }}>
        Optional alternative to a straight met/not-met tap — most relevant
        for physical jobs, where a photo alone can misrepresent the result
        (HANDOFF.md §3.6).
      </Body>

      <Button title="Approve & release payment" onPress={() => {}} disabled />
      <View style={{ height: spacing.md }} />
      <Button title="Raise a dispute" onPress={() => {}} variant="destructive" disabled />
      <Subtext style={{ marginTop: spacing.sm }}>
        Raising a dispute freezes Escrow to dispute_hold immediately — that
        frozen-state screen doesn't exist yet either (handoff's "screens
        not yet started" list).
      </Subtext>
    </Screen>
  );
}

function ToggleLink({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Text onPress={onPress} style={[styles.link, active && styles.linkActive]}>
      {active ? '✓ ' : ''}
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: {
    fontFamily: fonts.sansMedium,
    fontSize: fontSizes.sm,
    color: colors.greenPrimary,
  },
  linkActive: { color: colors.greenDeep },
});
