# Sorted — Build Plan: Slices 1–3

Written per HANDOFF.md §10 ("a written plan for slices 1–3 in §7 with
endpoints, module interfaces, and the screens they back"). No Payments or
Escrow logic (§5) is implemented until this plan is approved — slice 4 is
out of scope here.

Status of this repo right now: module skeleton (nine Nest modules) and the
full Prisma schema from §4 are in place. **Slice 2 (Identity: OTP auth,
JWT, role-profile registration) is implemented for real** — see its
section below for what that covers and what's still open. Slices 3+ are
still stub methods only. `npx nest build` and `npx prisma validate` both
pass.

No migration has been run against a live database yet — schema changes
are written and validated, not applied. Whoever sets `DATABASE_URL`
(Postgres-compatible) needs to run `npx prisma migrate dev` and
`npm run prisma:seed` before slice 2 actually works end-to-end.

**Terminology debt — resolved.** `HANDOFF.md`'s Aug 2026 revision locked
`Client`/`Professional` as the naming and added it to §9's non-negotiable
checklist ("no `payer`/`solver` remnants"). The code implemented for
slices 1–3 originally used `payer`/`solver` throughout — Prisma schema
(`Gig.payerId`, `Claim.solverId`, etc.), module interfaces (`GigsPort`,
`MatchingStrategy`), DTOs, and endpoint payloads (19 files). Since no
migration had run against a live DB, this was a clean mechanical rename
(schema + code, verified with `npx prisma validate` and `npx nest build`,
both pass) — done as its own pass before slice 4, so Payments/Escrow (§5)
is built against `refundClient`/`releaseToProfessional` from the start,
not the old names. `PayerTypeRef` → `ClientTypeRef`, `SolverServiceOffering`
→ `ProfessionalServiceOffering`, `PayerSeekingCategory` →
`ClientSeekingCategory`, `payer-signoff.strategy.ts` →
`client-signoff.strategy.ts`, and all method/field/enum names below are
updated accordingly — endpoint paths and request/response *shapes* are
unchanged, only field names (e.g. `payerId` → `clientId` in
`CreateGigInput`/`GigRecord`, `roles: ['payer','solver']` →
`roles: ['client','professional']`).

**Mobile app scaffolded — see `mobile/README.md` for full detail.** React
Native (Expo, TypeScript) under `mobile/`, built against this plan's real
endpoints plus the Aug 2026 mobile screens handoff (11 screens). Screens
01–03 and 05 are fully wired to the real Identity/Gigs/Taxonomy API;
screens 04 and 10 read from a session-only local cache
(`GigsCacheContext`) since `listGigs` is still a stub; screens 06–09 and
11 render real UI with actions disabled, since Payments/Escrow/
Verification/Ledger/Reputation have no HTTP controller yet. `npx tsc
--noEmit` passes. Not built: gig detail (pre-claim), dispute flow, KYC
gate, withdraw flow, timeout notice — the handoff's own "screens not yet
started" list.

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
  `ClientTypeRef`) and every money-integrity constraint (§9): `BigInt` kobo
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
| Professional | `['professional']` | ≥1 `serviceOfferingSubmarketIds` |
| Client | `['client']` | ≥1 `seekingCategorySubmarketIds` |
| Hybrid (**default**) | `['client','professional']` | **both** lists, ≥1 each |

(Renamed from the original Professional/User/Hybrid + payer/solver draft to
match `HANDOFF.md`'s Aug 2026 Client/Professional terminology lock — see
the note at the top of this file. Whether Hybrid itself still ships as a
v1 account type isn't restated in that revision; flagged as open in
`PRD.md` §12.)

Decided explicitly: hybrid is not a lighter-touch path. Signing up as
hybrid (the default — a signup does nothing to narrow it) still requires
filling in both "service you offer" and "what you're most likely looking
to get done" before registration completes. No "fill in later" deferral.

Both fields are **structured picks from the `Submarket` taxonomy**, the
same one `Gig.submarket` uses (`HANDOFF.md` §3.2 TAXONOMY seam) — not free
text. Two new join tables carry this (`server/prisma/schema.prisma`):
`ProfessionalServiceOffering` and `ClientSeekingCategory`, each `(userId,
submarketId)`. Reusing the Gigs taxonomy here means "I fix pipes" is a
`Submarket` row a Professional can be matched against later
(`MatchingStrategy`, §3.3, is exactly the seam that would consume this),
not a string nothing else in the system can read.

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
tables' rows in one transaction, so a professional-flagged user can never
exist with zero offerings.

**Endpoints — IMPLEMENTED (all in `IdentityController`, module stays
HTTP-free otherwise per the "modules talk through interfaces" rule — the
controller is the only thing that touches Express/Nest HTTP primitives):**
```
POST /auth/otp/request     { phone }                    -> { requestId }
POST /auth/otp/verify      { requestId, code }           -> { accessToken, user }
GET  /me                   (auth'd)                      -> IdentityUser
PATCH /me/payout-destination (auth'd) { bankCode, accountNumber, accountName } -> PayoutDestination
POST /me/role-profile       (auth'd) CompleteRoleProfileInput -> IdentityUser
GET  /taxonomy/submarkets                                -> Submarket[]  (populate the picker)
GET  /taxonomy/domains                                   -> Domain[]
GET  /taxonomy/client-types                              -> ClientTypeRef[]  (added for the Post-a-gig
                                                             form's clientType picker — same read-only,
                                                             no-gig-lifecycle-logic rationale as the
                                                             other two taxonomy endpoints)
```

`POST /me/role-profile` is registration step 2, called right after OTP
verification succeeds and before the account is usable — the mobile app
should treat a user with `roles: []` (empty) as still mid-signup, not as a
fully registered account. `GET /me` returns that empty-roles state as-is,
by design — it's the app's signal to route back into onboarding. (Using
"the mobile app" here, not "the client", to avoid colliding with the
Client *role* name.)

Implementation notes:
- OTP codes: 6 digits, scrypt-hashed (Node built-in, no new dependency —
  raw code is never stored), `OTP_TOKEN_TTL_SECONDS` expiry,
  `OTP_MAX_ATTEMPTS` guess limit per request. First OTP request for a
  phone number upserts a bare `User` row (`roleFlags: []`).
- JWT via `@nestjs/jwt`, `JWT_SECRET`/`JWT_EXPIRES_IN` in `.env.example`.
  `JwtAuthGuard` + `@CurrentUser()` decorator gate the auth'd routes.
- SMS via Africa's Talking (`NotificationsService`, real implementation —
  see `server/.env.example` for `AFRICASTALKING_*` vars). Fixed a real
  module-boundary issue while wiring this: `NotificationsPort.notify()`
  used to take just a `userId`, which would force Notifications to look up
  the phone number itself — either reading Identity's `User` table
  directly (forbidden by §9) or importing IdentityModule and creating a
  circular dependency (Identity already imports Notifications to send
  OTPs). Fixed by having the caller pass the phone in (`NotifyTarget`),
  since Identity already has it.
- `npm run prisma:seed` populates `Domain`/`Submarket`/`ClientTypeRef` with
  a starting taxonomy (10 physical + 10 digital submarkets, 4 client
  types) — a starting set, not final; adding more is a seed re-run, not a
  deploy, per the TAXONOMY seam.

**Not implemented / explicitly deferred:**
- `IdentityVerifier` strategy / `verifyIdentity()` body — slice 9 (KYC
  gate), gating payouts only.
- Rate limiting on `/auth/otp/request` beyond the per-request attempt cap
  — nothing currently stops someone spamming OTP requests at a phone
  number. Worth a guard (e.g. max N requests per phone per hour) before
  this is exposed to real traffic at any volume, not just a demo.
- No migration has been run against a real database — see the note at the
  top of this file.

**Screens backed:** onboarding / phone entry / OTP verification / account
type + category picker screens (not numbered in the mockup list available
to this session — `/screens` wasn't part of this upload; Jude/founding
team to confirm mockup numbers against `SPEC.md` when available).

---

## Slice 3 — Gigs + intake seam — IMPLEMENTED

**Goal:** post-a-gig, criteria lock, taxonomy seed tables, matching wired to
`FixedPriceAccept` behind the interface (mockups 02–05 per HANDOFF.md §7).

**Module interfaces implemented:**
- `GigsPort` (§3.2): `createGig`, `publishGig`, `getGig`,
  `transitionStatus`. (`listGigs` stays a stub — that's slice 5,
  market/browse.)
- `GigIntake` (§3.2 seam): exactly one implementation,
  `source: 'self_posted'`, driven by a Client filling out the create-gig
  form. This is the seam other intake sources plug into later (§8) — the
  controller below is intentionally the *only* caller of
  `GigsService.createGig`, so a second intake source (e.g. a future signal
  detector) is a second caller of the same method, not a code change to it.
- `MatchingStrategy.priceGig` (§3.3): `FixedPriceAcceptStrategy` becomes a
  real (if trivial) implementation — v1 pricing is a pass-through of the
  Client-supplied `bountyKobo`, no auction, no adjustment.

**New pieces:**
- Taxonomy seed migration: `Domain` (`physical`, `digital`), `Submarket`,
  `ClientTypeRef` rows. Exact submarket/client-type lists come from
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
POST /gigs                  (auth'd, client) CreateGigInput -> GigRecord (status=draft)
POST /gigs/:id/publish       (auth'd, client, owner)         -> GigRecord (status=escrow_pending, criteria locked)
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

**Implementation notes:**
- `domain`/`submarket`/`clientType` on `CreateGigInput` are taxonomy
  **keys** (e.g. `"plumbing"`, not a cuid) — `GigsService.createGig`
  resolves them to IDs and 400s on an unknown key. Matches how
  `GET /taxonomy/submarkets` returns them.
- `clientId` is never trusted from the request body — `GigsController`
  takes it from the verified JWT (`@CurrentUser()`), so a caller can't
  post a gig as someone else by editing JSON.
- `createGig` calls `IdentityService.assertRole(clientId, 'client')` before
  anything else — the cross-module call `IdentityPort.assertRole` exists
  for exactly this.
- Extracted `common/auth/` (`AuthModule`, `JwtAuthGuard`,
  `@CurrentUser()`) out of the Identity module folder, where slice 2 had
  put it. Every module with auth'd routes needs the guard, not just
  Identity, and the guard has no business-state dependency, so it belongs
  next to `PrismaModule` as shared infra rather than being imported
  cross-module from inside Identity's folder. `GigsModule` imports
  `AuthModule` directly (not transitively through `IdentityModule`) for
  the same reason: it needs the guard itself, not Identity's business
  logic.
- The full `Gig.status` allowed-transition map (§9) is written now, even
  though most target states aren't reachable yet (their owning slice
  isn't built) — so slices 4–8 call `transitionStatus()` against an
  already-reviewed rule instead of each inventing its own check.

**Still open:** `listGigs` stays a stub (slice 5). No migration has run
against a live database — see the note at the top of this file.

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
