import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Button, Card, Heading, Pill, Screen, Subtext } from '../components/ui';
import { getGig } from '../api/gigs';
import { GigStackParamList } from '../navigation/types';
import { fundGig, getEscrow } from '../api/escrow';
import { ApiError } from '../api/client';
import { EscrowRecordView, FundGigResult, GigRecord } from '../api/types';
import { fonts, fontSizes, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

const POLL_INTERVAL_MS = 4000;

function formatNaira(kobo: number) {
  return (kobo / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
}

/**
 * Screen 06 — Fund escrow ★. Wired to POST /gigs/:id/fund
 * (server/src/modules/escrow/escrow.controller.ts), whose response shape
 * now depends on the active PaymentsProvider (server/src/modules/payments/
 * payments.module.ts's PAYMENTS_PROVIDER_KEY):
 *  - Paystack: holdingAccount.checkoutUrl — a one-time payment link, opened
 *    in-browser; funding confirms automatically via webhook once paid.
 *  - manual-pilot (default until Paystack credentials are live):
 *    holdingAccount.accountNumber/bankName — a static transfer target,
 *    confirmed by hand. The disclosure copy below only applies to that
 *    path — the account shown there is the founder's own personal account
 *    during this pilot (confirmed explicitly, not a registered Sorted
 *    business account), so it must never claim automated/business-grade
 *    escrow protection.
 * Either way this screen polls for the state to leave 'awaiting_funding'.
 */
export default function FundEscrowScreen({
  route,
}: NativeStackScreenProps<GigStackParamList, 'FundEscrow'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { gigId } = route.params;
  const [gig, setGig] = useState<GigRecord | null>(null);
  const bountyKobo = gig?.bountyKobo ?? 0;

  useEffect(() => {
    getGig(gigId)
      .then(setGig)
      .catch(() => {
        // Non-fatal here — the fee-math card just shows ₦0 until this
        // resolves; the actual funding flow below doesn't depend on it.
      });
  }, [gigId]);

  const [result, setResult] = useState<FundGigResult | null>(null);
  const [escrow, setEscrow] = useState<EscrowRecordView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const requestTransfer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fundGig(gigId);
      setResult(res);
      setEscrow(res);
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const state = await getEscrow(gigId);
          setEscrow(state);
          if (state.state !== 'awaiting_funding') stopPolling();
        } catch {
          // transient poll failure — next tick tries again, nothing to surface
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start funding — try again.');
    } finally {
      setLoading(false);
    }
  }, [gigId, stopPolling]);

  const feeKobo = result ? Math.round((result.bountyKobo * result.platformFeeBps) / 10_000) : 0;
  const confirmed = escrow?.state === 'funded' || (escrow && escrow.state !== 'awaiting_funding');
  const checkoutUrl = result?.holdingAccount?.checkoutUrl;
  const isManualPilot = !!result?.holdingAccount && !checkoutUrl;

  return (
    <Screen>
      <Heading>Fund escrow</Heading>
      <Subtext>Your gig is published and criteria are locked.</Subtext>

      {isManualPilot ? (
        <Banner tone="warning">
          Sorted is running a manual funding pilot while our licensed payment
          provider onboarding is pending. There is no automated escrow yet:
          the account below is held personally by Sorted&apos;s founder, and
          funding is confirmed by hand once the transfer is seen — not
          released automatically. Treat this as a disclosed, temporary
          stopgap, not business-grade payment protection.
        </Banner>
      ) : null}

      {!result ? (
        <>
          <Card>
            <Row label="Bounty" value={formatNaira(bountyKobo)} bold />
          </Card>
          <View style={{ height: spacing.lg }} />
          {error ? <Body style={styles.errorText}>{error}</Body> : null}
          <Button title="Get transfer details" onPress={requestTransfer} loading={loading} />
        </>
      ) : (
        <>
          <Card>
            <Row label="Bounty" value={formatNaira(result.bountyKobo)} />
            <Row label="Platform fee (deducted at release)" value={formatNaira(feeKobo)} muted />
            <View style={styles.divider} />
            <Row label="Send exactly" value={formatNaira(result.bountyKobo)} bold />
          </Card>

          <View style={{ height: spacing.lg }} />

          {checkoutUrl ? (
            <>
              <Body>Pay securely with Paystack — card, bank transfer, or USSD.</Body>
              <View style={{ height: spacing.sm }} />
              <Button title="Pay now" onPress={() => Linking.openURL(checkoutUrl)} />
            </>
          ) : result.holdingAccount ? (
            <Card>
              <Text style={styles.transferLabel}>Transfer to</Text>
              <Text selectable style={styles.transferAccount}>{result.holdingAccount.accountNumber}</Text>
              <Text style={styles.transferBank}>{result.holdingAccount.bankName}</Text>
            </Card>
          ) : null}

          <View style={{ height: spacing.lg }} />

          <View style={styles.statusRow}>
            <Pill
              label={confirmed ? 'Funding confirmed' : 'Waiting for confirmation'}
              tone={confirmed ? 'active' : 'neutral'}
            />
          </View>
          <Body style={{ marginTop: spacing.sm }}>
            {confirmed
              ? 'Your gig is now open to professionals.'
              : checkoutUrl
                ? 'This updates automatically as soon as your payment is confirmed.'
                : "Once you've sent the transfer, this updates automatically after the founder confirms it landed — usually within a few hours."}
          </Body>
        </>
      )}
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
    errorText: { color: colors.error, marginBottom: spacing.md },
  });
}
