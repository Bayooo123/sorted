import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Body, Button, Card, Heading, Screen, Subtext } from '../components/ui';
import { getGig } from '../api/gigs';
import { releaseGig } from '../api/escrow';
import { raiseDispute } from '../api/disputes';
import { ApiError } from '../api/client';
import { GigStackParamList } from '../navigation/types';
import { GigRecord } from '../api/types';
import { fonts, fontSizes, radii, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

/**
 * Screen 07 — Review & sign off ★. Client view, money slice (handoff §07).
 * "Approve" calls POST /gigs/:id/release (EscrowService.releaseToProfessional)
 * — never a client-side-only status flip. "Raise a dispute" calls
 * POST /gigs/:id/dispute, which freezes escrow to dispute_hold; an admin
 * resolves it by hand (no neutral panel in this pilot — see PLAN.md
 * "Release + sign-off flow"). Whole-gig proof review, not per-criterion
 * (v1 simplification, same doc).
 */
export default function ReviewSignOffScreen({
  route,
}: NativeStackScreenProps<GigStackParamList, 'ReviewSignOff'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { gigId } = route.params;
  const [gig, setGig] = useState<GigRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  const [disputing, setDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [disputed, setDisputed] = useState(false);

  useEffect(() => {
    getGig(gigId)
      .then(setGig)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Could not load this gig.'));
  }, [gigId]);

  async function handleApprove() {
    setApproving(true);
    setApproveError(null);
    try {
      await releaseGig(gigId);
      setApproved(true);
    } catch (err) {
      setApproveError(err instanceof ApiError ? err.message : 'Could not release payment — try again.');
    } finally {
      setApproving(false);
    }
  }

  async function handleRaiseDispute() {
    if (disputeReason.trim().length < 10) {
      setDisputeError('Give a bit more detail (at least 10 characters).');
      return;
    }
    setDisputeSubmitting(true);
    setDisputeError(null);
    try {
      await raiseDispute(gigId, disputeReason.trim());
      setDisputed(true);
    } catch (err) {
      setDisputeError(err instanceof ApiError ? err.message : 'Could not raise the dispute — try again.');
    } finally {
      setDisputeSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Screen>
        <Heading>Gig unavailable</Heading>
        <Body style={styles.errorText}>{loadError}</Body>
      </Screen>
    );
  }

  if (approved) {
    return (
      <Screen>
        <Heading>Payment released</Heading>
        <Body style={{ marginTop: spacing.md }}>
          The professional has been paid and their stake returned. This gig is complete.
        </Body>
      </Screen>
    );
  }

  if (disputed) {
    return (
      <Screen>
        <Heading>Dispute raised</Heading>
        <Body style={{ marginTop: spacing.md }}>
          Escrow is frozen — no money moves until this is resolved. Sorted will review and get
          back to you.
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>Review & sign off</Heading>
      <Subtext>{gig ? gig.title : `Gig ${gigId.slice(0, 8)}`}</Subtext>

      <Card style={{ marginBottom: spacing.lg }}>
        <Body style={{ marginBottom: spacing.sm, fontFamily: fonts.sansSemiBold }}>
          Submitted proof
        </Body>
        {gig?.submissionProofBase64 ? (
          <Image source={{ uri: gig.submissionProofBase64 }} style={styles.proofImage} />
        ) : (
          <Body>Waiting for the professional to submit proof.</Body>
        )}
        {gig?.submissionNote ? (
          <Body style={{ marginTop: spacing.sm }}>&ldquo;{gig.submissionNote}&rdquo;</Body>
        ) : null}
        <Body style={{ marginTop: spacing.sm, color: colors.textMuted, fontSize: fontSizes.xs }}>
          One photo for the whole gig, not per-criterion — per-criterion review isn&apos;t built yet.
        </Body>
      </Card>

      {approveError ? <Body style={styles.errorText}>{approveError}</Body> : null}
      <Button
        title="Approve & release payment"
        onPress={handleApprove}
        loading={approving}
        disabled={!gig?.submissionProofBase64}
      />
      <View style={{ height: spacing.md }} />

      {!disputing ? (
        <Button title="Raise a dispute" onPress={() => setDisputing(true)} variant="destructive" />
      ) : (
        <>
          <TextInput
            style={styles.disputeInput}
            placeholder="What's wrong? (at least 10 characters)"
            placeholderTextColor={colors.textMuted}
            value={disputeReason}
            onChangeText={setDisputeReason}
            multiline
          />
          {disputeError ? <Body style={styles.errorText}>{disputeError}</Body> : null}
          <Button
            title="Submit dispute"
            onPress={handleRaiseDispute}
            loading={disputeSubmitting}
            variant="destructive"
          />
        </>
      )}
      <Subtext style={{ marginTop: spacing.sm }}>
        Raising a dispute freezes escrow immediately — Sorted resolves it by hand during this
        pilot, there's no automated arbitration yet.
      </Subtext>
    </Screen>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    proofImage: { width: '100%', height: 200, borderRadius: radii.cardSm, backgroundColor: colors.surface },
    disputeInput: {
      marginBottom: spacing.md,
      minHeight: 70,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.cardSm,
      backgroundColor: colors.surface,
      color: colors.textPrimary,
      padding: spacing.sm,
      fontFamily: fonts.sans,
      fontSize: fontSizes.sm,
      textAlignVertical: 'top',
    },
    errorText: { color: colors.error, marginBottom: spacing.md },
  });
}
