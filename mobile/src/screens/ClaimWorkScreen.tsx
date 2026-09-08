import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Body, Button, Card, Heading, Screen, Subtext } from '../components/ui';
import { getGig, submitForReview } from '../api/gigs';
import { claimGig } from '../api/escrow';
import { ApiError } from '../api/client';
import { BrowseStackParamList } from '../navigation/types';
import { GigRecord } from '../api/types';
import { fonts, fontSizes, radii, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

/** Illustrative until real staking exists — see EscrowService.holdStake's
 * doc comment: no real money moves for the stake in this pilot, so this is
 * a display-only preview of what the server will record, not a live read
 * of it (the real value only exists once claimGig() has actually run). */
const ILLUSTRATIVE_STAKE_BPS = 1000;

/**
 * Screen 11 — Claim + stake + work ★. Professional view, money slice
 * (HANDOFF §11). Two phases in one screen: an open gig shows a "Claim
 * this gig" button (calls POST /gigs/:id/claim); once claimed, the same
 * screen shows proof capture + "Submit for review" (POST /gigs/:id/submit)
 * — whole-gig proof, not per-criterion (v1 simplification, see PLAN.md
 * "Release + sign-off flow"). GPS check-in and in-app chat (HANDOFF.md
 * §3.6 evidence discipline) are still not represented here.
 */
export default function ClaimWorkScreen({
  route,
}: NativeStackScreenProps<BrowseStackParamList, 'ClaimWork'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { gigId } = route.params;
  const [gig, setGig] = useState<GigRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [proofBase64, setProofBase64] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const loadGig = useCallback(() => {
    getGig(gigId)
      .then((g) => {
        setGig(g);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Could not load this gig.'));
  }, [gigId]);

  useEffect(loadGig, [loadGig]);

  const stakeKobo = Math.round(((gig?.bountyKobo ?? 0) * ILLUSTRATIVE_STAKE_BPS) / 10_000);
  const claimed = gig ? gig.status !== 'open' : false;

  async function handleClaim() {
    setClaiming(true);
    setClaimError(null);
    try {
      await claimGig(gigId);
      loadGig();
    } catch (err) {
      setClaimError(err instanceof ApiError ? err.message : 'Could not claim this gig — try again.');
    } finally {
      setClaiming(false);
    }
  }

  async function pickProof() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true });
    if (!result.canceled && result.assets[0]) {
      setProofUri(result.assets[0].uri);
      const mime = result.assets[0].mimeType ?? 'image/jpeg';
      setProofBase64(`data:${mime};base64,${result.assets[0].base64}`);
    }
  }

  async function handleSubmit() {
    if (!proofBase64) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitForReview(gigId, proofBase64, note || undefined);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not submit for review — try again.');
    } finally {
      setSubmitting(false);
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

  if (submitted) {
    return (
      <Screen>
        <Heading>Submitted for review</Heading>
        <Body style={{ marginTop: spacing.md }}>
          The client has been notified. Once they approve, your payout is released automatically —
          you don&apos;t need to do anything else here.
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>{gig ? gig.title : `Gig ${gigId.slice(0, 8)}`}</Heading>
      <Subtext>{claimed ? 'Claimed — stake held' : 'Open — not yet claimed'}</Subtext>

      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={styles.cardTitle}>Your stake</Text>
        <Text style={styles.stakeAmount}>
          {(stakeKobo / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })}
        </Text>
        <Body style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>
          Sorted is not collecting a real stake payment during this pilot — shown for reference only.
        </Body>
      </Card>

      {!claimed ? (
        <>
          {claimError ? <Body style={styles.errorText}>{claimError}</Body> : null}
          <Button title="Claim this gig" onPress={handleClaim} loading={claiming} />
        </>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Proof of work</Text>
          <Body style={{ marginBottom: spacing.md }}>
            One photo + an optional note for the whole gig (per-criterion proof isn&apos;t built yet).
          </Body>

          <Pressable onPress={pickProof} style={styles.proofZone}>
            {proofUri ? (
              <Image source={{ uri: proofUri }} style={styles.proofImage} />
            ) : (
              <Text style={styles.proofPrompt}>Tap to attach proof photo</Text>
            )}
          </Pressable>

          <TextInput
            style={styles.noteInput}
            placeholder="Optional note for the client"
            placeholderTextColor={colors.textMuted}
            value={note}
            onChangeText={setNote}
            multiline
          />

          <Body style={{ marginTop: spacing.md, marginBottom: spacing.xl }}>
            GPS check-in at arrival/start and in-app chat with the Client are both part of the
            evidence pack (HANDOFF.md §3.6) — not represented on this screen yet.
          </Body>

          {submitError ? <Body style={styles.errorText}>{submitError}</Body> : null}
          <Button title="Submit for review" onPress={handleSubmit} loading={submitting} disabled={!proofBase64} />
        </>
      )}
    </Screen>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
    noteInput: {
      marginTop: spacing.md,
      minHeight: 60,
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
