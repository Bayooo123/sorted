# Sorted — Build Plan: Slices 1–3

Written per HANDOFF.md §10 ("a written plan for slices 1–3 in §7 with
endpoints, module interfaces, and the screens they back"). No Payments or
Escrow logic (§5) is implemented until this plan is approved — slice 4 is
out of scope here.

Status of this repo right now: module skeleton (nine Nest modules, stub
methods only) and the full Prisma schema from §4 are in place and build
clean (`npx nest build` succeeds, `npx prisma validate` succeeds). Nothing
below is implemented yet.

---

## Slice 1 — Foundation

**Goal:** a running, empty-but-correct skeleton. No business logic.

**Done in this pass:**
- Repo scaffold: `package.json`, `tsconfig*.json`, `nest-cli.json`, `.env.example`.
- Nine Nest modules under `src/modules/*`, each exposing only its documented
  interface (§3) as typed stub methods (`NotImplementedException`).
- `prisma/schema.prisma` — full data model from §4, including every seam
  field (`Gig.source`, `Gig.templateId`, `Criterion.verificationStrategy`,
  `EscrowRecord.platformFeeBps`, taxonomy tables `Domain`/`Submarket`/
  `PayerTypeRef`) and every money-integrity constraint (§9): `BigInt` kobo
  fields, `LedgerEntry.eventId` unique, no `updatedAt` on `LedgerEntry`.
- `PrismaModule` (global, shared infra — not one of the nine business
  modules) so each module can reach its own tables without a second DB
  client per module.

**Not done, deliberately:** no migration has been run against a real
Postgres instance (no `DATABASE_URL` in this environment), no seed data for
the taxonomy tables, no auth, no HTTP controllers/routes yet — every module
is providers-only, nothing is wired to an `@Controller`.

**Screens backed:** none yet — this slice is infrastructure only.

---

## Slice 2 — Identity

**Goal:** phone + OTP auth, roles. HANDOFF.md calls this "the safe first
slice" — it's the one to build before anything money-related.

**Module interface implemented (`IdentityPort`, §3.1):**
- `getUser(userId)`
- `verifyIdentity(userId, input)` — stays a stub until slice 9 (KYC gate);
  this slice only needs role/OTP state, not the `IdentityVerifier` strategy.
- `getPayoutDestination(userId)`
- `assertRole(userId, role)`

**New pieces:**
- `NotificationsService.notify()` gets its first real channel: `{kind:
  'otp', code}` over SMS (provider TBD — Termii/Africa's Talking are typical
  Nigeria SMS rails; not decided by HANDOFF.md, flagging for Jude).
- OTP issuance + verification flow: request OTP → SMS sent → verify code →
  session/JWT issued. `OTP_TOKEN_TTL_SECONDS` from `.env.example` bounds
  validity.
- Registration step 2 — account type (see full writeup below).

### Registration: account type

Agreed after `HANDOFF.md` was written, not in the original doc — captured
here as the decision record. Three account types, all backed by the same
`User.roleFlags String[]` (no schema change needed for the type itself —
this already existed as the §3.1 seam for "new actor types are additive"):

| Type | `roleFlags` | Required at signup |
|---|---|---|
| Professional | `['solver']` | ≥1 `serviceOfferingSubmarketIds` |
| User | `['payer']` | ≥1 `seekingCategorySubmarketIds` |
| Hybrid (**default**) | `['payer','solver']` | **both** lists, ≥1 each |

Decided explicitly: hybrid is not a lighter-touch path. Signing up as
hybrid (the default — a signup does nothing to narrow it) still requires
filling in both "service you offer" and "what you're most likely looking
to get done" before registration completes. No "fill in later" deferral.

Both fields are **structured picks from the `Submarket` taxonomy**, the
same one `Gig.submarket` uses (`HANDOFF.md` §3.2 TAXONOMY seam) — not free
text. Two new join tables carry this (`server/prisma/schema.prisma`):
`SolverServiceOffering` and `PayerSeekingCategory`, each `(userId,
submarketId)`. Reusing the Gigs taxonomy here means "I fix pipes" is a
`Submarket` row a solver can be matched against later (`MatchingStrategy`,
§3.3, is exactly the seam that would consume this), not a string nothing
else in the system can read.

This is the one place this repo's module boundary needed a judgment call:
`Submarket` was written for Gigs, but Identity now has a direct Prisma
relation into it too. Treated as fine because the taxonomy tables are
shared reference/lookup data (seeded, effectively read-only at runtime),
not another module's business state — the "no cross-module table access"
rule in `HANDOFF.md` §9 is about state like `Gig`/`EscrowRecord`, which
still only their owning module touches.

`IdentityService.completeRoleProfile()` (see
`server/src/modules/identity/identity.interface.ts` and
`identity.service.ts`) is the enforcement point: it validates the
roles-vs-lists rule above and writes `User.roleFlags` plus both join
tables' rows in one transaction, so a solver-flagged user can never exist
with zero offerings.

**Endpoints (all in an `IdentityController`, module stays HTTP-free
otherwise per the "modules talk through interfaces" rule — the controller
is the only thing that touches Express/Nest HTTP primitives):**
```
POST /auth/otp/request     { phone }                    -> { requestId }
POST /auth/otp/verify      { requestId, code }           -> { accessToken, user }
GET  /me                   (auth'd)                      -> IdentityUser
PATCH /me/payout-destination (auth'd) { bankCode, accountNumber } -> PayoutDestination
POST /me/role-profile       (auth'd) CompleteRoleProfileInput -> IdentityUser
GET  /taxonomy/submarkets                                -> Submarket[]  (populate the picker)
```

`POST /me/role-profile` is registration step 2, called right after OTP
verification succeeds and before the account is usable — the client
should treat a user with no completed role profile as still mid-signup,
not as a fully registered account.

**Screens backed:** onboarding / phone entry / OTP verification / account
type + category picker screens (not numbered in the mockup list available
to this session — `/screens` wasn't part of this upload; Jude/founding
team to confirm mockup numbers against `SPEC.md` when available).

**Out of scope for this slice:** KYC verification itself (`IdentityVerifier`
strategy, `verifyIdentity` body) — that's slice 9, gating payouts only.

---

## Slice 3 — Gigs + intake seam

**Goal:** post-a-gig, criteria lock, taxonomy seed tables, matching wired to
`FixedPriceAccept` behind the interface (mockups 02–05 per HANDOFF.md §7).

**Module interfaces implemented:**
- `GigsPort` (§3.2): `createGig`, `publishGig`, `getGig`,
  `transitionStatus`. (`listGigs` stays a stub — that's slice 5,
  market/browse.)
- `GigIntake` (§3.2 seam): exactly one implementation,
  `source: 'self_posted'`, driven by a payer filling out the create-gig
  form. This is the seam other intake sources plug into later (§8) — the
  controller below is intentionally the *only* caller of
  `GigsService.createGig`, so a second intake source (e.g. a future signal
  detector) is a second caller of the same method, not a code change to it.
- `MatchingStrategy.priceGig` (§3.3): `FixedPriceAcceptStrategy` becomes a
  real (if trivial) implementation — v1 pricing is a pass-through of the
  payer-supplied `bountyKobo`, no auction, no adjustment.

**New pieces:**
- Taxonomy seed migration: `Domain` (`physical`, `digital`), `Submarket`,
  `PayerTypeRef` rows. Exact submarket/payer-type lists come from
  `SPEC.md` (not in this upload) — placeholder seed data only until then.
- `Gig.status` transitions enforced against an explicit allowed-transition
  map (§9) — e.g. `draft -> escrow_pending` only via `publishGig()`, never a
  raw status PATCH.
- `Criterion.locked` flips to `true` inside `publishGig()`, in the same
  transaction as the status transition, and becomes immutable — enforced
  server-side, not just by client convention.
- `publishGig()` stops short of actually funding escrow (that's slice 4) —
  it locks criteria and sets `status = escrow_pending`, and slice 4 picks up
  from there by calling `EscrowService.fundGig()`.

**Endpoints (`GigsController`):**
```
POST /gigs                  (auth'd, payer) CreateGigInput -> GigRecord (status=draft)
POST /gigs/:id/publish       (auth'd, payer, owner)         -> GigRecord (status=escrow_pending, criteria locked)
GET  /gigs/:id                                              -> GigRecord
```

**Screens backed:** post-a-gig flow (mockups 02–05: gig basics, criteria
entry, review, escrow-pending confirmation) per HANDOFF.md §7 — mockup
numbers as given in the handoff; not independently verified against
`/screens` since those files weren't part of this upload.

**Explicitly not in this slice:** anything in `EscrowService`,
`PaymentsProvider`/Monnify, or `LedgerService.record()` beyond the stub —
those are slice 4 and require the "first money slice — supervise" review
gate per HANDOFF.md §7/§9.

---

## Open items before slices 2–3 can be implemented for real

1. **`SPEC.md` and `/screens`** (HANDOFF.md's companion artifacts) weren't
   included in this upload — only `HANDOFF.md` itself. Screen-exact copy,
   the taxonomy seed list, and mockup numbering above are best-effort from
   HANDOFF.md alone and should be checked against those artifacts once
   available.
2. **SMS/OTP provider** for slice 2 isn't specified in HANDOFF.md — needs a
   decision (cost, Nigeria deliverability) before implementing
   `NotificationsService`'s `otp` channel for real.
3. **Auth/session strategy** (JWT vs. session cookie vs. Nest guard setup)
   isn't specified — reasonable default is short-lived JWT + refresh, but
   flagging as a decision point rather than assuming it silently.

---

*Per HANDOFF.md §10: stop here for review. Slice 4 (Payments module +
Escrow funding) does not start until this plan is approved.*
