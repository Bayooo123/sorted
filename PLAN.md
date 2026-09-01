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
POST /auth/otp/request     { phone } or { email } (exactly one) -> { requestId }
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
  number or email. Worth a guard (e.g. max N requests per identifier per
  hour) before this is exposed to real traffic at any volume, not just a
  demo.
- No migration has been run against a real database — see the note at the
  top of this file.

### Email-OTP signup (alternative to phone) — IMPLEMENTED

Agreed after `HANDOFF.md` was written, not in the original doc — captured
here as the decision record, same as "Registration: account type" above.
Resend (the landing page's email provider, see the "Rework landing page"
history) has no SMS/phone-OTP product, and NaijaBase's phone-OTP is a
paid-plan feature not yet in use. Rather than block signup on that,
`requestOtp` now accepts **either** `phone` **or** `email` (exactly
one — 400s on zero or both). Phone stays the intended eventual
identifier product-wise (add it as a later, "compulsory" step for
email-first signups) — this isn't a replacement of phone+OTP, it's a
second channel into the same flow.

**Schema:** `User.phone` and `User.email` are both now nullable+unique
(was `phone String @unique`, no `email` column at all). `OtpRequest`
gained a nullable `email` column alongside the now-nullable `phone`.
Migration `20260829000000_add_email_otp` — generated offline via `prisma
migrate diff --from-schema-datamodel <prior schema> --to-schema-datamodel
prisma/schema.prisma --script` (no DB connection needed, unlike
`--from-migrations` which requires a shadow database) — same "couldn't
apply it from this session" situation as the init migration; apply with
`npx prisma migrate deploy` wherever there's real Postgres connectivity.

**Notifications:** `NotifyTarget.phone`/`.email` are both now optional;
`NotificationsService.notify()`'s `'otp'` case branches to email (Resend,
direct REST call, same pattern as `api/send-welcome-email.js` but a
separate `RESEND_API_KEY` — this is the server's own deployment, not the
landing page's Vercel env) when `email` is set, SMS otherwise. This is
exactly the "push/WhatsApp/email are added channels behind the same
`notify()` call" seam `HANDOFF.md` §3.9 already specified — no interface
redesign needed, just a new branch.

**JWT:** payload dropped `phone` (was `{sub, phone}`, now `{sub}` only) —
phone is no longer guaranteed to exist on every user, and nothing
downstream read `AuthenticatedUser.phone` off the guard (checked before
removing it).

**Mobile app and its phone+OTP screens are untouched** — `requestOtp`
still accepts `{phone}` exactly as before; email is additive, not a
replacement. Only the landing page's login/signup modal (`index.html`)
was switched to send `{email}` instead of `{phone}`.

**Screens backed:** onboarding / phone entry / OTP verification / account
type + category picker screens (not numbered in the mockup list available
to this session — `/screens` wasn't part of this upload; Jude/founding
team to confirm mockup numbers against `SPEC.md` when available).

**Superseded by "Password-based auth" below** — the whole phone/email +
OTP model (including this section's mobile-untouched claim) was replaced.
Kept here as the decision record for why email-OTP existed in the first
place; not still true of the current auth flow.

---

### Password-based auth (replaces phone/email + OTP) — IMPLEMENTED

Product decision, not in `HANDOFF.md`: OTP-based auth (phone, then email
alongside it) is out; signup and login now use email/phone + password, on
both the landing page and the mobile app. Requested directly, explicitly
choosing the largest of three options (add profile fields to OTP; add
password alongside OTP; replace OTP with password entirely) after the
landing page's login modal was confirmed working end-to-end on OTP —
this is a deliberate reversal of that design, not a bug fix.

**Schema:** `User` gains `passwordHash String?` and `state String?`
(Nigerian state — see `common/nigerian-states.ts`, a plain 37-item
constant, not a taxonomy table, since it doesn't change and isn't matched
against anything). `phone`/`email`/`name` stay nullable at the DB level
(same reasoning as the email-OTP migration: avoids a NOT NULL migration
against rows created under the old flow) — both email and phone are
required at signup, enforced in `SignupDto`/`IdentityService`, not the
schema. `OtpRequest` is no longer written to or read by any code path but
was **not** dropped from the DB — an orphaned table costs nothing and
dropping it would've meant another migration cycle for zero functional
gain; safe to drop later in a cleanup pass. Migration
`20260830210000_password_auth` — generated offline the same way as
before (`prisma migrate diff --from-schema-datamodel <prior> --to-schema-
datamodel prisma/schema.prisma --script`); apply via
`npx prisma migrate deploy` or paste `migration.sql` into a SQL editor
wherever there's real Postgres connectivity, same as every migration this
project has needed so far.

**Identity module:** `requestOtp`/`verifyOtp` replaced by `signup(input)`
and `login(input)` on `IdentityService` (still not on `IdentityPort` —
HTTP-triggered only, same as before). `signup` rejects a duplicate
email/phone with 409, hashes the password with `bcryptjs` (12 rounds,
picked over Node's native scrypt-based OTP hashing this replaces because
passwords need a battle-tested adaptive hash, not a bespoke one — and
over `bcrypt` because Vercel's serverless function bundler doesn't need
to fight a native addon). `login` accepts an `identifier` (email or
phone, checked against both columns in one query) plus `password`, and
returns the same shape as signup (`{accessToken, user}`) so callers don't
branch on which one they used. JWT payload is unchanged (`{sub}` only).

**Endpoints (`IdentityController`):**
```
POST /auth/signup   { email, phone, name, state, password } -> { accessToken, user }
POST /auth/login    { identifier, password } -> { accessToken, user }
```
Replaces `POST /auth/otp/request` and `POST /auth/otp/verify`, removed
entirely (not kept as deprecated aliases — nothing depended on them
existing past this change since both callers, the landing page and the
mobile app, were updated in the same pass).

**Notifications:** `NotificationsService.notify()`'s only implemented
case (`'otp'`) is gone along with it, since nothing calls `notify()`
anymore — every event kind now falls through to
`NotImplementedException`, same as it already did for `gig_funded` etc.
The Africa's Talking/Resend integration code that lived in
`sendSms`/`sendOtpEmail` was deleted (dead code, not kept "just in
case") — whichever gig/escrow/dispute slice needs a channel first
re-adds it then, per the module's existing channel-agnostic seam
(`HANDOFF.md` §3.9).

**Landing page (`index.html`):** the single-step email+OTP modal became a
two-tab Log in / Sign up form. Sign up collects name, email, phone,
state (a fixed Nigeria-only picker — country isn't a free-choice field,
just displayed), and password (min. 8 characters, validated client-side
before the request goes out). Login takes one `identifier` field (email
or phone) plus password. Post-auth routing (mid-signup → account-type
step; already has roles → done) is unchanged from the OTP version — only
how the token gets minted changed, not what happens after.

**Mobile app:** `PhoneSignInScreen.tsx` and `OtpVerifyScreen.tsx` deleted,
replaced by a single `SignInScreen.tsx` with the same Log in/Sign up tab
pattern as the web modal (chip-based state picker, matching the app's
existing `AccountTypeScreen` chip UI rather than adding a native picker
dependency). `AuthStackParamList` now has one `SignIn` route instead of
`PhoneSignIn`/`OtpVerify`. `api/identity.ts` gained `signup`/`login`,
lost `requestOtp`/`verifyOtp`; `IdentityUser` gained `email`/`state` and
`phone` became nullable to match the server type.

**Explicitly not done:** no password-reset/forgot-password flow (a real
gap for a production password system — flagged here, not silently
skipped); no rate-limiting on login attempts beyond whatever the
platform provides (OTP had `OTP_MAX_ATTEMPTS`, password auth currently
has no equivalent lockout); `OtpRequest` table cleanup (see Schema note
above).

---

### Welcome email on signup — IMPLEMENTED

Gap noticed right after password auth shipped: real signups
(`POST /auth/signup`) sent no email at all — the only "welcome email"
that existed was `api/send-welcome-email.js`, wired to the landing
page's waitlist form, a completely different audience/deployment from
an actual product signup. Fixed by making `NotificationsService`'s
`'user_signed_up'` case the first (and, for now, only) implemented
`NotificationEvent` — same Resend REST call pattern as the old OTP
email and the waitlist one, reusing the server's already-verified
`RESEND_API_KEY`/`RESEND_FROM_EMAIL`.

**IdentityService.signup()** calls `notifications.notify()` after the
`User` row is created, but doesn't `await` it into the response path —
wrapped in `.catch()` that only logs. A Resend outage must not turn an
otherwise-successful signup into a 500; the account already exists by
the time the email would send. No email is sent if a signup somehow
lacks one (not reachable today — `SignupDto` requires it — but the
check exists rather than assuming).

**Explicitly not done:** no retry-on-failure for the email itself (a
failed send is logged and dropped, not queued); no similar email for
login (only signup, matching what "welcome" means); the mobile app's
signup calls the same `POST /auth/signup`, so it gets this for free —
no separate mobile-side change needed.

---

### GET /gigs — real listing (replaces the slice-5 stub) — IMPLEMENTED

Prompted by building the web app pages below: "browse jobs" needs a real
list from somewhere, and the mobile app's own Browse/Home screens were
already faking it with a session-local cache for exactly this reason
(`GigsCacheContext`, now deleted). Fixed once, for both platforms,
instead of adding a second fake version on web.

**GigsPort.listGigs(filter)** is real now. `filter.clientId` set -> that
client's own gigs, any status including draft ("my gigs" — Escrow/
Payments-adjacent, so only ever set from the verified JWT, never a query
param). `filter.clientId` unset -> public browse: `draft` is always
excluded server-side regardless of what `status` is requested — an
unpublished gig's title/description/bounty isn't meant to be visible to
anyone but its owner. `domain`/`submarket`/`clientType` filter by
taxonomy key, same as `createGig`.

**GigRecord grew real fields** it never had: `title`, `description`,
`domain`, `submarket`, `locationText`, `materialsMode`, `criteria`,
`createdAt`, `publishedAt` — previously just id/status/bounty/etc., which
is why the mobile app rendered "Gig a1b2c3d4" instead of a real title
everywhere. Fixed at the type level so this can't regress: `toGigRecord`
now takes the Prisma-included shape (`domain`/`submarket`/`criteria`
relations), not the bare row.

**Endpoints (`GigsController`):**
```
GET /gigs                (public)          ?domain&submarket&clientType&status -> GigRecord[] (draft always excluded)
GET /gigs/mine           (auth'd)          ?domain&submarket&clientType&status -> GigRecord[] (own gigs, any status)
```
`mine` is registered ahead of `:id` so it isn't parsed as a gig id.

**Mobile app:** `GigsCacheContext` deleted entirely — it was also never
actually broken (correction to an earlier claim in this same work: it
*was* mounted in `App.tsx`, contrary to what I first assumed from an
incomplete grep). `HomeFeedScreen`/`BrowseMarketScreen` now call
`listMyGigs()`/`listGigs({status:'open'})` for real, refetching on every
focus (`useFocusEffect`) so posting a gig or changing its status
elsewhere shows up without a manual reload. `FundEscrowScreen`/
`ClaimWorkScreen`/`ReviewSignOffScreen` switched from a cache lookup to
`getGig(gigId)`, and `ClaimWorkScreen`/`ReviewSignOffScreen` now show the
real title instead of a truncated id.

---

### Web app pages (post-login) — IMPLEMENTED

The landing page's login/signup modal used to end at "the Sorted mobile
app is where you post and claim gigs" — a dead end for anyone who'd just
signed up on the web and had no reason yet to install anything else.
Replaced with real post-login pages on `sorted.com.ng` itself: My gigs,
Browse, Post a gig, Profile — a `#app-shell` full-viewport view (same
overlay pattern as the auth modal) that replaces the "done" step
entirely; signup/login/finish-account-setup all land here now instead of
showing a closing confirmation.

**What's real:** My gigs (`GET /gigs/mine`) and Browse (`GET /gigs?
status=open`) both read the real listing above. Post a gig
(`POST /gigs` + `POST /gigs/:id/publish`) is the same real flow the
mobile app's `PostGigScreen` uses — same validation (₦3,000 bounty floor,
domain/category/posting-as pickers off live taxonomy, at least one
criterion), same two-call publish sequence. Profile shows the real
`IdentityUser` fields. A session persists across a page reload (checks
`localStorage` for a token and calls `GET /me` on load, same as the
mobile app's `AuthContext`).

**What's explicitly not built here, said so in the UI itself rather than
faked:** funding a gig (escrow) and reviewing/signing off both stay
mobile-only — a gig sitting at `escrow_pending` or `submitted` in "My
gigs" shows a plain note ("Fund this gig from the Sorted mobile app...")
instead of a dead button or a fake action. Claiming a gig from Browse
isn't wired on *either* platform yet (`MatchingStrategy.assignProfessional`
doesn't exist server-side) — Browse cards say "Claiming isn't available
yet" rather than linking somewhere that does nothing.

**Not done:** no gig detail page (the list cards are the only view — no
click-through); no edit-after-post; no pagination (`listGigs` caps at
100, matching the server-side `take: 100`).

---

### PATCH /me/profile — edit name/phone/state — IMPLEMENTED

Needed the moment the web Profile tab shipped: every account created
during this session's phone/email+OTP testing has `name`/`phone`/`state`
all null (that era never collected them), and there was no way to fill
them in — the account is real, the fields are just genuinely empty, not
a bug. `IdentityService.updateProfile(userId, input)` backfills whichever
of `name`/`phone`/`state` are given; unset fields are left alone (not
cleared).

**phone normalization**, added here since a raw profile-edit text field
is exactly where someone types a number the way they'd say it out loud,
not in E.164: `normalizeNigerianPhone` accepts a 0-prefixed Nigerian
local number (`09031812675` -> `+2349031812675`) as well as already-E.164
input. Applied to `login`'s phone lookup too, in the same pass — it
previously only matched an identifier stored exactly as typed, which
would have silently failed to match an E.164-stored phone against a
local-format login attempt.

**Endpoint:** `PATCH /me/profile` (auth'd) `{ name?, phone?, state? }` ->
`IdentityUser`. Phone uniqueness is checked against the normalized form
before saving (409 on collision, same as signup).

**Web app:** Profile tab is now an edit form (name/phone/state inputs,
pre-filled from the current user, a Save button), not static read-only
rows.

**Mobile app** (added in a follow-up pass, same feature): `ProfileScreen`'s
Account card gained an "Edit name, phone, state" link that swaps the
read-only rows for the same inputs/chip state-picker as `SignInScreen`'s
signup tab, with Save/Cancel. Save calls `updateProfile` then
`AuthContext.refreshUser()` (a fresh `GET /me`) rather than trusting the
PATCH response directly into local state — same pattern the rest of the
app already uses after a mutation.

---

### Forgot password + password visibility toggle — IMPLEMENTED

Surfaced by the founder's own account getting locked out: every account
from the phone/email+OTP era has `passwordHash: null`, and `login()`
rejects those unconditionally (`if (!user || !user.passwordHash) throw
UnauthorizedException`) — there was no way back in once signed out, and
no "forgot password" existed anywhere (flagged as an explicit gap in the
"Password-based auth" section above). This closes it.

**Flow:** emailed 6-digit code, not a link — mobile has no deep-link
handling set up, and a typed code works identically on web and native
with no extra infra. `POST /auth/forgot-password { identifier }` always
returns the same generic message regardless of whether the identifier
matched an account (`GENERIC_RESET_MESSAGE` — same account-enumeration
defense `login`'s "Incorrect email/phone or password" already uses for
this exact reason). If it matched, any outstanding unconsumed codes for
that user are invalidated and a fresh code is emailed via the existing
Resend integration; failure to send is logged, never surfaced to the
caller, so the response stays identical to the no-such-account case.
`POST /auth/reset-password { identifier, code, newPassword }` verifies
the code (bcrypt-hashed at rest, 15-minute expiry, capped at 5 attempts
before the token is burned) and sets `passwordHash` — this is also how a
pre-password account gets its first password, not just how an existing
one gets reset.

**New table** `PasswordResetToken` (userId, codeHash, attempts,
consumedAt, expiresAt) — same discipline as the old `OtpRequest` table
(hash the code, cap attempts, time-box it) but scoped to a userId since a
reset always targets one already-existing account, unlike OTP sign-in
which had to key off a not-yet-verified phone/email.

**Web + mobile:** both the login modal/screen and the login tab of
`SignInScreen` gained a "Forgot password?" link -> enter identifier ->
enter code + new password -> back to login, pre-filled, with a success
message. Both also gained a Show/Hide toggle on every password field
(login, signup, reset) — asked for in the same round, unrelated bug but
same "can't see what you're typing into a money-adjacent form" complaint
class.

**Not done:** no rate limiting on `forgot-password` request volume
(same gap as login's "no login rate-limiting", noted above) — a bcrypt
cost of 12 on every hash operation and the 5-attempt cap on guessing a
6-digit code are the only frictions in place right now.

---

### Web funding flow — IMPLEMENTED

"My gigs" said "Fund this gig from the Sorted mobile app" for every
`escrow_pending` gig — a dead end for anyone posting from the web, same
shape of gap the whole app-shell slice existed to close. Ports
`FundEscrowScreen`'s manual-pilot flow to the web: an `escrow_pending`
card now renders its own "Get transfer details" button in place of the
static note. Clicking it calls `POST /gigs/:id/fund` (unchanged — same
endpoint mobile already used) and swaps in the bounty/fee breakdown plus
the transfer account, with the same manual-pilot disclosure copy
(`FundEscrowScreen`'s warning banner text, condensed to fit a card). It
then polls `GET /gigs/:id/escrow` every 4s until state leaves
`awaiting_funding`, at which point the whole "My gigs" list is
reloaded so the card picks up its new status pill.

**Not ported:** `POST /gigs/:id/confirm-funding` stays exactly as it
was — an admin-only action (`AdminGuard`/`ADMIN_API_KEY`) the founder
calls by hand after seeing the bank alert land, same as before this
change. There is no web UI for it and there shouldn't be one; putting
an admin-key field in the client-facing app would be a real credential-
exposure risk for a feature only one person ever calls.

**Poll cleanup:** each open funding card's `setInterval` handle is
tracked in `activeFundingPolls` and cleared on tab switch, sign-out, and
before every re-render of "My gigs" — otherwise navigating away mid-poll
would leak an interval per visit to an unfunded gig's card.

---

### Dark theme (mobile) — IMPLEMENTED

Requested from a set of "app flow" mockups showing a dark visual language
(near-black backgrounds, dark cards, mint-green accents). Two things from
those mockups were explicitly NOT carried over, confirmed with the
founder before building: the mockups show phone+OTP sign-in, but that
flow was already replaced with email/phone+password earlier this session
and stays that way — only the dark color language was pulled from those
screens, not the OTP fields/copy. Scope is mobile-only; the web app's
light theme is untouched.

**Architecture:** `theme/tokens.ts` now exports `lightColors` and
`darkColors` — same key set (`ThemeColors` interface), so nothing that
reads a color needs to know which palette is active. `theme/
ThemeContext.tsx` (new) is a `ThemeProvider`/`useTheme()` pair holding
`{ mode, colors, setMode, toggleMode }`, persisted via SecureStore (the
same module already used for the access token) so the choice survives an
app restart. Defaults to **dark** — the mockups that prompted this are
dark, and light was already the one proven live.

**Every screen and `components/ui.tsx` primitive now reads colors via
`useTheme()`, never a static import** — this was the actual work: RN's
`StyleSheet.create` is evaluated once at whatever scope it's called in,
so a color-dependent stylesheet can't be a module-level constant anymore.
Every file that used to do `import { colors } from '../theme/tokens'`
now calls `const { colors } = useTheme()` inside the component and builds
its styles via a `createStyles(colors)` factory wrapped in
`useMemo(() => createStyles(colors), [colors])` — recomputed only when
the palette actually changes, not every render. Small sub-components
that rendered off a parent's module-level `styles` object (e.g.
`PostGigScreen`'s `ChipRow`, `AccountTypeScreen`'s `CategoryGrid`,
`FundEscrowScreen`'s `Row`) needed the same treatment, since they can't
read a parent's local `useMemo`'d styles without either calling
`useTheme()` themselves or having it threaded down as a prop — did
whichever was less code per case.

**Toggle:** Profile screen, new "Appearance" card — a Light/Dark segmented
control that calls `toggleMode()` directly (mirrors the founder's own
answer: "toggle if possible... for now build dark" — dark is the
default, but the toggle exists now rather than as a follow-up, since the
Context made it nearly free once built).

**Not done:** the web app was explicitly scoped out (mobile only). The
dark palette's exact colors are a judgment call, not a pixel-match of the
mockups — Nigerian-market screenshots don't hand over exact hex values,
so the accent green was shifted brighter for dark-background contrast and
neutrals were picked to read as "the same brand, dark mode" rather than
attempting an exact replica.

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

## Slice 4 (partial) — Manual escrow pilot (funding) — IMPLEMENTED

**Goal:** let a gig actually get funded and move `escrow_pending -> open`,
without waiting on Monnify's business KYC. This is **not** slice 4 proper —
`holdStake`, `releaseToProfessional`, `refundClient`, `freezeForDispute`,
`resolveFrozen` all stay `NotImplementedException` stubs. Only the funding
half is real.

**Why manual, not "just send it to a personal Opay account" as originally
asked:** the request was to fund gigs by clients sending money straight to
the founder's personal Opay account and calling that "escrow." That is not
escrow — there's no hold-and-release enforcement, it directly contradicts
the "money never with us" pitch, and it carries real regulatory risk (a
personal account receiving pooled client funds looks like unlicensed money
transmission under Nigerian financial regulation, and can get frozen). The
founder chose, explicitly and with that risk explained, to run this as a
**disclosed** manual pilot rather than build it silently or hold off
entirely — and confirmed the account is genuinely personal, not a
registered business account. Every user-facing string this slice adds says
so plainly (see `manual-pilot.provider.ts`, `FundEscrowScreen.tsx`); none
of them claim automated or business-grade escrow.

**Module interfaces implemented:**
- `PaymentsProvider` (§3.4 SEAM, exactly as designed — "Monnify is an
  implementation, not the interface"): `ManualPilotProvider`, a second
  class behind the same interface. `createHoldingAccount` returns one
  fixed account (config, not a real per-gig virtual account — there's no
  rail to generate one); `confirmFunding`/`verifyWebhook` are unused by
  this flow (nothing to verify against, just a human reading their own
  bank app) and either return a placeholder or throw, kept only for
  interface completeness; `disburse`/`refund` log a "send this by hand"
  warning and return a no-op reference — no money moves in code anywhere
  in this slice.
- `PaymentsModule` now binds `PAYMENTS_PROVIDER` via a factory keyed on
  `PAYMENTS_PROVIDER_KEY` (default `manual_pilot`) — flipping to
  `monnify` once real credentials exist changes zero lines in
  `EscrowService` or anywhere above it. That's the whole point of the seam
  being there already.
- `EscrowPort` gained `confirmFunding(gigId, providerRef)` and
  `getEscrow(gigId)`. `confirmFunding` is written provider-agnostic (a
  webhook handler calls it in production; an admin action calls it during
  this pilot) — it does not know or care that there's no real rail behind
  it today.

**Money-integrity (§9), specifically:**
- `EscrowService.confirmFunding` does the `EscrowRecord` state change, the
  `Gig.status` transition, and the `LedgerEntry` write inside **one**
  `prisma.$transaction` — not three round-trips. This needed a new
  `PrismaTx` type (`common/prisma-tx.ts`) threaded as an optional last
  argument through `GigsPort.transitionStatus` and `LedgerPort.record`,
  because those services otherwise use their own injected `PrismaService`
  and would silently escape the caller's transaction. Ports stay the only
  way modules call each other — this doesn't reach into another module's
  Prisma tables, it lets a cross-module Port call participate in the
  caller's transaction.
- `LedgerEntry.eventId` for a funding confirmation is deterministic
  (`fund:${gigId}`) and `LedgerService.record` upserts on it — a duplicate
  `confirmFunding` call (admin double-click, or later a real webhook
  retry) is a no-op, never a double-credit.
- `EscrowService.confirmFunding` is idempotent past that too: if the
  record isn't `awaiting_funding` any more, it just returns current state
  instead of erroring.
- `EscrowService.fundGig` is idempotent per gig: re-requesting transfer
  instructions for a gig that already has an `EscrowRecord` returns the
  existing one rather than opening a second holding account.

**Endpoints (`EscrowController`, under `/gigs` — addressed by gig, same as
`GigsController`):**
```
POST /gigs/:id/fund              (auth'd, client, owner) -> EscrowRecordView + manual transfer instructions
POST /gigs/:id/confirm-funding   (admin: x-admin-key header) { providerRef } -> EscrowRecordView
GET  /gigs/:id/escrow            (auth'd)                 -> EscrowRecordView
```
`AdminGuard` (`common/auth/admin.guard.ts`) is a shared-secret check
against `ADMIN_API_KEY` — there's no admin-role system, this is a stopgap
sized for one operator during a pilot, documented as such in its own doc
comment.

**Env (`server/.env.example`):** `PAYMENTS_PROVIDER_KEY`,
`MANUAL_PILOT_ACCOUNT_NUMBER`/`_ACCOUNT_NAME`/`_BANK`, `ADMIN_API_KEY` —
real values live only in the gitignored `server/.env` (and must be set the
same way in NaijaBase's environment-variable settings for the deployed
server; they are not in this repo).

**Screens backed:** screen 06, Fund escrow. Requests transfer instructions
on demand (not funded automatically on gig publish), shows them, then
polls `GET /gigs/:id/escrow` every 4s until state leaves
`awaiting_funding`. Copy is explicit pilot-disclosure, not a fee-math
mockup — see the file's own doc comment for why that copy is load-bearing.

**Explicitly deferred — not this slice:**
- **Release/sign-off.** No symmetric admin action exists yet to pay a
  professional once a client signs off — `releaseToProfessional` is still
  a stub, and `ReviewSignOffScreen`'s "Approve & release payment" stays
  disabled until it's built. Funding money in without a way to pay it out
  is half a system; this is next.
- **Delivery/dispatch for physical gigs** (pickup/dropoff location,
  size-based cost, motorbike courier, return cost) — ties to `HANDOFF.md`
  §11's already-flagged "logistics scope for v1" open decision. Not
  started.
- **Price-setting/recommendation flow** (client sets a price vs. a
  recommended price vs. a professional proposes one) — ties to §11's
  shortlist-matching/staking-timing open decision. `MatchingStrategy` seam
  already exists (slice 3) for exactly this to plug into later; v1's
  `FixedPriceAcceptStrategy` is still a pass-through. Not started.
- **Physical vs. digital gig distinction** beyond the existing `Domain`
  taxonomy (`physical`/`digital` already seeded, slice 3) — no
  domain-specific behavior (e.g. requiring a delivery leg for physical
  gigs) is wired up yet.

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
