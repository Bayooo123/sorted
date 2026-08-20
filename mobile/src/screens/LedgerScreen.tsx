import React from 'react';
import { View } from 'react-native';
import { Banner, Body, Heading, Screen, Subtext } from '../components/ui';
import { spacing } from '../theme/tokens';

/** Screen 08 — Ledger. Both roles (handoff §08). */
export default function LedgerScreen() {
  return (
    <Screen>
      <Heading>Ledger</Heading>
      <Subtext>Every naira movement, append-only</Subtext>

      <Banner tone="warning">
        LedgerPort has no HTTP route yet — there's nothing to read.
        LedgerEntry rows only start existing once slice 4 (funding) and
        slice 7 (release) run for real. This screen will read one row per
        entry type (fund/stake/release/refund/fee/penalty/payout)
        directly off that table.
      </Banner>

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Body style={{ textAlign: 'center' }}>No activity yet.</Body>
      </View>
    </Screen>
  );
}
