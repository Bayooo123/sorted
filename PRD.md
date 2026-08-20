# Sorted — Product Requirements Document (v1, Mobile)

**Status:** Draft, derived from `HANDOFF.md` (architecture/CTO handoff) and
`PLAN.md` (build-slice log). `SPEC.md` and `/screens` — the product/UX
companion artifacts `HANDOFF.md` references throughout — are **not present
in this repo**. Anywhere this PRD needs screen-exact copy or confirmed
mockup numbers, it says so instead of guessing. Reconcile against those
artifacts once available.

**Primary surface: the mobile app.** The repo root's `index.html` is a
waitlist landing page only — it is not the product. The product is the
React Native (Expo) app described below. Nothing about escrow, gigs, or
sign-off exists as a frontend yet; this PRD defines what to build.

---

## 1. Problem

Informal work in Nigeria (physical trades — plumbing, cleaning, repairs —
and digital gigs) runs on trust with no enforcement mechanism. Payers risk
paying for work that isn't done to spec, or not knowing if a solver is
reliable before hiring. Solvers risk doing work and not getting paid, or
having scope change after they've started. There's no shared record of who
delivers.

## 2. Solution

An escrow-mediated marketplace: a payer posts a gig with **locked
completion criteria** and a bounty; a solver claims it (staking a % as
skin-in-the-game); money sits in Monnify-held escrow until the payer signs
off against those same locked criteria; funds release automatically on
sign-off, or freeze for neutral arbitration on dispute. Every naira
movement is append-only-logged. Completion/dispute history compounds into
a reputation score — the intended long-term moat.

**Product name:** Sorted. Tagline: "Consider it sorted."

## 3. Goals (v1)

- A payer can post a gig, fund it via escrow, and get it done by a solver
  they didn't have to personally vet, with money released only when they
  confirm the locked criteria were met.
- A solver can find gigs matching what they offer, claim one with a stake,
  do the work, submit proof, and get paid automatically on sign-off — no
  chasing payment.
- Neither party can unilaterally take the other's money: release requires
  sign-off or a neutral ruling; disputes freeze funds for real.
- The mobile app is the entire transacting surface — no web app in v1.

## 4. Non-goals (v1)

Explicitly deferred — see §11 for where each plugs back in later:

- Reverse auction / dynamic or signal-based pricing (v1 = fixed price, first-claim).
- Non-human gig sources (signal detection, institutional feeders).
- Recurring/templated gigs.
- A second payments provider or non-Monnify funding flows (e.g. government procurement).
- Automated/richer verification (photo sign-off by the payer is the only mechanism).
- A full neutral-arbitration panel (v1 disputes can be admin-assisted, but the money freeze must be real).
- Secondary market in verified-outcome positions.
- Web app.
- Cities/currencies beyond Lagos/NGN (structurally supported as data, not built as a feature).

## 5. Users

| Persona | Definition | Signup requirement |
|---|---|---|
| **Professional** (solver-only) | `roleFlags: ['solver']` | ≥1 service-offering submarket |
| **User** (payer-only) | `roleFlags: ['payer']` | ≥1 seeking-category submarket |
| **Hybrid** (default) | `roleFlags: ['payer','solver']` | both lists, ≥1 each — not a lighter-touch path; both required at signup, no "fill in later" |

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
- **Camera/media:** proof submission (§9, SUBMIT step) is a native
  camera/gallery picker per locked criterion — this is a core mobile
  capability, not a nice-to-have.
- **OTP UX:** native SMS autofill (iOS/Android autofill APIs) for the OTP
  code entry — this is a first-run funnel step, friction here is
  expensive.
- **Push notifications:** gig/escrow/dispute events (funded, claimed,
  submitted, released, disputed) need push, not just in-app state — a
  payer or solver won't have the app open when a webhook fires. SMS is the
  v1 channel per `HANDOFF.md` §3.9; push is the natural mobile-first
  upgrade and should be scoped explicitly (open question, §12).
- **Session persistence:** JWT + refresh (per `PLAN.md`'s flagged
  decision) should survive app restarts without re-OTP on every open —
  balance against session length reasonable for a money app.
- **App size / offline:** no offline-first requirement for v1 (money
  state must be server-authoritative), but the app shell and static
  taxonomy data (submarkets, domains) can be cached client-side to avoid
  a network round-trip on every screen that needs a picker.

## 7. Information architecture (screens)

Numbered mockups below are as cited in `HANDOFF.md` §7/§5 only — not
independently verified since `/screens` wasn't part of this repo. Treat
numbers as provisional pending `SPEC.md`.

1. **Onboarding** — phone entry → OTP verify → account type (Professional
   / User / Hybrid) → submarket picker(s) (service-offering and/or
   seeking-category, structured picks, not free text).
2. **Post a gig** (mockups 02–05) — gig basics (title, description,
   domain/submarket/payer type, location, materials mode) → criteria
   entry (ordered list, locks at publish) → review → escrow-pending
   confirmation.
3. **Escrow funding** (mockup 06) — payer funds the holding account;
   screen reflects `awaiting_funding` → `funded` once the Monnify webhook
   confirms.
4. **Market / browse** (mockup 07) — Physical/Digital tab, submarket +
   payer-type filters, gig list.
5. **Gig detail** (mockup 08) — full gig view, locked criteria, claim
   action (with stake amount shown before commit).
6. **Claim + work** (mockup 09) — solver's active-gig checklist against
   locked criteria, proof capture per criterion.
7. **Sign-off** (mockups 10–11) — payer taps met/not-met per criterion
   against submitted proof; completion screen post-release.
8. **Dispute flow** — raise dispute, frozen-state indicator, ruling
   outcome (no mockup number available).
9. **Reputation** — track record surfaced on profile (`jobs_completed`,
   `dispute_rate`) — no mockup number available; confirm whether this is
   a v1 screen or just backend-tracked in v1.

## 8. Functional requirements by module

Mirrors the nine backend modules in `HANDOFF.md` §3 — each is a boundary
the mobile app talks to only through its documented interface/endpoints,
never around it.

| Module | Mobile-facing requirement |
|---|---|
| **Identity** | Phone+OTP login; role-profile completion gate (empty `roles: []` routes back into onboarding, not into the app); payout-destination form (bank code, account number, name) — required before a solver can be paid out. |
| **Gigs** | Create/publish gig form with locked-criteria entry; status displayed at every stage (`draft → escrow_pending → open → claimed → in_progress → submitted → signed_off/disputed → released/refunded/cancelled`). |
| **Matching** | v1: transparent fixed-price, first-credible-claim. No bidding UI in v1. |
| **Payments** | App never talks to Monnify directly — always through backend endpoints. Funding screen must clearly show amount, and reflect webhook-driven state changes without requiring manual refresh (poll or push). |
| **Escrow** | Every money-state transition (fund/stake/release/refund/freeze) must be visible to the affected user in near-real-time; fee (10% launch rate) and stake (~10%) shown before commitment, not after. |
| **Verification** | Payer sign-off screen: photo evidence + met/not-met toggle per locked criterion, submitted atomically (not per-criterion partial submits in v1). |
| **Disputes** | Either party can raise a dispute from an active/submitted gig; UI must make the "money is frozen" state unambiguous — this is the one state where "nothing is happening" is the correct and expected behavior. |
| **Ledger** | Not necessarily a v1 UI (backend is append-only source of truth) — but a per-gig transaction history view (fund/stake/release/fee) is worth scoping as a trust-building screen (open question, §12). |
| **Reputation & Notifications** | Push/SMS on every gig-lifecycle event affecting the user; reputation numbers shown on profile / pre-claim (payer sees solver's `jobs_completed`/`dispute_rate` before... — confirm this is desired pre-claim visibility, open question). |

## 9. Core flow — escrow state machine (reference)

```
PUBLISH   → criteria lock, Escrow=awaiting_funding
FUND      → payer transfers bounty, webhook verified → Escrow=funded, Gig=open
CLAIM     → solver stakes ~10% → Escrow=stake_held, Gig=claimed→in_progress
SUBMIT    → proof per criterion, Gig=submitted (no money moves)
SIGN-OFF  → payer confirms all criteria met → Escrow=releasing → disburse
            (solver 90% + stake back, Sorted 10% fee) → released
DISPUTE   → either party, any point post-claim → Escrow=dispute_hold (frozen)
            → neutral ruling: for_solver (pay as happy path) /
              for_payer (refund, solver stake forfeit) / split /
              payer bad-faith (penalty to payer, solver still paid)
TIMEOUT   → solver abandons/late → stake forfeit; reopen or refund
```

Fee example (₦85,000 gig): payer funds ₦85,000, solver stakes ₦8,500 →
sign-off → solver gets ₦76,500 + ₦8,500 stake back, Sorted gets ₦8,500.
Fee floor: `max(bps × bounty, ₦300)`.

**This state machine is fixed** (`HANDOFF.md` §5/§9) — the mobile app
reflects it, it does not invent additional client-side states.

## 10. Non-functional requirements

- **Money correctness is the top-priority NFR.** Integer kobo throughout
  (never float, including on the client — no client-side currency math
  beyond display formatting). All balance-changing screens must handle
  "request succeeded but state unclear" (e.g. app backgrounded mid-call)
  by re-fetching authoritative state on resume, never assuming success.
- **Idempotency:** any client action that triggers a money transition
  (fund confirmation polling, claim+stake, sign-off) must be safe to retry
  without double-effect — enforced server-side (`event_id`/idempotency
  keys per `HANDOFF.md` §9), but the client shouldn't double-submit on a
  double-tap either (disable-on-submit).
- **Security:** JWT-gated routes; no payer/solver ID trusted from client
  payloads (already enforced server-side per `PLAN.md` slice 3 — client
  should never need to pass its own user ID for auth'd actions).
  Payout-destination and OTP screens are the two most sensitive mobile
  surfaces — no analytics/logging of OTP codes or bank details client-side.
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
- Dispute rate (the reputation-moat metric already tracked server-side).
- Time from publish to claim (marketplace liquidity signal).
- OTP request → verified conversion (mobile onboarding funnel health).

## 12. Open questions / gaps

1. **`SPEC.md` and `/screens` are missing from this repo.** This PRD is
   built from `HANDOFF.md` + `PLAN.md` only; screen copy, exact mockup
   numbers, and the full taxonomy list should be reconciled against those
   once available.
2. **SMS/OTP provider** not finalized (`PLAN.md` flags Termii vs Africa's
   Talking as typical Nigeria options; Africa's Talking is what's wired in
   the current backend slice).
3. **Push notification channel** — not in `HANDOFF.md` (SMS is the only
   specified v1 channel); worth deciding explicitly given mobile-first
   framing (§6).
4. **Reputation visibility** — should a payer see a solver's
   `jobs_completed`/`dispute_rate` before the solver claims, or only
   after? Affects the browse/gig-detail screens.
5. **Ledger/transaction-history screen** — not called out as a v1 screen
   in `HANDOFF.md`; worth scoping as a trust-building feature given the
   backend already stores this data append-only.
6. **Accessibility/localization** requirements not specified.
7. **Rate limiting on OTP requests** — flagged in `PLAN.md` as unguarded
   server-side; relevant to mobile UX (resend button abuse) too.

## 13. What's already built vs. what this PRD is scoping

Per `PLAN.md`, as of this writing:

- **Backend only**, no mobile frontend exists yet.
- Slice 1 (foundation), Slice 2 (Identity — OTP, roles, role-profile) and
  Slice 3 (Gigs — create/publish, criteria lock, `FixedPriceAccept`) are
  implemented server-side. No migration has been run against a live DB.
- Slice 4 (Payments/Escrow funding) is the next slice and is explicitly
  gated — "first money slice — supervise" per `HANDOFF.md` §7.
- This PRD's screens map onto slices 1–7 (§7 above); the mobile app can
  start build against the Identity and Gigs endpoints already implemented
  (`PLAN.md` §Slice 2/3 endpoint lists) while Payments/Escrow is reviewed.

## 14. Known-future seams (not built in v1, referenced so mobile doesn't box itself in)

| Future | Backend seam | Mobile implication |
|---|---|---|
| Reverse auction / dynamic pricing | `MatchingStrategy` | Gig detail screen should be able to grow a "bid" state without a rewrite. |
| Non-human gig sources | `GigIntake` | No mobile impact — gigs still render identically regardless of origin. |
| Recurring gigs | `GigTemplate` | Post-a-gig flow may later gain a "make this recurring" toggle. |
| New funding providers | `PaymentsProvider` | Funding screen already abstracts "escrow provider" — no provider-specific UI in v1. |
| Richer verification | `VerificationStrategy` | Sign-off screen's photo+toggle pattern may vary per gig type later. |
| Full neutral panel | Disputes interface | Dispute screen's freeze state is stable; resolution detail may deepen. |
| Web app | Notifications + shared API | Mobile and future web consume the same backend contracts — no mobile-only business logic should live client-side. |

---

*Source of truth for architecture/money rules: `HANDOFF.md` §3, §5, §9 —
if this PRD conflicts with those, they win. This document scopes the
mobile product surface; it does not redefine the backend module
boundaries.*
