# Sorted — Product Requirements Document (v1, Mobile)

**Status:** Draft, derived from `HANDOFF.md` (architecture/CTO handoff, Aug
2026 revision) and `PLAN.md` (build-slice log). `SPEC.md` and `/screens` —
the product/UX companion artifacts `HANDOFF.md` references throughout —
are **not present in this repo**. Anywhere this PRD needs screen-exact
copy or confirmed mockup numbers, it says so instead of guessing.
Reconcile against those artifacts once available.

**Terminology lock:** roles are **Client** (posts and pays for gigs) and
**Professional** (claims and does the work) — not "payer"/"solver". This
PRD uses Client/Professional throughout, and so does the implemented
backend and mobile app — `payer`/`solver` were renamed across slices 1–3
in the same pass that scaffolded the mobile app (see `PLAN.md`).

**Primary surface: the mobile app.** The repo root's `index.html` is a
waitlist landing page only — it is not the product. The product is the
React Native (Expo) app under `mobile/`. Escrow and sign-off don't exist
as working flows yet — Payments/Escrow/Verification have no HTTP
controller server-side — but screens for them now exist in the app,
UI-built with actions disabled and each one flagged with exactly which
backend slice unblocks it; see `mobile/README.md` for the current
real-vs-mocked split, screen by screen.

---

## 1. Problem

Informal work in Nigeria (physical trades — plumbing, cleaning, repairs —
and digital gigs) runs on trust with no enforcement mechanism. Clients
risk paying for work that isn't done to spec, or not knowing if a
Professional is reliable before hiring. Professionals risk doing work and
not getting paid, or having scope change after they've started. There's
no shared record of who delivers — in either direction.

## 2. Solution

An escrow-mediated marketplace: a Client posts a gig with **locked
completion criteria** and a bounty; a Professional claims it (staking a %
as skin-in-the-game); money sits in Monnify-held escrow until the Client
signs off against those same locked criteria; funds release automatically
on sign-off, or freeze for neutral arbitration on dispute. Every naira
movement is append-only-logged. Completion/dispute history compounds into
a reputation score, tracked for **both roles** — the intended long-term
moat.

**Product name:** Sorted. Tagline: "Consider it sorted."

## 3. Goals (v1)

- A Client can post a gig, fund it via escrow, and get it done by a
  Professional they didn't have to personally vet, with money released
  only when they confirm the locked criteria were met.
- A Professional can find gigs matching what they offer, claim one with a
  stake, do the work, submit proof, and get paid automatically on
  sign-off — no chasing payment.
- Neither party can unilaterally take the other's money: release requires
  sign-off or a neutral ruling; disputes freeze funds for real.
- Reliability is tracked for both sides, not just Professionals — a
  Client who disputes in bad faith and loses is a signal the system
  surfaces too.
- The mobile app is the entire transacting surface — no web app in v1.

## 4. Non-goals (v1)

Explicitly deferred — see §14 for where each plugs back in later:

- Reverse auction / dynamic or signal-based pricing (v1 = fixed price, first-claim).
- Structured shortlist matching (ranked multi-claim selection) — **blocked on an open staking-timing decision, §12**, not just deferred by choice.
- Non-human gig sources (signal detection, institutional feeders).
- Recurring/templated gigs.
- A second payments provider or non-Monnify funding flows (e.g. government procurement).
- Automated/richer verification beyond the Client sign-off + optional inspection request (§7).
- A full neutral-arbitration panel (v1 disputes can be admin-assisted, but the money freeze must be real).
- A materials-advance partial escrow release — raised in ideation, explicitly **not designed**; do not build a UI for it (§12).
- Delivery/logistics as a distinct product surface — status open, §12.
- Secondary market in verified-outcome positions.
- Web app.
- Cities/currencies beyond Lagos/NGN (structurally supported as data, not built as a feature).

## 5. Users

| Persona | Role | Backend `role_flags` |
|---|---|---|
| **Client** | Posts gigs, funds escrow, signs off on completion | `client` |
| **Professional** | Claims gigs, stakes, does the work, submits proof | `professional` |
| **Hybrid** | Both — recommended default at signup | `client` + `professional` |

Both roles are trackable on one `User` (flags-based per `HANDOFF.md` §3.1
— a user isn't locked into one role by schema). The mobile screens
handoff confirms Hybrid ships in v1 as the recommended default account
type (resolving the open question the prior PRD draft flagged here) —
signup is a Professional / Client / Hybrid picker, and Hybrid still
requires filling in both the service-offering and seeking-category lists,
no "fill in later" (matches `PLAN.md`'s existing registration rule, just
renamed).

Auth is **phone + OTP** — phone-first market, no email/password in v1.

## 6. Platform requirements — mobile-first

- **Stack:** React Native (Expo), Android-first (majority market), one
  codebase for iOS + Android.
- **Connectivity:** design for intermittent/slow mobile data, not
  always-on wifi. Every mutating screen (post gig, claim, submit proof,
  sign-off) needs an explicit loading/retry state, not a silent hang —
  these are money actions, so a failed request must be visibly failed,
  never ambiguous.
- **Low-end Android support:** proof photos should be compressed
  client-side before upload (R2 storage, mobile data costs money for
  users). Avoid heavy client-side image/video processing that stalls
  low-spec devices.
- **Camera/media:** proof submission is a native camera/gallery picker
  per locked criterion — this is a core mobile capability, not a
  nice-to-have. Per `HANDOFF.md` §3.6's evidence discipline, the app
  should also capture a GPS check-in at arrival/start where the OS
  permission allows, and log the in-app Client↔Professional chat — both
  feed the dispute evidence pack, and are cheap to capture live but
  costly to reconstruct after a dispute is raised.
- **OTP UX:** native SMS autofill (iOS/Android autofill APIs) for the OTP
  code entry — this is a first-run funnel step, friction here is
  expensive.
- **Push notifications:** gig/escrow/dispute events (funded, claimed,
  submitted, released, disputed) need push, not just in-app state — a
  Client or Professional won't have the app open when a webhook fires.
  SMS is the v1 channel per `HANDOFF.md` §3.9; push is the natural
  mobile-first upgrade and should be scoped explicitly (open question,
  §12).
- **Session persistence:** JWT + refresh should survive app restarts
  without re-OTP on every open — balance against session length
  reasonable for a money app.
- **App size / offline:** no offline-first requirement for v1 (money
  state must be server-authoritative), but the app shell and static
  taxonomy data (submarkets, domains) can be cached client-side to avoid
  a network round-trip on every screen that needs a picker.

## 7. Information architecture (screens)

Numbered mockups below are as cited in `HANDOFF.md` §7/§5 only — not
independently verified since `/screens` wasn't part of this repo. Treat
numbers as provisional pending `SPEC.md`.

1. **Onboarding** — phone entry → OTP verify → Professional / Client /
   Hybrid picker → submarket picker(s), required for whichever role(s)
   are selected including Hybrid (structured picks, not free text; §5).
2. **Post a gig** (mockups 02–05) — gig basics (title, description,
   domain/submarket/client type, location, materials mode) → criteria
   entry (ordered list, locks at publish) → review → escrow-pending
   confirmation.
3. **Escrow funding** (mockup 06) — Client funds the holding account;
   screen reflects `awaiting_funding` → `funded` once the Monnify webhook
   confirms.
4. **Market / browse** (mockup 07) — Physical/Digital tab, submarket +
   client-type filters, gig list.
5. **Gig detail** (mockup 08) — full gig view, locked criteria, claim
   action (with stake amount shown before commit). **v1 = first-claim
   auto-assign only** — no shortlist-selection UI until §12's
   staking-timing decision lands; don't build a "pick from claimants"
   screen speculatively.
6. **Claim + work** (mockup 09) — Professional's active-gig checklist
   against locked criteria, proof capture per criterion, GPS check-in at
   arrival/start where permitted.
7. **Sign-off** (mockups 10–11) — Client taps met/not-met per criterion
   against submitted proof, **or** requests inspection instead of a
   straight tap (most relevant for physical jobs, §3.6) — the inspection
   path's UI isn't detailed in `HANDOFF.md` beyond "Client can optionally
   request it," so treat it as a variant entry point on this screen
   pending `SPEC.md`, not a separate flow to design from scratch.
   Completion screen post-release.
8. **Dispute flow** — raise dispute, frozen-state indicator, ruling
   outcome (no mockup number available). Screen copy should reflect the
   target ~48h evaluation SLA (soft, not a guarantee) so a user isn't
   left guessing how long the freeze lasts.
9. **Reputation** — track record surfaced on profile, **for both roles**:
   Professional side (`jobs_completed`, `dispute_rate`, category-specific
   completions, milestone badges, specialization tags, no-dispute
   streak); Client side (on-time sign-off rate, dispute rate, dispute
   loss rate). No mockup number available; confirm whether this is a v1
   screen or just backend-tracked in v1 (open question, §12 — carried
   over, now explicitly bidirectional).

## 8. Functional requirements by module

Mirrors the nine backend modules in `HANDOFF.md` §3 — each is a boundary
the mobile app talks to only through its documented interface/endpoints,
never around it.

| Module | Mobile-facing requirement |
|---|---|
| **Identity** | Phone+OTP login; role setup; payout-destination form (bank code, account number, name) — required before a Professional can be paid out. |
| **Gigs** | Create/publish gig form with locked-criteria entry; status displayed at every stage (`draft → escrow_pending → open → claimed → in_progress → submitted → signed_off/disputed → released/refunded/cancelled`). |
| **Matching** | v1: transparent fixed-price, first-credible-claim, auto-assign. No bidding UI, no shortlist-selection UI in v1 (§12 blocks it). |
| **Payments** | App never talks to Monnify directly — always through backend endpoints. Funding screen must clearly show amount, and reflect webhook-driven state changes without requiring manual refresh (poll or push). |
| **Escrow** | Every money-state transition (fund/stake/release/refund/freeze) must be visible to the affected user in near-real-time; fee (10% launch rate) and stake (~10%, sizing policy still open — §12) shown before commitment, not after. No materials-advance / partial-release UI — that Escrow state doesn't exist yet (§12). |
| **Verification** | Client sign-off screen: photo evidence + met/not-met toggle per locked criterion, submitted atomically, plus an inspection-request entry point (see §7 item 7). |
| **Disputes** | Either party can raise a dispute from an active/submitted gig; UI must make the "money is frozen" state unambiguous — this is the one state where "nothing is happening" is the correct and expected behavior. Surface the target SLA as a soft expectation, not a promise. |
| **Ledger** | Not necessarily a v1 UI (backend is append-only source of truth) — but a per-gig transaction history view (fund/stake/release/fee) is worth scoping as a trust-building screen (open question, §12). |
| **Reputation & Notifications** | Push/SMS on every gig-lifecycle event affecting the user; reputation numbers shown on profile for **both** Client and Professional (§7 item 9) — confirm pre-claim visibility rules (open question, §12). |

## 9. Core flow — escrow state machine (reference)

```
PUBLISH    → criteria lock, Escrow=awaiting_funding
FUND       → client transfers bounty, webhook verified → Escrow=funded, Gig=open
CLAIM      → professional stakes ~10% → Escrow=stake_held, Gig=claimed→in_progress
             (shortlist variant possible later — staking-timing undecided, §12)
SUBMIT     → proof per criterion, Gig=submitted (no money moves)
INSPECTION → optional — client may request inspection instead of a straight sign-off tap
SIGN-OFF   → client confirms all criteria met → Escrow=releasing → disburse
             (professional 90% + stake back, Sorted 10% fee) → released
DISPUTE    → either party, any point post-claim → Escrow=dispute_hold (frozen)
             target SLA ~48h (soft) → neutral ruling:
               for_professional (pay as happy path) /
               for_client (refund, professional stake forfeit) / split /
               client bad-faith (penalty to client, professional still paid —
               tracked as a per-client reputation signal)
TIMEOUT    → professional abandons/late → stake forfeit; reopen or refund
```

Fee example (NGN 85,000 gig): Client funds NGN 85,000, Professional stakes
NGN 8,500 → sign-off → Professional gets NGN 76,500 + NGN 8,500 stake back,
Sorted gets NGN 8,500. Fee floor: `max(bps × bounty, NGN 300)`.

**This state machine is fixed** (`HANDOFF.md` §5/§9) — the mobile app
reflects it, it does not invent additional client-side states. The
`INSPECTION` step is optional and Client-initiated; it does not change
the Escrow state on its own.

## 10. Non-functional requirements

- **Money correctness is the top-priority NFR.** Integer kobo throughout
  (never float, including on the client — no client-side currency math
  beyond display formatting). All balance-changing screens must handle
  "request succeeded but state unclear" (e.g. app backgrounded mid-call)
  by re-fetching authoritative state on resume, never assuming success.
- **Idempotency:** any client action that triggers a money transition
  (fund confirmation polling, claim+stake, sign-off) must be safe to
  retry without double-effect — enforced server-side (`event_id`/
  idempotency keys per `HANDOFF.md` §9), but the client shouldn't
  double-submit on a double-tap either (disable-on-submit).
- **Security:** JWT-gated routes; no Client/Professional ID trusted from
  client payloads (server-enforced, per `PLAN.md` slice 3's existing
  pattern — client should never need to pass its own user ID for auth'd
  actions). Payout-destination and OTP screens are the two most sensitive
  mobile surfaces — no analytics/logging of OTP codes or bank details
  client-side.
- **Evidence capture:** proof photos, chat log, and GPS check-in (where
  permitted) are captured by default during the work, not only if a
  dispute later happens (`HANDOFF.md` §3.6/§9) — this is a mobile UX
  requirement, not just a backend one, since the app is what prompts for
  the check-in and photos at the right moments.
- **Accessibility/localization:** not specified in `HANDOFF.md` — flagged
  as open (§12). Given phone-first, low-literacy-friendly UI (icon +
  short text, minimal jargon) is a reasonable default worth confirming
  against `SPEC.md`.
- **Design tokens** (from `HANDOFF.md` §6, use exactly):
  `--green-primary:#027A61 --green-deep:#007B5C --green-bright:#04C29C
  --green-mint-bg:#C8FFF6 --green-mint-pale:#D2FFFD --bg-app:#F4FAF8
  --surface:#FFFFFF --border:#E0E6E4 --text-primary:#0C1F1B
  --text-body:#3A4A47 --text-muted:#7E8F8D`. Logo: mint rounded-square +
  primary-green check. Wordmark "SORTED", bold serif caps. Body font:
  Inter/system sans.

## 11. Success metrics (proposed — not in HANDOFF.md, needs founder sign-off)

- Gigs published → funded conversion rate (funnel drop-off at escrow
  funding is the first real money-commitment moment).
- Claimed → submitted → signed-off completion rate.
- Dispute rate and dispute loss rate — **both directions** now that
  Reputation is bidirectional (Professional dispute rate, Client dispute
  rate/dispute loss rate).
- Time from publish to claim (marketplace liquidity signal).
- OTP request → verified conversion (mobile onboarding funnel health).

## 12. Open questions / gaps

Carried over from the prior draft plus everything `HANDOFF.md` §11 now
flags explicitly as undecided. Items marked **[blocks a screen]** stop
mobile work on that specific screen, not the whole app.

1. **`SPEC.md` and `/screens` are missing from this repo.** Screen copy,
   exact mockup numbers, and the full taxonomy list should be reconciled
   against those once available.
2. **Staking-timing model** (`HANDOFF.md` §3.3/§11) — Option A (stake
   only after Client selects), B (stake at claim, auto-refund losers), or
   C (small non-refundable interest fee at claim, full stake on
   selection). **[blocks shortlist-selection UI, §7 item 5]**
3. **Client-facing word for "gig"** — not formally decided alongside the
   naming lock, though the mobile screens handoff itself uses "gig"
   throughout its copy without flagging it as provisional, and the
   mobile app (`mobile/`) follows suit rather than inventing a different
   placeholder. Treat "gig" as the working term unless `SPEC.md` says
   otherwise — not blocking, just not formally locked.
4. ~~Whether v1 keeps a combined Client+Professional account type~~ —
   **resolved**: the mobile screens handoff confirms Hybrid ships as the
   recommended default (§5 above).
5. **Logistics scope for v1** — depends on whether the first wedge
   submarket's jobs are on-site or off-site; may mean logistics is
   deferrable entirely. No mobile impact either way until resolved.
6. **Materials-advance Escrow state** — flagged, not designed. **No UI
   work should start on this** until it has its own design pass.
7. **Bidirectional reputation in v1 vs. v1.x** — affects whether §7 item
   9's Client-side reputation view ships at launch.
8. **Stake sizing policy** — flat 10% vs. tiered vs. waived below a
   threshold vs. first-job waiver. **[blocks the exact stake amount
   shown on the claim screen, §7 item 5]** — build the screen to display
   a config-driven value, not a hardcoded 10%.
9. **SMS/OTP provider** not finalized in `HANDOFF.md` (Africa's Talking
   is what's wired in the current backend slice per `PLAN.md`).
10. **Push notification channel** — not in `HANDOFF.md` (SMS is the only
    specified v1 channel); worth deciding explicitly given mobile-first
    framing (§6).
11. **Reputation pre-claim visibility** — should a Client see a
    Professional's stats before the Professional claims, or only after?
12. **Ledger/transaction-history screen** — not called out as a v1 screen
    in `HANDOFF.md`; worth scoping as a trust-building feature.
13. **Accessibility/localization** requirements not specified.
14. **Rate limiting on OTP requests** — flagged in `PLAN.md` as
    unguarded server-side; relevant to mobile UX (resend button abuse)
    too.

## 13. What's already built vs. what this PRD is scoping

Per `PLAN.md`/`mobile/README.md`, as of this writing:

- Server: Slice 1 (foundation), Slice 2 (Identity — OTP, roles,
  role-profile), and Slice 3 (Gigs — create/publish, criteria lock,
  `FixedPriceAccept`) are implemented, Client/Professional-named
  throughout. No migration has been run against a live DB. Slice 4
  (Payments/Escrow funding) is next and explicitly gated — "first money
  slice — supervise" per `HANDOFF.md` §7.
- Mobile: scaffolded under `mobile/` (React Native/Expo). Screens 01–03
  and 05 (§7 above) are fully wired to the real Identity/Gigs/Taxonomy
  API. Screens 04 and 10 render real UI but read from a session-only
  local cache, not the server — `listGigs` is still a stub. Screens
  06–09 and 11 render real UI with actions disabled, since Payments/
  Escrow/Verification/Ledger/Reputation have no HTTP controller yet —
  each one is flagged in-app with exactly which slice unblocks it. Not
  built at all: gig detail (pre-claim), dispute flow, KYC gate, withdraw
  flow, timeout notice (§7 doesn't cover these; the handoff's own
  "screens not yet started" list does).

## 14. Known-future seams (not built in v1, referenced so mobile doesn't box itself in)

| Future | Backend seam | Mobile implication |
|---|---|---|
| Reverse auction / dynamic pricing | `MatchingStrategy` | Gig detail screen should be able to grow a "bid" state without a rewrite. |
| Structured shortlist matching | `MatchingStrategy` | Gig detail/claim screens should be able to grow a "pick from ranked claimants" state later — but don't build it now (§12 blocks it). |
| Non-human gig sources | `GigIntake` | No mobile impact — gigs still render identically regardless of origin. |
| Recurring gigs | `GigTemplate` | Post-a-gig flow may later gain a "make this recurring" toggle. |
| New funding providers | `PaymentsProvider` | Funding screen already abstracts "escrow provider" — no provider-specific UI in v1. |
| Richer verification | `VerificationStrategy` | Sign-off screen's photo+toggle+inspection pattern may vary per gig type later. |
| Full neutral panel | Disputes interface | Dispute screen's freeze state is stable; resolution detail may deepen. |
| Bidirectional reputation | Reputation (`getReputation`/`recordOutcome`, shared by both roles) | Profile screen should be built to show either role's stats from one data shape, not two bespoke views. |
| Delivery / logistics jobs | Taxonomy now; optional future `LogisticsProvider` later | If built, a delivery gig renders through the same gig detail/claim/escrow screens as any other gig — no separate "logistics mode" UI unless the scope decision (§12) says otherwise. |
| Web app | Notifications + shared API | Mobile and future web consume the same backend contracts — no mobile-only business logic should live client-side. |

---

*Source of truth for architecture/money rules: `HANDOFF.md` §3, §5, §9 —
if this PRD conflicts with those, they win. `HANDOFF.md` §11 items are
explicitly undecided; this PRD flags them, it does not resolve them. This
document scopes the mobile product surface; it does not redefine the
backend module boundaries.*
