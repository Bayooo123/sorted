import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Body, Button, Heading, Screen, Subtext, TextField } from '../components/ui';
import { listClientTypes, listDomains, listSubmarkets } from '../api/identity';
import { createGig, publishGig } from '../api/gigs';
import { ApiError } from '../api/client';
import { GigStackParamList } from '../navigation/types';
import { ClientTypeRef, Domain, MaterialsMode, Submarket } from '../api/types';
import { fonts, fontSizes, radii, spacing, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

/** ★ money-adjacent floor, matching HANDOFF.md §5's fee floor example. */
const MIN_BOUNTY_NAIRA = 3000; // max(bps×bounty, ₦300) fee floor implies a sane minimum bounty

/**
 * Screen 05 — Post a gig. Client view (handoff §05, mockups 02-05).
 * Implements the two gaps the handoff calls out as "not yet designed":
 * multi-criterion input (a real list, not one free-text box) and the
 * materialsMode toggle — both required by CreateGigDto server-side.
 */
export default function PostGigScreen({
  navigation,
}: NativeStackScreenProps<GigStackParamList, 'PostGig'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationText, setLocationText] = useState('');
  const [bountyNaira, setBountyNaira] = useState('');
  const [materialsMode, setMaterialsMode] = useState<MaterialsMode>('bounty_covers');
  const [criteria, setCriteria] = useState<string[]>(['']);

  const [domains, setDomains] = useState<Domain[]>([]);
  const [submarkets, setSubmarkets] = useState<Submarket[]>([]);
  const [clientTypes, setClientTypes] = useState<ClientTypeRef[]>([]);
  const [domainKey, setDomainKey] = useState<string | null>(null);
  const [submarketKey, setSubmarketKey] = useState<string | null>(null);
  const [clientTypeKey, setClientTypeKey] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([listDomains(), listSubmarkets(), listClientTypes()])
      .then(([d, s, c]) => {
        setDomains(d);
        setSubmarkets(s);
        setClientTypes(c);
        if (d[0]) setDomainKey(d[0].key);
        if (c[0]) setClientTypeKey(c[0].key);
      })
      .catch(() => {
        setError('Could not load categories — check your connection and try again.');
      });
  }, []);

  const visibleSubmarkets = useMemo(
    () => submarkets.filter((s) => !domainKey || s.domain?.key === domainKey),
    [submarkets, domainKey],
  );

  const bountyKobo = Math.round(parseFloat(bountyNaira || '0') * 100);
  const validCriteria = criteria.map((c) => c.trim()).filter(Boolean);

  const canSubmit =
    title.trim().length >= 3 &&
    description.trim().length > 0 &&
    locationText.trim().length > 0 &&
    domainKey &&
    submarketKey &&
    clientTypeKey &&
    validCriteria.length >= 1 &&
    bountyKobo >= MIN_BOUNTY_NAIRA * 100;

  function updateCriterion(index: number, text: string) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? text : c)));
  }

  function addCriterion() {
    setCriteria((prev) => [...prev, '']);
  }

  function removeCriterion(index: number) {
    setCriteria((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handlePublish() {
    if (!canSubmit || !domainKey || !submarketKey || !clientTypeKey) return;
    setError(null);
    setLoading(true);
    try {
      const draft = await createGig({
        title: title.trim(),
        description: description.trim(),
        domain: domainKey,
        submarket: submarketKey,
        clientType: clientTypeKey,
        locationText: locationText.trim(),
        materialsMode,
        bountyKobo,
        criteria: validCriteria,
      });
      // publishGig locks criteria (server-enforced, immutable thereafter)
      // and moves draft -> escrow_pending in one call, per HANDOFF.md §5
      // PUBLISH. There's no separate "review" round-trip to the server —
      // the review step below is purely client-side before that call.
      const published = await publishGig(draft.id);
      navigation.replace('FundEscrow', { gigId: published.id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post this gig — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Heading>Post a gig</Heading>
        <Subtext>Criteria lock once you publish — you can't edit them after.</Subtext>

        <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Fix leaking kitchen pipe" />
        <TextField
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="What needs doing, and any context a Professional should know"
          multiline
          numberOfLines={4}
          style={{ minHeight: 90, textAlignVertical: 'top' }}
        />

        <Body style={styles.label}>Domain</Body>
        <ChipRow
          items={domains.map((d) => ({ key: d.key, label: d.label }))}
          selected={domainKey}
          onSelect={(k) => {
            setDomainKey(k);
            setSubmarketKey(null);
          }}
        />

        <Body style={styles.label}>Category</Body>
        <ChipRow
          items={visibleSubmarkets.map((s) => ({ key: s.key, label: s.label }))}
          selected={submarketKey}
          onSelect={setSubmarketKey}
        />

        <Body style={styles.label}>Posting as</Body>
        <ChipRow
          items={clientTypes.map((c) => ({ key: c.key, label: c.label }))}
          selected={clientTypeKey}
          onSelect={setClientTypeKey}
        />

        <TextField label="Location" value={locationText} onChangeText={setLocationText} placeholder="Lekki Phase 1, Lagos" />

        <Body style={styles.label}>Who supplies materials?</Body>
        <View style={styles.toggleRow}>
          {(
            [
              { value: 'bounty_covers', label: 'Bounty covers materials' },
              { value: 'professional_supplies', label: 'Professional supplies' },
            ] as { value: MaterialsMode; label: string }[]
          ).map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setMaterialsMode(opt.value)}
              style={[styles.toggleOption, materialsMode === opt.value && styles.toggleOptionActive]}
            >
              <Text style={[styles.toggleText, materialsMode === opt.value && styles.toggleTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Body style={styles.label}>Definition of done</Body>
        <Subtext>Each line is a criterion the Client checks off at sign-off.</Subtext>
        {criteria.map((c, i) => (
          <View key={i} style={styles.criterionRow}>
            <View style={{ flex: 1 }}>
              <TextField
                placeholder={`Criterion ${i + 1}`}
                value={c}
                onChangeText={(t) => updateCriterion(i, t)}
              />
            </View>
            {criteria.length > 1 ? (
              <Pressable onPress={() => removeCriterion(i)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        <Pressable onPress={addCriterion} style={{ marginBottom: spacing.lg }}>
          <Text style={styles.addLink}>+ Add another criterion</Text>
        </Pressable>

        <TextField
          label="Budget (₦)"
          value={bountyNaira}
          onChangeText={setBountyNaira}
          keyboardType="decimal-pad"
          placeholder={String(MIN_BOUNTY_NAIRA)}
        />
        {bountyNaira && bountyKobo < MIN_BOUNTY_NAIRA * 100 ? (
          <Subtext style={{ color: colors.error, marginTop: -12 }}>
            Minimum budget is ₦{MIN_BOUNTY_NAIRA.toLocaleString()} (platform fee floor).
          </Subtext>
        ) : null}

        {error ? <Banner tone="warning">{error}</Banner> : null}

        <Button title="Review & publish" onPress={handlePublish} loading={loading} disabled={!canSubmit} />
      </ScrollView>
    </Screen>
  );
}

function ChipRow({
  items,
  selected,
  onSelect,
}: {
  items: { key: string; label: string }[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.chipWrap}>
      {items.map((item) => {
        const active = item.key === selected;
        return (
          <Pressable key={item.key} onPress={() => onSelect(item.key)} style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  label: { fontFamily: fonts.sansSemiBold, marginBottom: spacing.sm, marginTop: 4 },
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
  toggleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  toggleOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.cardSm,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  toggleOptionActive: { borderColor: colors.greenPrimary, backgroundColor: colors.greenMintBg },
  toggleText: { fontFamily: fonts.sans, fontSize: fontSizes.sm, color: colors.textBody },
  toggleTextActive: { color: colors.greenDeep, fontFamily: fonts.sansMedium },
  criterionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  removeBtn: { padding: spacing.sm, marginBottom: spacing.lg },
    removeBtnText: { color: colors.textMuted, fontSize: fontSizes.md },
    addLink: { fontFamily: fonts.sansMedium, color: colors.greenPrimary, fontSize: fontSizes.sm },
  });
}
