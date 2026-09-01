import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Banner, Body, Button, Card, Heading, Pill, Screen, Subtext, TextField } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { applyForKyc, getMyKycRequest, updateAvatar, updateProfile } from '../api/identity';
import { ApiError } from '../api/client';
import { KycRequestView } from '../api/types';
import { fonts, fontSizes, radii, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

// Keep in sync with server/src/common/nigerian-states.ts.
const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

/** Screen 09 — Profile. Both roles, Reputation module (handoff §09). Profile photo (any role) + KYC apply (professional only) added later — see PLAN.md "Profile photo + KYC apply flow". */
export default function ProfileScreen() {
  const { user, signOut, refreshUser } = useAuth();
  const { colors, mode, toggleMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [kycRequest, setKycRequest] = useState<KycRequestView | null | undefined>(undefined);
  const [kycDocumentUri, setKycDocumentUri] = useState<string | null>(null);
  const [kycDocumentBase64, setKycDocumentBase64] = useState<string | null>(null);
  const [kycNote, setKycNote] = useState('');
  const [kycError, setKycError] = useState<string | null>(null);
  const [kycSubmitting, setKycSubmitting] = useState(false);

  useEffect(() => {
    if (!user || !user.roles.includes('professional')) return;
    getMyKycRequest()
      .then(setKycRequest)
      .catch(() => setKycRequest(null));
  }, [user?.id]);

  if (!user) return null;

  const isProfessional = user.roles.includes('professional');
  const isClient = user.roles.includes('client');

  function startEditing() {
    setName(user!.name ?? '');
    setPhone(user!.phone ?? '');
    setState(user!.state ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const input: { name?: string; phone?: string; state?: string } = {};
      if (name.trim()) input.name = name.trim();
      if (phone.trim()) input.phone = phone.trim();
      if (state) input.state = state;

      await updateProfile(input);
      await refreshUser();
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again');
    } finally {
      setSaving(false);
    }
  }

  async function pickAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;

    setAvatarError(null);
    setAvatarUploading(true);
    try {
      await updateAvatar(`data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`);
      await refreshUser();
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : 'Could not update photo — try again');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function pickKycDocument() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, base64: true });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;

    setKycDocumentUri(asset.uri);
    setKycDocumentBase64(`data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`);
    setKycError(null);
  }

  async function handleApplyKyc() {
    if (!kycDocumentBase64) {
      setKycError('Choose a photo to upload.');
      return;
    }
    setKycError(null);
    setKycSubmitting(true);
    try {
      const request = await applyForKyc(kycDocumentBase64, kycNote.trim() || undefined);
      setKycRequest(request);
      setKycDocumentUri(null);
      setKycDocumentBase64(null);
      setKycNote('');
      await refreshUser(); // picks up kycStatus: 'pending'
    } catch (err) {
      setKycError(err instanceof ApiError ? err.message : 'Could not submit — try again');
    } finally {
      setKycSubmitting(false);
    }
  }

  const avatarInitial = (user.name || user.email || user.phone || '?').trim().charAt(0).toUpperCase();

  return (
    <Screen>
      <View style={styles.avatarRow}>
        <Pressable onPress={pickAvatar} style={styles.avatarWrap}>
          {user.avatarBase64 ? (
            <Image source={{ uri: user.avatarBase64 }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarInitial}>{avatarInitial || '?'}</Text>
          )}
        </Pressable>
        <Pressable onPress={pickAvatar} disabled={avatarUploading}>
          <Text style={styles.avatarChangeLink}>{avatarUploading ? 'Uploading…' : 'Change photo'}</Text>
        </Pressable>
      </View>
      {avatarError ? <Banner tone="warning">{avatarError}</Banner> : null}

      <Heading>{user.name ?? user.phone}</Heading>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
        {user.roles.map((r) => (
          <Pill key={r} label={r === 'professional' ? 'Professional' : 'Client'} tone="active" />
        ))}
        <Pill label={`KYC: ${user.kycStatus}`} tone={user.kycStatus === 'verified' ? 'active' : 'neutral'} />
      </View>

      <Banner tone="warning">
        Reputation module has no HTTP route yet (getReputation/
        recordOutcome, HANDOFF.md §3.9). Numbers below are placeholders —
        HANDOFF.md §11 also flags whether Client-side reliability scoring
        ships in v1 at all as still undecided, so don't treat this Client
        variant as final either.
      </Banner>

      {isProfessional ? (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={styles.cardTitle}>Professional track record</Text>
          <StatRow label="Jobs completed" value="—" />
          <StatRow label="Dispute rate" value="—" />
          <StatRow label="No-dispute streak" value="—" />
        </Card>
      ) : null}

      {isClient ? (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={styles.cardTitle}>Client reliability</Text>
          <StatRow label="On-time sign-off rate" value="—" />
          <StatRow label="Dispute rate" value="—" />
          <StatRow label="Dispute loss rate" value="—" />
        </Card>
      ) : null}

      <Card style={{ marginBottom: spacing.md }}>
        <Text style={styles.cardTitle}>Account</Text>

        {editing ? (
          <>
            <TextField label="Name" value={name} onChangeText={setName} />
            <TextField label="Phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            <Text style={styles.stateLabel}>State</Text>
            <View style={styles.chipWrap}>
              {NIGERIAN_STATES.map((s) => {
                const active = state === s;
                return (
                  <Pressable key={s} onPress={() => setState(s)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>

            {error ? <Banner tone="warning">{error}</Banner> : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} disabled={saving} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Save" onPress={handleSave} loading={saving} />
              </View>
            </View>
          </>
        ) : (
          <>
            <StatRow label="Phone" value={user.phone ?? '—'} />
            <StatRow label="Email" value={user.email ?? '—'} />
            <StatRow label="State" value={user.state ?? '—'} />
            <StatRow label="Payout accounts" value="Not built yet" />
            <StatRow label="Skills & services" value="Not built yet" />
            <Body onPress={startEditing} style={styles.editLink}>
              Edit name, phone, state
            </Body>
          </>
        )}
      </Card>

      {isProfessional ? (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={styles.cardTitle}>Verification</Text>

          {user.kycStatus === 'verified' ? (
            <>
              <Pill label="Verified" tone="active" />
              <Body style={{ marginTop: spacing.sm }}>Verified professionals are more likely to be picked for gigs.</Body>
            </>
          ) : kycRequest === undefined ? (
            <Body>Loading…</Body>
          ) : kycRequest?.status === 'pending' ? (
            <>
              <Pill label="Application under review" />
              <Body style={{ marginTop: spacing.sm }}>
                We'll update this once it's reviewed — usually within a few days.
              </Body>
            </>
          ) : (
            <>
              {kycRequest?.status === 'rejected' ? (
                <Banner tone="warning">
                  Not approved{kycRequest.reviewNote ? `: ${kycRequest.reviewNote}` : '.'} You can apply again below.
                </Banner>
              ) : null}
              <Body style={{ marginBottom: spacing.md }}>
                Verified professionals are more likely to be picked for gigs. Upload a clear photo of a
                government ID or yourself for manual review.
              </Body>
              <Pressable onPress={pickKycDocument} style={styles.kycPicker}>
                {kycDocumentUri ? (
                  <Image source={{ uri: kycDocumentUri }} style={styles.kycPickerImage} />
                ) : (
                  <Text style={styles.kycPickerText}>Tap to choose a photo</Text>
                )}
              </Pressable>
              <TextField placeholder="Optional note" value={kycNote} onChangeText={setKycNote} />
              {kycError ? <Banner tone="warning">{kycError}</Banner> : null}
              <Button
                title="Apply for verification"
                onPress={handleApplyKyc}
                loading={kycSubmitting}
                disabled={!kycDocumentBase64}
              />
            </>
          )}
        </Card>
      ) : null}

      <Card style={{ marginBottom: spacing.xl }}>
        <Text style={styles.cardTitle}>Appearance</Text>
        <Pressable onPress={toggleMode} style={styles.themeRow}>
          <Text style={styles.statLabel}>Theme</Text>
          <View style={styles.themeToggle}>
            <Text style={[styles.themeOption, mode === 'light' && styles.themeOptionActive]}>Light</Text>
            <Text style={[styles.themeOption, mode === 'dark' && styles.themeOptionActive]}>Dark</Text>
          </View>
        </Pressable>
      </Card>

      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    cardTitle: { fontFamily: fonts.sansSemiBold, fontSize: fontSizes.base, color: colors.textPrimary, marginBottom: spacing.sm },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
    statLabel: { fontFamily: fonts.sans, fontSize: fontSizes.sm, color: colors.textMuted },
    statValue: { fontFamily: fonts.sansMedium, fontSize: fontSizes.sm, color: colors.textBody },
    editLink: { color: colors.greenPrimary, marginTop: spacing.sm },
    stateLabel: {
      fontFamily: fonts.sansMedium,
      fontSize: fontSizes.sm,
      color: colors.textBody,
      marginBottom: spacing.xs,
    },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      backgroundColor: colors.surface,
    },
    chipActive: { borderColor: colors.greenBright, backgroundColor: colors.greenMintBg },
    chipText: { fontFamily: fonts.sans, fontSize: fontSizes.sm, color: colors.textBody },
    chipTextActive: { color: colors.greenDeep, fontFamily: fonts.sansMedium },
    themeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
    themeToggle: { flexDirection: 'row', backgroundColor: colors.bgApp, borderRadius: 999, padding: 3, gap: 2 },
    themeOption: {
      fontFamily: fonts.sansMedium,
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: 999,
    },
    themeOptionActive: { backgroundColor: colors.surface, color: colors.textPrimary, fontFamily: fonts.sansSemiBold },
    avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
    avatarWrap: {
      width: 64,
      height: 64,
      borderRadius: 999,
      backgroundColor: colors.greenMintBg,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: { width: 64, height: 64 },
    avatarInitial: { fontFamily: fonts.serifBold, fontSize: fontSizes.xxl, color: colors.greenDeep },
    avatarChangeLink: { fontFamily: fonts.sansMedium, fontSize: fontSizes.sm, color: colors.greenPrimary },
    kycPicker: {
      height: 140,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      borderRadius: radii.cardSm,
      backgroundColor: colors.bgApp,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
      marginBottom: spacing.md,
    },
    kycPickerText: { fontFamily: fonts.sans, fontSize: fontSizes.sm, color: colors.textMuted },
    kycPickerImage: { width: '100%', height: '100%' },
  });
}
