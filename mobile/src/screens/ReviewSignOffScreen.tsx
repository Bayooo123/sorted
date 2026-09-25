import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Button, Card, Heading, Pill, Screen, Subtext } from '../components/ui';
import { getGig } from '../api/gigs';
import { getEscrow, releaseGig } from '../api/escrow';
import { raiseDispute } from '../api/disputes';
import { ApiError } from '../api/client';
import { GigStackParamList } from '../navigation/types';
import { EscrowRecordView, GigRecord } from '../api/types';
import { fonts, fontSizes, radii, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

const POLL_INTERVAL_MS = 4000;

function formatNaira(kobo: number) {
  return (kobo / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
}

/**
 * Screen 07 — Review & sign off ★. Client view, money slice (handoff §07).
 *
 * PLAN.md "Split payment pivot" — "Approve" now does two things that used
 * to be two separate screens: it calls POST /gigs/:id/release
 * (EscrowService.releaseToProfessional), which is the FIRST time any
 * money moves for this gig, and returns where to actually pay
 * (releaseCheckout — a Paystack checkout link, or manual-pilot transfer
 * instructions). This screen then polls GET /gigs/:id/escrow until
 * state === 'released', same polling shape the old FundEscrowScreen used
 * pre-pivot (that screen is gone — there's no separate funding step
 * before a gig can be claimed anymore, see GigsService.publishGig).
 *
 * "Raise a dispute" calls POST /gigs/:id/dispute, which freezes escrow to
 * dispute_hold; an admin resolves it by hand (no neutral panel in this
 * pilot). Whole-gig proof review, not per-criterion (v1 simplification).
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
  const [escrow, setEscrow] = useState<EscrowRecordView | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  async function handleApprove() {
    setApproving(true);
    setApproveError(null);
    try {
      const record = await releaseGig(gigId);
      setEscrow(record);
      stopPolling();
      if (record.state !== 'released') {
        pollRef.current = setInterval(async () => {
          try {
            const state = await getEscrow(gigId);
            setEscrow(state);
            if (state.state === 'released') stopPolling();
          } catch {
            // transient poll failure — next tick tries again, nothing to surface
          }
        }, POLL_INTERVAL_MS);
      }
    } catch (err) {
      setApproveError(err instanceof ApiError ? err.message : 'Could not start payment — try again.');
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

  if (disputed) {
    return (
      <Screen>
        <Heading>Dispute raised</Heading>
        <Body style={{ marginTop: spacing.md }}>
          This gig is frozen — no payment can be taken until this is resolved. Sorted will review
          and get back to you.
        </Body>
      </Screen>
    );
  }

  if (escrow?.state === 'released') {
    return (
      <Screen>
        <Heading>Payment released</Heading>
        <Body style={{ marginTop: spacing.md }}>
          The professional has been paid. This gig is complete.
        </Body>
      </Screen>
    );
  }

  // PLAN.md "Split payment pivot" — releaseGig has been called and is
  // awaiting the client's actual payment (checkout link, or a manual
  // transfer during the pilot) before the gig can be marked released.
  if (escrow) {
    const checkoutUrl = escrow.releaseCheckout?.checkoutUrl;
    const isManualPilot = !!escrow.releaseCheckout && !checkoutUrl;

    return (
      <Screen>
        <Heading>Pay to release</Heading>
        <Subtext>{gig ? gig.title : `Gig ${gigId.slice(0, 8)}`}</Subtext>

        {isManualPilot ? (
          <Banner tone="warning">
            Sorted is running a manual payment pilot while our licensed payment provider onboarding
            is pending. There is no automated escrow: the account below is held personally by
            Sorted&apos;s founder, and the professional is paid by hand once the transfer is seen —
            not automatically. Treat this as a disclosed, temporary stopgap, not business-grade
            payment protection.
          </Banner>
        ) : null}

        <Card>
          <Row label="Professional gets" value={formatNaira(escrow.bountyKobo)} />
          <Row label="Platform fee (added on top)" value={formatNaira(escrow.feeKobo)} muted />
          <View style={styles.divider} />
          <Row label="You pay" value={formatNaira(escrow.totalChargeKobo)} bold />
        </Card>

        <View style={{ height: spacing.lg }} />

        {checkoutUrl ? (
          <>
            <Body>Pay securely with Paystack — card, bank transfer, or USSD.</Body>
            <View style={{ height: spacing.sm }} />
            <Button title="Pay now" onPress={() => Linking.openURL(checkoutUrl)} />
          </>
        ) : escrow.releaseCheckout ? (
          <Card>
            <Text style={styles.transferLabel}>Transfer to</Text>
            <Text selectable style={styles.transferAccount}>{escrow.releaseCheckout.accountNumber}</Text>
            <Text style={styles.transferBank}>{escrow.releaseCheckout.bankName}</Text>
          </Card>
        ) : null}

        <View style={{ height: spacing.lg }} />

        <View style={styles.statusRow}>
          <Pill label="Waiting for payment to confirm" tone="neutral" />
        </View>
        <Body style={{ marginTop: spacing.sm }}>
          {checkoutUrl
            ? 'This updates automatically as soon as your payment is confirmed.'
            : "Once you've sent the transfer, this updates automatically after the founder confirms it landed — usually within a few hours."}
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
        title="Approve & pay"
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
        Raising a dispute freezes this gig immediately — Sorted resolves it by hand during this
        pilot, there's no automated arbitration yet. Nothing has been charged yet at this point, so
        there's nothing to refund either way.
      </Subtext>
    </Screen>
  );
}

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowLabelMuted]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowValueBold]}>{value}</Text>
    </View>
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
    row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
    rowLabel: { fontFamily: fonts.sans, fontSize: fontSizes.base, color: colors.textBody, flex: 1, paddingRight: spacing.sm },
    rowLabelMuted: { color: colors.textMuted, fontSize: fontSizes.sm },
    rowValue: { fontFamily: fonts.sansMedium, fontSize: fontSizes.base, color: colors.textPrimary },
    rowValueBold: { fontFamily: fonts.serifBold, fontSize: fontSizes.lg },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
    transferLabel: { fontFamily: fonts.sans, fontSize: fontSizes.sm, color: colors.textMuted, marginBottom: spacing.xs },
    transferAccount: { fontFamily: fonts.serifBold, fontSize: fontSizes.xl, color: colors.textPrimary },
    transferBank: { fontFamily: fonts.sans, fontSize: fontSizes.base, color: colors.textBody, marginTop: spacing.xs },
    statusRow: { flexDirection: 'row' },
  });
}
