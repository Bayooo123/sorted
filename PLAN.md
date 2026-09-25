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

### Profile photo + KYC apply flow — IMPLEMENTED

Two asks bundled together: (1) any user can upload a profile photo, (2)
professionals can apply for verification, which is meant to boost their
odds of being picked for a gig. Two real infra decisions were confirmed
with the founder before building, since neither is a style call:
**storage** is base64-in-Postgres (no new vendor/cost — a deliberate
pilot-scale choice, not the long-term answer: this bloats rows and
response payloads, revisit with real object storage — S3/Vercel Blob —
once volume matters) and **verification** is a manual pilot, same
disclosed-human-review pattern as escrow funding: a professional applies
with a photo, the founder reviews it by hand, no real BVN/NIN check
happens yet (blocked on the same Monnify business KYC onboarding the
payments integration is waiting on).

**Naming note:** this is NOT `modules/verification/` (HANDOFF.md §3.6 —
that's about proving a gig *criterion* is met, i.e. sign-off). This is
KYC (`User.kycStatus`, Identity §3.1), so the new table is `KycRequest`,
kept entirely inside the Identity module, to avoid two unrelated things
both being called "verification" in the codebase.

**Schema:** `User.avatarBase64` (nullable, any role) plus a new
`KycRequest` table (userId, documentBase64, note, status pending/
approved/rejected, reviewNote, reviewedAt). Applying sets
`User.kycStatus = 'pending'`; admin review sets it to `verified` or
`rejected` in the same transaction as the request's own status update.

**Size cap:** `MAX_IMAGE_DATA_URI_LENGTH` (3.5MB) is enforced in
`IdentityService`, and both `main.ts` and `api/index.ts` raise Nest's
default 100kb JSON body limit to 4mb via `app.useBodyParser('json', ...)`
— sized to stay under Vercel's own ~4.5MB serverless request-body ceiling
(an app-level limit can't raise that platform one). Web and mobile both
downscale/recompress the image client-side before upload (canvas resize
on web, `ImagePicker`'s `quality` option on mobile) so a real photo
doesn't get anywhere near either ceiling.

**Endpoints** (`IdentityController`): `PATCH /me/avatar` (any role);
`POST /me/kyc/apply` (professional-only — 403s otherwise, enforced in
the service, not just hidden in the UI) and `GET /me/kyc` (my latest
request, or null) for applicants; `GET /admin/kyc/pending` and
`POST /admin/kyc/:id/review` (`AdminGuard`, same `x-admin-key` as
escrow's confirm-funding) for the founder.

**Web + mobile:** Profile screen gained a photo (any role) and, for
professionals, a "Verification" card showing verified / pending /
apply-with-a-photo-and-optional-note depending on current status —
same three-state logic on both platforms.

**`kyc-admin.html` (new, web root, NOT linked from the app's nav):** a
standalone review page — enter the admin key (never persisted, re-typed
each visit), see each pending application's photo/ID image plus
applicant contact info, Approve/Reject with an optional note. This is
the one admin surface in this feature that got a real page instead of a
curl command: unlike confirming a bank transfer, reviewing a KYC
document means actually *looking at an image*, which isn't practical
from a terminal. It's still not linked anywhere a regular user's
browsing would reach it, and still gated by the same shared secret as
every other manual-pilot admin action — the safety property is "not
discoverable and not persisted," not "not a page."

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

## Paystack integration (replaces Monnify as the real `PaymentsProvider`) — IMPLEMENTED

**Goal:** give `PAYMENTS_PROVIDER_KEY` a real, non-manual option — Paystack
calls a webhook when a client's payment lands, so `EscrowService.
confirmFunding` runs automatically instead of a founder confirming by hand
via `POST /gigs/:id/confirm-funding`. `manual_pilot` stays the default and
remains fully working; nothing about it changed except the interface it
implements got wider (see below). Monnify was never actually built (the
prior slice's "Monnify is an implementation, not the interface" language
described a plan, not code) — replaced outright rather than kept alongside,
per explicit instruction.

**Why Transaction Initialize, not a Dedicated Virtual Account:** a DVA is
issued per *customer* and is persistent — it can't tell which of a client's
several gigs-awaiting-funding a given bank transfer was meant to pay for.
A one-time Transaction Initialize checkout session, keyed to the gig's own
id as Paystack's `reference`, sidesteps that entirely — `EscrowService.
fundGig` already guarantees at most one `EscrowRecord` per gig, so `gigId`
is already a safe idempotency/lookup key on Paystack's side too.

**Interface widened, not just a new class behind the old one** (unlike the
Monnify plan, which assumed Monnify's Reserved Account shape would fit any
provider): `PaymentsProvider.createHoldingAccount` gained `amountKobo` and
`payerEmail` params — Paystack's Transaction Initialize needs both upfront,
where the manual-pilot's static account didn't need either. `HoldingAccount`
gained an optional `checkoutUrl`, and its `accountNumber`/`bankName` became
optional — account-number-based providers (manual pilot) populate one pair,
checkout-link-based providers (Paystack) populate the other.

**A duplicate-call bug caught while designing this, not yet triggered in
production:** `EscrowController.fund()` was calling `createHoldingAccount`
twice — once inside `EscrowService.fundGig()` (the record-creating call)
and again directly in the controller, just to get account details for the
HTTP response. Harmless against the manual-pilot's static, idempotent
account; against Paystack it would have opened two separate checkout
sessions (two different payment links) for one funding request. Fixed by
having `fundGig` persist what the provider returned — `EscrowRecord.
holdingAccountDetails Json?` — and having `EscrowRecordView.holdingAccount`
read it back, so the controller never calls the provider a second time and
a re-fetch of an already-funded gig doesn't call it again either.

**Webhook-based auto-confirmation (`PaystackWebhookController`, `POST
/webhooks/paystack`):**
- **Signature verification is the real guarantee**: HMAC-SHA512 over the
  *raw* request bytes (not the parsed/re-serialized JSON — re-serializing
  can reorder or reformat and silently break the signature), compared to
  the `x-paystack-signature` header. Raw bytes are captured via a `verify`
  callback on the JSON body parser in both `main.ts` and `api/index.ts`
  (`req.rawBody = buf`), since by the time Nest hands the controller a
  parsed body the exact original bytes are gone.
- **IP-allowlist is soft/logged-only, not a hard gate**: `PAYSTACK_
  WEBHOOK_IP_ALLOWLIST` (optional). Paystack's published source IPs can
  change and can't be verified from this environment, so a mismatch is
  logged, never blocked — consistent with this codebase's existing
  honesty-first documentation elsewhere about what can and can't be
  verified from this sandbox.
- **Idempotency was already there.** `EscrowService.confirmFunding`'s
  state-guard (no-op once the record has left `awaiting_funding`) plus
  `LedgerService.record`'s upsert on the deterministic `fund:${gigId}`
  event id — both written in the manual-pilot slice specifically because
  its own doc comment already anticipated "a webhook handler calls it in
  production." A replayed webhook (Paystack retries on anything but 2xx)
  is already a safe no-op with zero new code in this controller.
- Always responds `200` once the signature check has run — including for
  an invalid signature or an event kind not acted on (`transfer.success`,
  `refund.processed`, ...) — because Paystack retries non-2xx responses,
  and retrying an event deliberately ignored is noise, not a fix.

**Schema:** `EscrowRecord.holdingAccountDetails Json?` (provider-shaped —
account-number-based and checkout-link-based providers genuinely return
different things, so `Json` rather than fixed columns); `EscrowRecord.
provider`'s default changed from `"monnify"` to `"manual_pilot"` to match
what was actually ever running. Migration:
`20260901160000_escrow_holding_account_details`.

**Env (`server/.env.example`):** `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`,
`PAYSTACK_WEBHOOK_IP_ALLOWLIST` (optional) — real values live only in the
gitignored `server/.env` locally / Vercel's `sorted-api` project env vars in
production, never in this repo or in chat. `PAYMENTS_PROVIDER_KEY` stays
`manual_pilot` until those are set and switched to `paystack`. The webhook
URL to register in the Paystack dashboard is
`https://sorted-api.vercel.app/webhooks/paystack`.

**Screens updated:** screen 06 (`FundEscrowScreen.tsx`) and the web funding
card (`index.html`'s `fundingCard`) both now branch on `holdingAccount.
checkoutUrl` — a "Pay now" action opening Paystack's hosted checkout when
present, falling back to the existing account-number/bank-name display (and
its pilot-disclosure copy, which only applies to that path) when it isn't.
Both still poll for the escrow state to leave `awaiting_funding`, unchanged.

**Explicitly deferred — not this change:**
- `disburse`/`refund` (`PaystackProvider`) have no real callers yet —
  `releaseToProfessional`/`refundClient` are still stubs (slices 7/8);
  implemented ahead of need so the interface is exercised end-to-end for
  the one method that does have a caller (`createHoldingAccount`).
- Whether Paystack's refund API supports refunding a bank-transfer-funded
  transaction (as opposed to a card payment) is unconfirmed — flagged in
  `PaystackProvider.refund`'s own doc comment rather than assumed.
- End-to-end verification of the live checkout → webhook → `confirmFunding`
  path needs real `PAYSTACK_SECRET_KEY` test-mode credentials in the
  deployed environment; not runnable from this sandbox.

---

## Release + sign-off flow (slices 6/7, plus a minimal slice-8 safety net) — IMPLEMENTED

**Goal:** close the loop the Paystack integration opened — money could go
*in* (fund a gig) but nowhere had ever built a way to pay it back *out*.
`holdStake`, `releaseToProfessional`, `refundClient`, `freezeForDispute`,
`resolveFrozen` were all still `NotImplementedException` stubs; a gig could
reach `open` and then go nowhere. This closes the whole remaining
lifecycle: claim → stake → submit → sign-off/release, plus a minimal
admin-mediated dispute freeze/resolve, so a first real pilot gig can
actually complete end to end.

**Two scope decisions made explicitly before writing any of this (not
assumed):**
- **No real stake money in this pilot.** `EscrowRecord.stakeKobo` is
  computed (`DEFAULT_STAKE_BPS` × bounty) and displayed, but never
  collected — claiming a gig doesn't trigger a second funding flow for the
  professional. Building a real stake-collection rail (its own checkout/
  transfer flow, mirroring `fundGig`) was explicitly deferred as its own
  future slice once there's real volume to justify it. `Claim.staked` is
  set `false` accordingly — an honest field, not a placeholder.
- **Whole-gig sign-off, not per-criterion.** One proof photo + note for
  the entire gig (`Gig.submissionProofBase64`/`submissionNote`, same
  base64-in-Postgres pattern as `avatarBase64`/`KycRequest.documentBase64`
  — validation pulled out to `common/image-data-uri.ts` so Identity and
  Gigs share it instead of duplicating the regex/size-cap). Matches what
  `ClaimWorkScreen`/`ReviewSignOffScreen` already showed (one upload zone,
  one approve button) — no UI redesign needed. Per-criterion proof/met
  toggles (`Criterion.proofUrl`/`met`, the real `VerificationStrategy`
  seam) stay unbuilt; `ClientSignoffStrategy` is still a stub.

**Claim + stake (`EscrowService.holdStake`, `POST /gigs/:id/claim`):**
one call does what the state machine models as two hops (`open` →
`claimed` → `in_progress`) — there's no real stake-payment step to wait on
between them, so splitting this into two professional-facing actions would
just be extra taps for no reason. Calls `MatchingStrategy.assignProfessional`
(now implemented — v1: trivial accept, first claim wins) before writing
anything, so a future shortlist/bidding strategy can reject a claim before
any state changes. `GigsService.transitionStatus` was hardened alongside
this: the update is now a compare-and-swap on the FROM status
(`updateMany` + count check, not a blind `update`) — closes a real race
where two professionals claiming the same `open` gig could otherwise both
pass the transition-allowed check before either write commits.

**Submit for review (`GigsService.submitForReview`, `POST /gigs/:id/submit`):**
professional-only, enforced by checking for an active `Claim` row — proof +
note land in the same transaction as the `in_progress` → `submitted` flip,
so a gig is never visibly "submitted" with no proof attached.

**Release (`EscrowService.releaseToProfessional`, `POST /gigs/:id/release`
— "Approve & release payment"):** the money-safety-sensitive part.
`PaymentsProvider.disburse()` is an external call a DB transaction can't
roll back, so the sequencing is deliberate: (1) idempotency check
(`disbursementRef` already set, or `state === 'released'` → safe no-op
return); (2) compare-and-swap into `state: 'releasing'` — this is what
actually prevents two concurrent "Approve" taps from both calling
`disburse()`, since only one `updateMany` wins; (3) call `disburse()`
against the professional's `payoutBankCode`/`payoutAccountNumber`/
`payoutAccountName` (`IdentityService.getPayoutDestination`, already
existed — never built until now); (4) only once that succeeds, persist
`state: 'released'`, `feeKobo`, `professionalPayoutKobo`, `disbursementRef`,
the `signed_off`→`released` transitions, and two `LedgerEntry` rows
(`release` + `fee`) all in one transaction. A `disburse()` failure leaves
the record in `releasing` with no `disbursementRef` **on purpose** — a
retried "Approve" tap can pick the CAS back up and try again, rather than
being permanently stuck.

**Minimal dispute safety net (`DisputesService`, admin-mediated, no
neutral panel):** `POST /gigs/:id/dispute` — either the client or the
assigned professional — creates the `Dispute` row, calls
`EscrowService.freezeForDispute`, and transitions the gig to `disputed`,
all in **one transaction** (HANDOFF.md §7's "thin is OK; freeze is not
optional" upheld literally: never a freeze with no `Dispute` row, or vice
versa). `POST /disputes/:id/resolve` (`AdminGuard`, same disclosed-manual
pattern as escrow's confirm-funding) applies the founder's ruling:
`for_professional` reuses the same disbursement CAS/idempotency mechanics
as `releaseToProfessional` (entered from `dispute_hold` instead of
`submitted` — `disputed` → `released` is a direct hop, no `signed_off`
step); `for_client` calls the newly-implemented `refundClient`, which
reuses `disbursementRef` as its CAS lock too (a gig only ever settles once,
in one direction, so "already has a ref" is a valid "don't do this again"
regardless of which direction it was). `assignNeutral` and `ruling: 'split'`
are explicit `NotImplementedException`s, not guesses — a real neutral panel
and how platform fee applies to a partial payout/refund are both genuinely
undesigned, not oversights.

**Schema:** `Gig.submissionProofBase64`/`submissionNote` (both nullable).
Migration: `20260908120000_gig_submission_proof`. Nothing else needed new
columns — `Claim`, `EscrowRecord` (`stakeKobo`, `feeKobo`,
`professionalPayoutKobo`, `disbursementRef`), and `Dispute` already had
every field this needed, unused until now.

**Screens wired (mobile only — sign-off/claim still isn't on web, same as
before):** `ClaimWorkScreen` (open gig → "Claim this gig" → proof capture →
"Submit for review") and `ReviewSignOffScreen` (proof review → "Approve &
release payment" or "Raise a dispute" with a reason).

**Explicitly deferred — not this change:**
- Real stake collection, per-criterion verification, GPS check-in, in-app
  chat evidence (HANDOFF.md §3.6) — all still open, see above.
- Neutral-panel dispute assignment and `split` rulings.
- Materials-advance escrow state, stake-sizing policy beyond a flat
  `DEFAULT_STAKE_BPS` — both still flagged open decisions in HANDOFF.md §11.
- Web app parity for claim/submit/sign-off/dispute — mobile-only for now.

---

## WhatsApp integration, Phase 1 (product decision, not in HANDOFF.md) — IMPLEMENTED

**Goal:** a third front-end to Sorted, WhatsApp-native — "hi" starts
registration, and the same thread eventually becomes a full USSD-style
ordering flow (post a job, get matched, pay, release). Phase 1 is
deliberately small: the webhook, the greeting, and the post-signup message
— everything else (conversation state, gig posting via chat, matching,
payment confirmation over WhatsApp) is unscoped follow-on work.

**A real circular-dependency trap shaped this more than anything else.**
`IdentityModule` already imports `ReputationNotificationsModule` (for
`notify()`). Adding WhatsApp naively — one module, sending capability +
inbound webhook + a lookup into Identity to check "is this phone
registered" — creates Identity → Notifications → Whatsapp → Identity, a
cycle. Fixed by splitting into two modules:
- **`WhatsappModule`** (lean): `sendMessage`/`recordInboundMessage` only,
  zero Identity dependency, safe for `ReputationNotificationsModule` to
  import. Owns the new `WhatsAppSession` table itself (just `phone` +
  `lastInboundAt` — no FK to `User`, so no Identity dependency is needed
  even for that).
- **`WhatsappWebhookModule`**: imports both `IdentityModule` (to look up
  registered users by phone) and `WhatsappModule` (to reply). Imported
  only by `AppModule` — nothing else may import it, since that's exactly
  what would reintroduce the cycle. Verified by actually booting the app
  (`ts-node src/main.ts`) and confirming every module — including both new
  ones — initializes and every route maps before any DB call happens;
  Nest throws immediately on a real circular dependency, so a clean boot
  through `RouterExplorer` is a real test, not just `tsc` passing.

**The 24h session window is enforced inside `WhatsappService.sendMessage`,
not by callers.** Meta only allows free-form text to a phone that messaged
us within the last 24 hours; outside that, a message needs a pre-approved
template (multi-day external review in Meta's dashboard — not built yet).
`sendMessage` checks `WhatsAppSession.lastInboundAt` itself and silently
no-ops (logged, not thrown) if the window's closed, so a caller (like
`NotificationsService`) never has to know or care — same "best-effort,
never fail the real action" pattern as the existing welcome email.

**Wired into the existing `NotificationsPort` seam, not a parallel path:**
`NotifyTarget.phone` already existed on the interface but `IdentityService.
signup()` never populated it — now it does, and `NotificationsService`'s
`user_signed_up` case sends both the existing welcome email AND (best-
effort) a WhatsApp message asking "what would you like to get done today?"
This only actually sends when the signup happened within 24h of that
phone's last inbound message to the bot — true for the intended flow
(text the bot first → get the signup link → sign up), silently skipped
(falls back to email-only, already working) for anyone who found the site
directly without ever messaging first.

**Inbound handling (`WhatsappWebhookController`), lessons carried over
from a prior WhatsApp integration (Reforma, a different product on the
same Meta Business Manager — deliberately a SEPARATE phone number, not a
shared one, since mixing two unrelated products' messages on one number
is confusing for both audiences and was never seriously considered):**
- GET verification handshake (echo `hub.challenge` raw, via `@Res()` —
  NestJS's default JSON-wrapping would break Meta's exact-string check).
- POST always returns 200 immediately; real processing happens after, via
  `waitUntil` (`@vercel/functions` — the actual primitive Next.js's
  `after()` sits on top of, confirmed by reading `wait-until.js` directly:
  it's a no-op outside a Vercel Function context, so local dev via
  `main.ts` is unaffected either way).
  Reforma's build used Next.js's `after()`, not portable here since
  `sorted-api` is NestJS.
- Exhaustive message-type switch — every Meta message type (`image`,
  `document`, `interactive`, `button`, `reaction`, etc.) gets an explicit
  "I can only read text right now" reply. No silent-drop default case —
  that looks identical to the bot being broken.
- HMAC-SHA256 signature verification (`WHATSAPP_APP_SECRET`,
  `x-hub-signature-256`) reusing the raw-body capture already wired up
  globally for Paystack's webhook (`main.ts`/`api/index.ts`'s bodyParser
  `verify` callback) — soft-allow when unset, same pattern as Paystack's
  IP-allowlist, since it can't be required until initial Meta setup is done.
- Phone matching turned out to be nearly free: Meta sends the sender as
  `234803...` (no `+`), and `User.phone` is already strict E.164
  (`normalizeNigerianPhone`, enforced at signup/profile-update) — so
  matching is just prepending `+`, not the dual-candidate-plus-last-10-
  digit fallback a system with inconsistently-entered phone data would
  need. New `IdentityPort.findUserByPhone` exposes this lookup.

**Schema:** `WhatsAppSession { phone (unique), lastInboundAt }`. Migration:
`20260910130000_whatsapp_session`.

**Env (`server/.env.example`):** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` — real values live only in
the gitignored `server/.env` locally / Vercel's `sorted-api` env vars in
production. Webhook URL to register in Meta's dashboard:
`https://sorted-api.vercel.app/webhooks/whatsapp`.

**Explicitly deferred — not this change:**
- Outbound-initiated template messages (for notifying someone who hasn't
  messaged in >24h — "a professional accepted your job" being the clearest
  future case) — needs Meta template approval, an external multi-day
  process not started as part of this change.
- "Request a professional you already use" (direct-invite to one named
  professional, vs. today's open-to-all-matching-professionals claim) —
  new capability, not built.

---

## WhatsApp integration, Phase 2 — client gig posting — IMPLEMENTED

**Goal:** close the loop Phase 1 opened — a registered client can post a
real, fundable gig by texting, no app needed, matching the original brief
("it will work like USSD"). Deliberately a guided, numbered-menu sequence,
not free-text NLP extraction — the decision flagged as open in Phase 1
("LLM-agent-driven vs. menu/state-machine-driven") is resolved here for
this slice: taxonomy/location/price are hard requirements of
`GigsService.createGig`, and a wrong NLP guess on a money field is a worse
failure mode than one extra question. The broader LLM-vs-deterministic
question stays open for whatever comes after posting (matching,
negotiation) — not resolved wholesale by this choice.

**Flow:** any free text from a registered client with no draft in progress
is treated as a job description → numbered list of submarkets (taxonomy,
same list `/taxonomy/submarkets` already serves) → location text → price →
a recap ("Here's the job: ... Reply YES to post it, or CANCEL to start
over.") → on YES, creates + publishes the gig and calls `EscrowService.
fundGig` immediately, then messages back either the Paystack checkout link
or the manual-pilot bank details — same two paths `FundEscrowScreen`
already handles in the app. "cancel"/"stop"/"start over" resets to idle
from any state.

**State lives on `WhatsAppSession`** (the same one-row-per-phone table
Phase 1 already added for the 24h window), not a new table — a
`conversationState` string column (`idle` | `awaiting_category` |
`awaiting_location` | `awaiting_price` | `awaiting_confirmation`) plus four
nullable draft fields, cleared back to null on post or cancel. One
gig-posting conversation per phone at a time, same as one messaging
session per phone.

**Client-role prerequisite handled transparently, not surfaced as a
separate step.** `GigsService.createGig` requires `roleFlags` to include
`'client'`, which bare signup doesn't set (`POST /me/role-profile` does,
normally a separate app screen). Since the submarket picked for the gig
IS the category `completeRoleProfile` needs (`seekingCategorySubmarketIds`),
the WhatsApp flow calls `completeRoleProfile` itself right before
`createGig` when the user doesn't already have the `'client'` role —
preserving any existing `'professional'` role/service-offerings untouched
(`completeRoleProfile` replaces role data wholesale, so those are read
from `IdentityUser` and passed straight through, not dropped).

**Fixed defaults, not additional questions:** `clientType: 'individual'`
(the WhatsApp-first audience), `materialsMode: 'bounty_covers'`, and a
single `criteria` entry equal to the free-text description. All narrower
than what the web/app form collects — acceptable for this channel's
audience; revisit if WhatsApp-posted gigs turn out to need per-criterion
sign-off in practice.

**New module wiring:** `WhatsappGigConversationService` lives in
`WhatsappWebhookModule` (needs `GigsService` + `EscrowService`, both of
which only this module — not `WhatsappModule` — may depend on, keeping
Phase 1's circular-dependency fix intact). `WhatsappWebhookModule` now
imports `GigsModule` and `EscrowModule` in addition to `IdentityModule`/
`WhatsappModule`; neither import chains back to `WhatsappWebhookModule`,
so no new cycle. Verified the same way as Phase 1: a real `ts-node
src/main.ts` boot, confirming every module (including the two new imports)
initializes and every route maps before the expected DB-connectivity
crash.

**Explicitly deferred — not this change:**
- The professional side: nothing here broadcasts a newly-posted gig to
  professionals over WhatsApp, or lets a professional claim one by texting
  back. Professionals still find/claim gigs through the existing app/web
  flow; a WhatsApp-posted gig is visible there like any other.
- A "your job just went live" follow-up once escrow funding actually
  clears — `NotificationsService` has no `gig_funded`/`escrow_released`
  event implemented yet (still `NotImplementedException`, per its own doc
  comment) and building that pipeline is its own slice, not folded in
  here. The one message sent is the payment link/details, immediately
  after posting.
- Editing an in-progress draft (e.g. going back to fix the location) —
  today only `cancel` (start over) exists, no "back" step.
- Multi-turn free text for the description itself (e.g. someone splitting
  their job description across two messages) — the first message after
  `idle` is taken as the whole description.

**Schema:** four nullable draft fields + `conversationState` (default
`'idle'`) added to `WhatsAppSession`. Migration:
`20260910140000_whatsapp_gig_conversation`.

---

## WhatsApp integration, Phase 3 — invite a known professional — IMPLEMENTED

**Goal:** the other half of the original brief — *"select someone you
already know, tell him the exact work you need done"* — as an alternative
to Phase 2's open-search posting. Phase 2's price step now asks one more
question: invite someone specific, or open it to any matching
professional. Choosing "invite" asks for that person's WhatsApp number,
looks them up (`IdentityPort.findUserByPhone`, reused from Phase 1),
confirms they're a registered professional, then folds their id into the
same create-gig-and-fund flow Phase 2 already has.

**A real gap in the matching layer, not a WhatsApp-only feature.**
Nothing in Gigs/Matching/Escrow had any concept of "this gig is for one
named professional" — `holdStake` was genuinely first-come-first-served,
no restriction hook anywhere. Added `Gig.restrictedToProfessionalId`
(nullable FK to `User`, null preserves the existing open-claim path
exactly) and one real check in `FixedPriceAcceptStrategy.
assignProfessional` — the seam that already existed specifically so a
strategy could reject a claim (its own doc comment: "kept as a real call
... so a reverse-auction/shortlist strategy can replace just this class
later"). `GigForPricing` carries the restriction through; `EscrowService.
holdStake` was the one caller to update.

**Why the invite isn't sent until funding is confirmed, not at post
time.** A gig only becomes claimable once its `EscrowRecord` reaches
`funded` (`EscrowService.confirmFunding` — the ONE method both the
Paystack webhook and the manual-pilot admin `confirm-funding` route funnel
through, so hooking it there covers both funding paths for free). Messaging
the invited professional any earlier would let them reply YES to a job
that `holdStake` would then reject (`gig.status !== 'open'`) — a worse
experience than a short wait. `confirmFunding` now tracks whether its own
state-guard actually fired (not an idempotent re-call) and, only then,
best-effort-notifies the invited professional — same "never fail the real
action over a notification" pattern as the welcome WhatsApp message.

**New module edge, no new cycle:** `EscrowModule` now imports
`WhatsappModule` (lean — zero imports of its own, so `Escrow -> Whatsapp`
is a dead end, same reasoning already used for `Notifications -> Whatsapp`
and `WhatsappWebhookModule -> Escrow`). Verified the same way as Phases 1
and 2: a real `ts-node src/main.ts` boot.

**The professional's accept/decline lives in a new, separate
`WhatsappInviteService`, not folded into the client's gig-posting
conversation** — different person, different conversation. Tracked via
`WhatsAppSession.pendingInviteGigId` (plain string, no Prisma relation to
`Gig` — same "stay a leaf table" reasoning this model already uses for
having no FK to `User`). `WhatsappWebhookController.handleText` checks
this before routing into `WhatsappGigConversationService`, so a pending
invite reply always takes priority over that phone's own in-progress gig
draft, rather than the two interleaving.

- **Accept** (`YES`) calls `EscrowService.holdStake` directly (the exact
  same claim path the app's claim button uses) — a real claim, not a
  WhatsApp-only shortcut. On success, tells the professional and
  best-effort-notifies the client. On failure (job already taken,
  cancelled, etc.) tells the professional plainly rather than retrying
  silently.
- **Decline** (`NO`) clears the pending invite and best-effort-notifies
  the client that this professional couldn't take it — and stops there.
  It does NOT offer to reopen the gig to search or re-invite someone else
  over WhatsApp; `restrictedToProfessionalId` has no "clear/reassign" path
  anywhere yet (not in this change, not in the app), so the reply
  deliberately doesn't promise a next step that doesn't exist. See
  "Explicitly deferred" below.

**Explicitly deferred — not this change:**
~~Reassigning or reopening a declined/expired direct-invite gig~~ and
~~the 24h WhatsApp session-window limitation~~ — both addressed in Phase
3.1, immediately below.

**Explicitly still deferred — not this change:**
- Any UI (app/web) for `restrictedToProfessionalId` — it's entirely a
  WhatsApp-only capability today; a gig created this way looks the same
  as any other in the app aside from being unclaimable by anyone else.

**Schema:** `Gig.restrictedToProfessionalId` (nullable FK to `User`) +
three fields on `WhatsAppSession` (`draftInviteeProfessionalId`,
`draftInviteeName`, `pendingInviteGigId`). Migration:
`20260910150000_gig_direct_invite`.

---

## WhatsApp integration, Phase 3.1 — reassignment + template fallback — IMPLEMENTED

**Goal:** close the two real gaps Phase 3 shipped honestly-documented but
unsolved — a declined or unreachable direct invite was a dead end, and the
24h session-window limitation meant an invite could just silently vanish.

**Reassignment.** Both failure modes (professional says NO, or can't be
reached at all — see below) now land the CLIENT in the same follow-up:
`WhatsAppPort.offerReassignment(clientPhone, gigId, reasonText)` puts their
`WhatsAppSession` into a new `awaiting_reassignment` state (`reassignGigId`
set) and offers "reply with a new number, or OPEN." New `GigsService.
setRestrictedProfessional(gigId, professionalId | null)` — not a status
transition (the gig stays `open`), just who's allowed to claim it — backs
both branches: `null` opens it to any matching professional (via
`FixedPriceAcceptStrategy`'s existing check, which already treats
`null`/unset as "anyone"); a new professional id re-triggers
`EscrowService.sendInvite` (extracted from Phase 3's private method,
now public and reused here) to message them.

**Where this logic lives, and why.** `offerReassignment` had to be
callable from `EscrowService` (an unreachable-professional failure is
discovered there) as well as from `WhatsappInviteService` (a decline).
`EscrowService` cannot depend on `WhatsappGigConversationService` or
`WhatsappInviteService` without recreating the exact cycle Phase 1 split
modules to avoid (`WhatsappWebhookModule` already imports `EscrowModule`,
so the reverse would be circular). So `offerReassignment` — the one piece
of conversation-state logic the lean `WhatsappModule` owns — lives on
`WhatsAppPort` itself, implemented in `WhatsappService` using only
`prisma` + its own `sendMessage`, both of which it already has. The
CLIENT's actual reply (`awaiting_reassignment` case) is still handled in
`WhatsappGigConversationService`, same as every other conversation state
— `offerReassignment` only sets up the state and sends the prompt.

**A real found bug, fixed while here:** `GigsService.listGigs`'s public
browse (`GET /gigs`, unauthenticated — no caller identity to check
"is this you") was including gigs restricted to one professional. Anyone
browsing would see a job nobody but the invited professional could
actually claim — `holdStake` would reject them with `ForbiddenException`.
Now excluded from that branch explicitly (`clientId`-scoped "my gigs"
still shows them, correctly, to their owner). WhatsApp-posted gigs
otherwise need nothing special to show up in the app/mobile browse
screens (`BrowseMarketScreen` already calls the same `GET /gigs?
status=open`) — same `Gig` rows, same `GigsService.createGig`, no
separate code path by posting channel.

**24h-window fallback: a Meta-approved template message, the only real
fix for "reach someone who hasn't messaged recently."** `WhatsAppPort`
gained `isSessionOpen` (the same check `sendMessage` already did
internally, now exposed so a caller can choose the right path BEFORE
attempting either) and `sendTemplate` (Graph API `type: "template"` call).
`EscrowService.sendInvite` now: free-form text if the window's open (as
before) → else a template if `WHATSAPP_INVITE_TEMPLATE_NAME` is
configured → else honestly tells the client via `offerReassignment`
rather than the invite just disappearing.

**This cannot be fully "fixed" by code — approval is external, manual,
and not guaranteed.** A WhatsApp message template must be created and
submitted in Meta's WhatsApp Manager (category **UTILITY** — this
notifies about an existing job, not marketing) and can take anywhere from
hours to several days for Meta to review, sometimes rejected outright
requiring a resubmission. Exact body to submit (`server/.env.example` has
the same copy — kept deliberately generic so ONE template covers both
this and Phase 4's broadcast, rather than needing Meta to approve two):
*"New job on Sorted: {{1}}. Location: {{2}}. Pay: {{3}}. Reply YES to
respond."* — 3 variables, in that order. Once approved, set
`WHATSAPP_INVITE_TEMPLATE_NAME` (the name given at submission) and
`WHATSAPP_INVITE_TEMPLATE_LANG` (must match the submitted language
exactly, e.g. `en_US` not `en`) and redeploy. Until then, the system
behaves exactly as Phase 3 did — honestly degraded, not broken.

**Explicitly still deferred — not this change:**
- The reassignment offer to the CLIENT is itself sent via `sendMessage`
  (free-form only) — if the CLIENT'S OWN 24h window happens to be closed
  when a decline/failure fires, that message can silently fail too, same
  limitation one level up. A second template for this direction would
  close it; not built (diminishing returns without real usage data on how
  often this actually happens).
- Retrying an unreachable invite automatically once the professional
  eventually messages the bot — today the client has to notice and text
  the number again themselves; no scheduled/triggered retry exists.

**Schema:** `WhatsAppSession.reassignGigId` (nullable). Migration:
`20260910160000_whatsapp_reassignment`.

---

## WhatsApp integration, Phase 4 — broadcast open gigs to matching professionals — IMPLEMENTED

**Goal:** the other half of "open it up" that Phase 2 always claimed but
never actually did. An unrestricted gig going `open` had NO notification
mechanism at all — professionals could only ever discover it by opening
the app and browsing. This is the real product-critical gap: without it,
a WhatsApp-posted "search for someone" job has no path to getting seen by
anyone, defeating the whole point of that path existing.

**Trigger and audience.** Same hook as the direct invite (`EscrowService.
confirmFunding`, once — not per retry, guarded by the existing
`alreadyFunded` idempotency check), now branching on whether the gig is
restricted: `sendInvite` for one named professional (Phase 3), or the new
`broadcastOpenGig` for everyone else. Audience is every `User` with a
`ProfessionalServiceOffering` row matching the gig's submarket — the same
taxonomy pick made at role-profile completion, no separate "job alert
preferences" concept invented for this. No cap or shortlist: v1's
`FixedPriceAcceptStrategy` is already "first credible claim wins" with no
arbitration beyond the restriction check (Phase 3), so notifying everyone
who matches and letting the DB-level compare-and-swap in `GigsService.
transitionStatus` settle the race is consistent with that, not a new
policy.

**The race is resolved by real DB logic already in place, not new
locking.** Many professionals can get `pendingBroadcastGigId` set to the
same gig. Whoever's `YES` reply reaches `EscrowService.holdStake` first
wins for real (`Gig.status`'s compare-and-swap already throws
`ConflictException` on a second concurrent claim — see `transitionStatus`'s
own doc comment). `WhatsappBroadcastService` (new, parallel to
`WhatsappInviteService` but genuinely different shape: one gig, many
candidates, not one) just needs to: try the claim, and on success fan out
"someone else got it" to everyone else who had that `pendingBroadcastGigId`
set, clearing their pending state so a late `YES` doesn't attempt (and
fail) a claim for nothing.

**Reuses Phase 3.1's free-text/template fallback wholesale.** Extracted
the shared bit (`EscrowService.sendInvite`'s isSessionOpen → sendMessage →
sendTemplate branching) into a private `sendJobMessage` helper, called
from both `sendInvite` and `broadcastOpenGig` — one template
(`WHATSAPP_INVITE_TEMPLATE_NAME`) covers both, worded generically enough
("New job... reply YES to respond") to read naturally either way, rather
than asking the founder to get a second template approved.

**No client-facing failure handling for broadcast, unlike direct-invite
— deliberately.** `sendInvite` tells the client via `offerReassignment`
when its one target is unreachable, because that's a single point of
failure worth surfacing. A broadcast has no single point of failure to
report: some professionals reached, some not, and the gig is still fully
visible in the app's normal browse list regardless (`GigsService.
listGigs` — unaffected by this change for an unrestricted gig). Silently
skipping an unreachable candidate and moving on to the next is the right
behavior here, not a shortcut.

**Explicitly deferred — not this change:**
- Any shortlist/radius/rating-based targeting — every matching
  professional gets notified regardless of proximity, track record, or
  how many jobs they already have in progress. Fine at pilot scale;
  revisit once professional volume in one category is large enough that
  "notify everyone" becomes noisy rather than useful.
- A cap on how many professionals get messaged per broadcast, or any
  batching/rate-limiting of the sends — `Promise.all` over however many
  match. Not a concern yet at Yaba-pilot scale.
- Telling a losing professional WHY they lost (how fast the winner
  replied, etc.) — just "claimed by someone else."

**Schema:** `WhatsAppSession.pendingBroadcastGigId` (nullable). Migration:
`20260910170000_whatsapp_broadcast`.

---

## Simple professional ratings — IMPLEMENTED

**Goal:** the trust gap Phase 4's broadcast opened — a job can now go to
a professional the client has never dealt with before, with zero signal
beyond "they're on the platform." Deliberately the SIMPLE version this
was scoped as: a 1-5 star rating from the client, prompted right after
`EscrowService.releaseToProfessional`, no richer trust score.

**One-directional and gig-scoped, not a general review system.** New
`Rating` model: one row per gig (`gigId` unique — enforces "this is about
a real completed transaction," not a free-standing review), `raterId`
always the client, `rateeId` always the professional who held the active
`Claim`. Client rates professional only, matching the recommendation on
record from earlier in this build (professional reputation feeds
matching decisions; customer-side rating was flagged as lower priority
and stays unbuilt). Upsert, not insert-only — a client correcting a
fat-fingered rating doesn't need a support path.

**New `RatingsModule`**, same shape as every other domain module here
(`ratings.interface.ts`'s `RatingsPort`, service, controller, own
migration) — `POST /gigs/:id/rate` (JWT, caller must be the gig's own
client, gig must be `released`) and `GET /professionals/:id/rating`
(public, `{average, count}`) for whatever screen eventually shows it.

**Prompted over WhatsApp, same architecture as the last three phases.**
`EscrowService.releaseToProfessional` — right after the payout actually
lands, guarded by its own existing idempotency CAS so this only fires
once per real release — best-effort calls the new `WhatsAppPort.
promptForRating(clientPhone, gigId, professionalName)`. Same reasoning as
`offerReassignment`: this piece of conversation-state logic lives in the
lean `WhatsappService`, not a higher-level conversation service, because
`EscrowService` can't depend on `WhatsappGigConversationService` without
recreating the cycle Phase 1 split modules to avoid. The reply (a bare
1-5) is handled in `WhatsappGigConversationService`'s existing state
machine (`awaiting_rating`), which now also injects `RatingsService` —
requiring `WhatsappWebhookModule` to import the new `RatingsModule` (safe:
neither it nor `GigsModule`/`AuthModule` chains back to
`WhatsappWebhookModule`).

**Explicitly deferred — not this change:**
- Any richer signal (on-time completion rate, dispute history, repeat-
  client rate) — flagged as the fuller version when this was scoped,
  intentionally not built now.
- Customer-side rating (a client's own reliability/no-show track record).
- Surfacing the rating anywhere in the app UI (professional profile card,
  browse-list badge, etc.) — the aggregate endpoint exists
  (`GET /professionals/:id/rating`); no mobile screen reads it yet.
- A prompt over the app itself (only WhatsApp prompts today) — a client
  who never messages the bot has no in-app equivalent nudge to rate.

**Schema:** new `Rating` model (`gigId` unique FK to `Gig`, `raterId`/
`rateeId` FKs to `User`, `stars` 1-5, optional `comment`) +
`WhatsAppSession.pendingRatingGigId` (nullable). Migration:
`20260910180000_ratings`.

---

## Track Record positioning — IMPLEMENTED

**Decision:** every piece of Sorted's messaging — "escrow-protected,"
"vetted professionals," "trusted marketplace" — is the identical pitch
every Nigerian services marketplace makes (VConnect said this a decade
ago). It's reassurance, not a reason to talk about Sorted unprompted.
What's actually different was already built (the `Rating` aggregate
above) but only ever mentioned once, in a supporting line of the Phase 1
WhatsApp welcome message: completed jobs here become a real, verifiable
work history — not marketed anywhere as that. Repositioned around
**"Track Record"** as the named thing being built, with escrow
demoted to the mechanism that makes the record trustworthy, not the
headline. No new schema, no new feature — the `Rating` data already
existed; this is entirely about naming it and saying it out loud at the
moments it lands.

**Where this landed:**
- `WhatsappGigConversationService.handleRating` now tells the
  PROFESSIONAL, not just the client, right after a rating is recorded —
  their job count and average, framed as their Track Record growing
  ("professionals who build a real record here get first pick of new
  jobs..."). This is the one genuinely new behavior: previously only the
  client got a "thanks for the feedback" and the professional heard
  nothing when their own record grew.
- Welcome email (`notifications.service.ts`): the differentiation
  paragraph now leads with "every job you complete here becomes part of
  a real track record," escrow stated as what makes that record
  trustworthy, not the opening claim.
- Landing page `#for-professionals` section (`index.html`): headline
  changed from a generic capability list ("Built for your trade,
  whichever one it is") to lead with the Track Record claim; "Build a
  Track Record" promoted to the first bullet, ahead of CAC registration
  help / cheaper materials / no-chasing-payment (all kept, just no
  longer the opening pitch).

**Explicitly not overpromised — a real risk named on purpose:** Sorted
has no lending/credit partnership today. Every rewrite above says the
record "opens doors" / "is proof you can point to" — never "gets you a
loan." That distinction is deliberate: the positioning bets on a
trajectory Sorted is credibly building toward (which the upcoming SME
research instrument is partly there to validate — does access to capital
actually matter to this audience), not a guarantee the product can't
back yet. If a real credit/lending partner materializes, this copy
should be revisited to make the claim concrete rather than aspirational.

**Explicitly deferred:**
- A front-end "Track Record" display (a stat card on a professional's
  profile screen, a shareable/screenshottable version) — today it only
  exists as a sentence in a WhatsApp message and the pre-existing
  `GET /professionals/:id/rating` endpoint. Making it a named, visible
  object in the app itself (not just spoken about) is the natural next
  step once there's a screen to put it on.
- The client-side "record" angle (a client's own reliability/no-show
  history) — this pass is entirely professional-facing, matching where
  the credit-identity narrative actually lands.

---

## Browse available gigs — IMPLEMENTED

**Goal:** a real bug in production, not a feature gap — the idle-state
default assumed EVERY registered sender's message was the start of a new
gig description (Phase 2's `startDraft`). Correct for a client; wrong for
the professional-only accounts being onboarded first, who have nothing to
post. A professional texting "I want to dry clean five shirts" (meaning
"that's the kind of job I do") got read as if THEY wanted a dry cleaner —
the exact confusion reported once production actually caught up to this
code (see the merge-to-`main` note below).

**The fix is pull-based, not just a routing tweak.** ANY account with the
`'professional'` role — hybrid accounts included, not just
professional-only ones — hitting idle now defaults to `showAvailableGigs`
instead of `startDraft` — a numbered list of open, unrestricted gigs
matching their OWN registered trade (`serviceOfferingSubmarketIds`, the
same picks made at role-profile completion), each showing description,
category, location, and price. Replying with a number claims it for real,
through the same `EscrowService.holdStake` path the app's claim button
and Phase 4's broadcast both use — not a WhatsApp-only shortcut. A pure
client (no professional role at all) is the only case where the original
assume-a-description default still applies, since they have nothing to
browse for. Anyone can also ask for the list explicitly with a keyword
("jobs" / "gigs" / "available" / "browse") regardless of role.

**Closing the gap that opened:** routing every professional's idle
message to browse means a hybrid account can no longer post a gig just
by describing it — the description would be read as an idle message and
sent to browse instead. `"post"` (`awaiting_post_description` state) is
the explicit way back into that flow: it asks for the description on the
NEXT message rather than treating "post" itself as one.

**"Streamlined to their profession" is a hard filter, not a suggestion.**
`Gig.submarketId in (serviceOfferingSubmarketIds)` — a dry cleaner never
sees a plumbing job in this list. Same `restrictedToProfessionalId: null`
exclusion as the public-browse fix (Phase 3.1) — nothing shown here is
claimable by someone else anyway.

**State is per-phone, not shared like a broadcast.** New
`WhatsAppSession.browseGigIds` (comma-separated gig ids, this phone's own
ordered list) is deliberately NOT the same mechanism as
`pendingBroadcastGigId` (Phase 4), where many phones legitimately share
one gig id during a race — browsing is one person paging through a list
that means nothing to anyone else's session.

**Explicitly deferred:**
- Pagination past 10 results, or any sort/filter beyond "matches my
  trade" (nearest first, highest-paying first, etc.).
- Location-based filtering within a trade (a dry cleaner in Yaba seeing a
  dry-cleaning job in Ikeja) — everything matching the trade shows,
  regardless of distance, same as Phase 4's broadcast.
- No menu/confirmation step when routing a hybrid account to browse
  instead of posting — if this turns out to surprise hybrid users in
  practice (rather than professionals being the near-universal early
  case this was generalized for), a short "see jobs or post one?"
  branching question is the natural next iteration.

**Also fixed while here — this is genuinely why the bug was invisible
until now:** the last several phases (Phase 2 through Track Record
positioning) had only ever been deployed as PREVIEW builds on
`claude/product-understanding-nw3yaw`; nothing had been merged into
`main`, the only branch Vercel serves to production. Production was
frozen on the Phase 1 commit the entire time — confirmed directly via
Vercel's deployment history, not assumed. Fast-forwarded `main` to the
branch tip (`aa3df14`, a clean 0-ahead/6-behind fast-forward, no merge
conflict) so every phase built this session actually reaches the live
WhatsApp number. Worth re-checking after future phases rather than
assuming it stays in sync automatically.

**Schema:** `WhatsAppSession.browseGigIds` (nullable). Migration:
`20260912000000_whatsapp_browse_gigs`.

---

## Production DB migration drift (My gigs / Browse returning 500)

User reported "Internal Server Error" on both `/gigs/mine` and `/gigs`
(Browse) on the live site. Root cause, confirmed via Vercel runtime logs
(not guessed): `GigsService.listGigs()` — the shared method behind both
endpoints — throws `PrismaClientKnownRequestError: The column
Gig.submissionProofBase64 does not exist in the current database`.

This is much further back than the `restrictedToProfessionalId` column I
first suspected. The live Neon database has had **no migration applied
since `20260901160000_escrow_holding_account_details`** (Sept 1) — every
migration from `20260908120000_gig_submission_proof` through
`20260912000000_whatsapp_browse_gigs` (8 migrations total, covering the
submission-proof field, the entire WhatsApp session/conversation/invite/
broadcast/browse feature set, and Ratings) was generated this session but
never actually executed against production. The code has been deployed
correctly (see the deploy-gap fix above) but the schema it expects was
never created.

Fix: verified all 8 pending migrations are purely additive (new nullable
columns / new tables, no drops) via `grep` for destructive statements —
none found — so combined them into one script wrapped in a single
transaction, plus the matching `_prisma_migrations` rows (real sha256
checksums of each migration.sql, so Prisma's own history table matches
reality and a future `prisma migrate deploy` won't conflict). Handed to
the user as `catch_up_migrations.sql` to run once in Neon's SQL editor —
same reason as prior migrations this session: this sandboxed environment
cannot reach the live Neon database directly (blocked egress), so this
is a self-serve step only the user can execute.

**Lesson for future phases:** every migration generated in this session
needs an explicit confirmation from the user that it was actually run
against Neon before its dependent code is considered "live" — the deploy
gap fix earlier proved the code reaches prod; it does not prove the DB
schema does.

---

## "Congrats on your first gig" — professional completion message

User asked for a WhatsApp message to the professional once their gig is
claimed, funded, and released: a congratulations, plus an incentive to
keep transacting ("access to more customers, healthcare and pension").

Added `EscrowService.notifyProfessionalOfCompletion`, fired alongside the
existing client-facing `promptForRating` at the end of
`releaseToProfessional` — same best-effort-outside-the-transaction
treatment (a failed message must never fail a payout that already
happened), same reuse of `whatsapp.sendMessage` (no new WhatsAppPort
method needed, since this doesn't set any conversation state or expect a
reply — unlike `offerReassignment`/`promptForRating`).

"First gig" is computed live (`Claim.count` where the professional's gig
is `released`), not a stored flag — stays correct for professionals whose
history predates this feature. First release gets "you just got your
first gig done"; every one after gets a shorter "another gig done"
variant, both followed by the same forward-looking line.

**Deliberately softened the healthcare/pension wording.** Asked for
verbatim would read as "we guarantee ... healthcare and pension" — but no
healthcare or pension partner exists yet (same category of risk flagged
for Track Record: don't imply a guarantee that isn't backed by anything
real). Shipped as "we're building toward healthcare and pension access
for professionals with a real track record" instead — same incentive,
without promising something that could be pointed to later as false.
Flagging this explicitly rather than silently changing the ask; revisit
the wording once/if such a partnership actually exists.

---

## Taxonomy gap: no dedicated Laundry/Dry Cleaning category

Surfaced live: while posting Ifeanyi's real ironing job through the
WhatsApp bot, the closest category was "Cleaning" — flagged as a known
gap earlier this session (PLAN.md's taxonomy confirmation via the live
`/taxonomy/submarkets` fetch already noted this). Added
`sub_laundry-dry-cleaning` / key `laundry-dry-cleaning` / label "Laundry
& Dry Cleaning" (domain: physical) to both `seed.ts` and `seed.sql`.

This is a data row, not a schema migration — `listSubmarkets()` orders
by label and numbers the list dynamically (`whatsapp-gig-conversation
.service.ts`'s `numberedList`/`handleCategory`), so nothing else needed
a code change. Handed the user a standalone
`add_dry_cleaning_category.sql` (idempotent, `ON CONFLICT DO UPDATE`) to
run directly in Neon — takes effect immediately, no deploy required,
unlike the schema migrations above.

---

## Global WhatsApp commands (JOBS/POST/MENU work mid-flow)

User hit this live: mid-draft (answering the price question), they typed
something else entirely and got the state's generic rejection ("Sorry, I
didn't get that — reply with just the amount in naira..."). The bot was
strictly linear — every state's handler only understood answers to its
own question, with `CANCEL`/`STOP`/`START OVER` as the sole exception
(already checked before the state switch in `handle()`).

Fix, not a full NLU rewrite (that trade-off was surfaced to the user
first): extended the same pre-switch check to a small fixed set of
escape commands — `JOBS`/`GIGS`/`BROWSE`/etc. and `POST` now interrupt
whatever's in progress and jump to browsing or a fresh post, exactly
like `CANCEL` already did (this state machine has no "pause and resume
a draft" mechanism, so interrupting is the only option — same tradeoff
`CANCEL` already made). Added `MENU`/`HELP`/`?` as a non-interrupting
informational command — it lists the three commands without touching
session state, so someone can check what's available and then still
answer the pending question.

Simplified `handleIdle` afterward: its own JOBS/POST keyword checks were
now dead code (never reached — `handle()` intercepts them first), so
removed them; it's back to just the role-based browse-vs-draft default
described in "Browse available gigs" above.

**Tradeoff, stated to the user before building:** this recognizes only
these exact command words, not arbitrary phrasing ("actually, show me
open jobs instead") — a real NLU/LLM intent layer would catch that, at
the cost of latency, spend, and a new failure mode (misreading a real
answer as a command). Revisit if fixed keywords prove too narrow in
practice.

---

## AI category classification — skip the menu when Claude is confident

Direct follow-up to the tradeoff above: the user asked for the bot to
"always discern what the user wants and point him to the appropriate
category" instead of making everyone scroll a ~20-item numbered menu.
This is the one place in the WhatsApp flow that now uses an actual LLM
call rather than a keyword/menu match — everywhere else in this module
stays deterministic on purpose (see this file's top doc comment: a
wrong NLP guess on a money/location field is worse than one extra
question). Category is different: a wrong guess costs one CATEGORY
reply, never a bad payout, so the cost/benefit flips.

New `WhatsappCategoryClassifierService` (`@anthropic-ai/sdk` +
`zod`, both newly added to `server/package.json`): given the free-text
description and the live submarket list, asks Claude Opus 5 for
exactly one category key or `"none"`, via `messages.parse` +
`zodOutputFormat` (structured output, not string-parsed) so the result
is always one of the real keys or a clean "no match" — never a
hallucinated category. `output_config.effort: "low"` — this is a single
short classification, not agentic work. Fully optional: no
`ANTHROPIC_API_KEY` (or a classification error) returns `null` and
`startDraft` falls straight back to the unchanged numbered-menu path —
this is strictly additive, nothing breaks if it's never configured.

`startDraft` now calls the classifier right after capturing the
description; on a confident match it sets `draftSubmarketId` directly
and skips straight to the location question, telling the user which
category it picked. New global `CATEGORY` keyword (alongside
JOBS/POST/MENU) lets them override a wrong guess — deliberately does
NOT reset the rest of the draft (only fires when `draftDescription` is
already set), since fixing the category shouldn't cost location/price
already collected.

**Cost note for the user:** this calls Opus 5 (the skill's non-negotiable
default absent an explicit ask) on every single gig post now, which is
a simple classification task run at potentially high volume. Worth
asking to switch to a cheaper model (Sonnet or Haiku) if this becomes a
meaningful cost line — that's a one-line change in
`whatsapp-category-classifier.service.ts`, not a redesign.

Also added `ANTHROPIC_API_KEY` to `server/.env.example`, documented as
optional.

---

## KWIK delivery integration — courier dispatch for Laundry & Dry Cleaning

User's request: "integrate it for delivery by drycleaners," after pasting
KWIK's Apiary API documentation (pickup/delivery task creation, pricing,
job-status lookup, corporate billing). Scoped down from the full KWIK
surface to exactly what a dry-cleaning gig needs: two courier legs —
pickup (client → professional's shop, dispatched when a claim is
accepted) and return (professional's shop → client, dispatched when the
professional submits proof of completed work).

**New `DeliveryModule`** (`server/src/modules/delivery/`), a clean leaf
module — same shape as `WhatsappModule`/`PaymentsModule`, no dependency
on Gigs/Escrow/Identity, so both `GigsModule` and `EscrowModule` can
import it without a cycle:
- `delivery.interface.ts` — `DeliveryProviderPort` (`createTask`,
  `getTaskStatus`), returns `null` rather than throwing on any failure —
  courier dispatch is best-effort by design, matching every other
  notification hook in this codebase (a failed courier call must never
  undo a real claim or submission).
- `kwik-delivery.service.ts` — the KWIK adapter. **Built directly from
  the pasted docs, untested against KWIK's real API** (no sandbox or
  credentials available in this environment). Two endpoints
  (`/send_payment_for_task`, `/get_bill_breakdown`, `/getVehicle`,
  `/getLoaderList`) have a literal path reference in the source docs;
  two more (task creation, job-status lookup) do not — those are
  best-guess placeholders (`/create_task`, `/fetch_job_status`),
  overridable via `KWIK_PATH_*` env vars without a code change. Loaders,
  insurance, and COD are hardcoded off — none apply to a garment
  delivery — and vehicle selection is a single configured
  `KWIK_VEHICLE_ID` rather than a live `/getVehicle` call, to keep the
  first cut tractable.
- `delivery.service.ts` — resolves gig/client/professional data via
  Prisma directly (not through GigsService/IdentityService, to stay a
  leaf), decides eligibility (`submarket.key === 'laundry-dry-cleaning'`
  only), and always writes a `DeliveryTask` row — including a
  `failureReason` when dispatch couldn't happen — so a missing delivery
  shows up in the data instead of vanishing silently.

**Schema:** `User.professionalAddressText/Lat/Lng` (new — a professional's
physical shop location didn't exist anywhere before this; needed
regardless of workflow shape, since even a single-leg delivery has to
know where the professional's shop is). `GigRecord` also now exposes
`locationGeoLat/Lng`, which existed as DB columns but were never surfaced
through `GigsService.toGigRecord` — a real gap this closed. New
`DeliveryTask` model (gigId, leg, provider, providerJobId, status,
trackingLink, failureReason). Migration:
`20260917150000_kwik_delivery`.

**Wired into the existing lifecycle**, not new endpoints:
`EscrowService.holdStake` (claim accepted → pickup leg) and
`GigsService.submitForReview` (proof submitted → return leg), both as
one-line best-effort calls after the real transaction commits — same
pattern as `notifyProfessionalOfCompletion`/`promptForRating`.

**Real gaps, stated plainly rather than papered over:**
1. **No confirmed KWIK base URL or full endpoint paths.** The pasted
   docs give field tables, not a host or (for two endpoints) any literal
   path. `KWIK_API_BASE_URL` and `KWIK_PATH_*` must come from KWIK's
   dashboard/support before this can make a single real call.
2. **Geocoding gap.** `Gig.locationGeoLat/Lng` is only ever populated
   when a client picks a location via a map UI — the WhatsApp posting
   flow (`handleLocation`) takes free text and never geocodes it. Until
   that's solved (or WhatsApp gig posts require a shared-location
   message instead of typed text), most WhatsApp-originated dry-cleaning
   gigs will fail the "client location has coordinates" check and just
   log a skip — never silently claim a delivery was dispatched.
3. **No UI/WhatsApp flow yet for a professional to SET their shop
   address.** The field exists; nothing populates it. Until it's set,
   dispatch skips with a clear `failureReason`.
4. **Real KWIK vendor credentials** (`KWIK_DOMAIN_NAME`,
   `KWIK_ACCESS_TOKEN`, `KWIK_VENDOR_ID`, a fetched `KWIK_VEHICLE_ID`)
   are unset — dispatch no-ops until they're configured.

None of these block the code from existing correctly today; they block
it from actually dispatching a real courier until resolved.

---

## Commission system — interim surcharge mechanism — IMPLEMENTED

Explicit product decision: Sorted's 10% commission is **added on top** of
the bounty, not deducted from it. The client is charged `bounty + fee` at
funding time; the professional is paid the **full** bounty at release,
with nothing taken out of their payout.

**Why this over the deduction model:** `EscrowRecord.platformFeeBps` was
already wired as a deduction — `professionalPayoutKobo = bounty - fee` —
from the original manual-pilot build. That's a materially different
economic outcome from what was asked for here: a professional who's been
quoted (and has quoted the client) a bounty of ₦10,000 should receive
₦10,000, not ₦9,000. So the client's side of the transaction changed
instead: the holding account now opens for `bounty + fee`, not `bounty`.

**Explicitly an interim mechanism**, matching this codebase's own SEAM
convention (see `PaymentsProvider`, `MatchingStrategy`, `DeliveryProviderPort`):
there's no Nomba (or equivalent) virtual account per gig yet to split an
inbound transfer at the rail level, so the surcharge is bolted on in
application code as a stand-in. Once virtual accounts land, the rail
does the split natively and this whole surcharge dance is deleted, not
extended — every touch point below says so in a comment, and nothing
downstream should treat `feeKobo`/`totalChargeKobo` as permanent API
shape.

**Mechanics (`EscrowService`):**
- `fundGig`: computes `feeKobo = applyBps(bountyKobo, platformFeeBps)` and
  `totalChargeKobo = bountyKobo + feeKobo`; opens the holding account
  (Paystack checkout or manual-pilot transfer) for `totalChargeKobo`.
  `feeKobo` is frozen on the `EscrowRecord` at this point — release no
  longer recomputes it from `platformFeeBps`, so a mid-flight config
  change can't retarget an amount the client already saw quoted.
- `confirmFunding`: the `fund` ledger entry now records the actual money
  that moved (`bounty + fee`), not just the bounty.
- `releaseToProfessional` / `resolveFrozen('for_professional')`: disburse
  the full bounty — no deduction. The `fee` ledger entry still exists
  (for reporting/audit), it just no longer comes out of the professional's
  wire.
- `refundClient`: refunds the **full** amount actually charged
  (`bounty + fee`) — a gig that never completed shouldn't leave Sorted
  holding a commission on nothing delivered.
- `EscrowRecordView` gained `feeKobo` and `totalChargeKobo` so every
  consumer can show a real breakdown instead of recomputing bps client-side.

**Schema:** no migration needed — `EscrowRecord.feeKobo` already existed
(nullable, previously only set at release); it's now set at `fundGig` time
instead. Old pre-surcharge rows (`feeKobo` null) fall back to computing it
from `platformFeeBps` everywhere it's read, so nothing already in the DB
renders wrong.

**Copy updated everywhere the client sees an amount to pay:**
`WhatsappGigConversationService`'s "pay ₦X here" message, `FundEscrowScreen`
(mobile), and the matching funding card in `index.html` (web) all now show
the bounty, the fee "added on top", and the true total to send — instead
of quietly showing the bounty as if that were the full charge.

---

## Individual vs business accounts — IMPLEMENTED

Product ask: a professional (service provider — e.g. a dry cleaner) can
register as a business rather than an individual, providing company
registration number, director name(s), a business contact email/phone,
and a business address. Existing individual accounts must be able to
convert later, not just choose at signup.

**Schema:** `User.accountType` (`AccountType` enum: `individual` |
`business`, default `individual`) + new 1:1 `BusinessProfile` model
(`companyRegistrationNumber`, `directorNames String[]`, `businessEmail`,
`businessPhone`, `businessAddress`). Migration:
`20260921120000_business_accounts`.

**One endpoint does both signup-time choice AND later conversion** —
`POST /me/role-profile` (`IdentityService.completeRoleProfile`), not a
new route. That endpoint already re-runs at any point after registration
to edit roles/submarket picks (replace-in-full, not diffed); it now also
accepts `accountType` + `businessProfile`. Omitting `accountType`
leaves the account's current type untouched, so a plain submarket-picks
edit can never silently reset business status. Passing
`accountType: 'business'` on an already-existing account IS the
conversion — no separate "convert" endpoint exists or is needed.

**Validation (`IdentityService`):** `business` requires the
`'professional'` role (a client-only account has no company to
register) and a fully-populated `businessProfile` — every field
required, no partial saves, same "no fill in later" discipline as the
existing serviceOfferingSubmarketIds/seekingCategorySubmarketIds rule.
`businessPhone` goes through the same Nigerian-phone normalization as
`UpdateProfileInput.phone`; `businessEmail` gets a basic format check.
`directorNames` accepts one or more (CAMA-registered companies can have
multiple directors) — trimmed, empties dropped, at least one required.

**Mobile (`AccountTypeScreen`, `ProfileScreen`):**
- `AccountTypeScreen` (initial registration): once "professional" is
  selected, an Individual/Business toggle appears; Business reveals the
  five required fields inline, gating "Finish setup" the same way the
  submarket picks already do.
- `ProfileScreen` (existing accounts — the conversion path): a
  professional's Profile screen gets a new "Business account" card,
  showing current status and details if already a business, or a
  "Convert to business account" button that opens the same five-field
  form inline (same edit-in-place pattern as the existing Account/KYC
  cards) and resubmits via `completeRoleProfile` with the account's
  current roles/submarket picks preserved.

**Web (`index.html`)** mirrors both mobile screens: the signup
account-type modal step gets the same Individual/Business toggle +
fields, and the Profile tab gets the same "Business account" view/edit
section (a plain view with an "Edit"/"Convert to business account"
button that reveals the same five fields) — same `completeRoleProfile`
call, same validation, same conversion-by-recall pattern.

---

## Professional directory — IMPLEMENTED

Triggered by a real support moment: a dry-cleaning professional tried to
use "Post a gig" to advertise his own shop, got a raw 403 ("This action
requires the 'client' role") after filling out the whole form, because
Post a gig is for clients hiring, not professionals listing themselves —
and there was genuinely nowhere else for him to be discoverable except
passively, via gig-matching. This closes that gap.

**Product decisions locked in before building:**
1. **Contact routes through the existing gig-invite mechanic, never
   direct off-platform contact.** "Hire" opens Post a gig pre-filled with
   that professional invited (`restrictedToProfessionalId` — this
   already existed for WhatsApp's invite flow, just never exposed on the
   public HTTP `POST /gigs`, now is). Every job started from the
   directory is still escrow-protected — the entire reason Sorted exists
   isn't bypassed for a "faster" contact button.
2. **New `User.displayName`** — professionals previously had no public
   name distinct from their personal `name`; a directory listing "Samuel
   Bello" instead of "Sammy's Dry Cleaners" defeats the point. Optional,
   any role, falls back to `name` wherever rendered when unset. Migration:
   `20260922100000_professional_display_name`.
3. **Category-only filtering for v1** — matches how gig-matching already
   filters (submarket, not geography); no location filter yet.
4. **Both mobile and web** built together, not staged.

**Server:**
- `IdentityService.listProfessionalsBySubmarket` + public
  `GET /professionals?submarket=<key>` (no guard, matches
  `GigsController`'s public browse convention). Returns a thin
  `ProfessionalDirectoryEntry` (id, displayName-or-fallback, avatar,
  kycStatus, accountType) — deliberately no phone/email/address, since
  contact never happens off the gig-invite path.
- `UpdateProfileInput`/`IdentityService.updateProfile` gained
  `displayName` (empty string clears it, same "explicit clear" pattern
  the field already needed).
- `CreateGigDto`/`GigsController.create` now accept
  `restrictedToProfessionalId` on the public endpoint (previously only
  reachable from the WhatsApp conversation flow internally).
  `GigsService.createGig` validates it references a real account with
  the `professional` role — a malformed/bogus id 400s instead of quietly
  creating an uninvitable gig.

**Mobile:** new `DirectoryScreen` (category chips + professional cards +
"Hire") living in `GigStackParamList` alongside `PostGig` — reached from
a "Find a professional" button on `HomeFeedScreen`. `PostGigScreen`
accepts `hireProfessionalId`/`hireProfessionalName`/`hireSubmarketKey`
route params, prefills the category, shows an "Inviting X" banner with a
way to remove it, and sends `restrictedToProfessionalId` on submit.
`ProfileScreen` gained a "Shop / business name" field (professional-only)
in the existing Account edit card.

**Web (`index.html`):** new "Find pros" tab mirroring the same flow —
category chips, professional cards, "Hire" switches to the Post a gig
tab with the category and an invite banner prefilled, `Remove` link
clears it. Profile tab gained the matching "Shop / business name" field,
shown only for professional accounts.

**Deliberately not built:** location filtering, direct messaging/contact
info, and any professional-initiated "boost/feature my listing" — none
were asked for, and the last one in particular would need a monetization
decision this session doesn't have grounds to make on its own.

---

## WhatsApp contacts dashboard — IMPLEMENTED

Trigger: the plan is to put the Sorted WhatsApp bot's number on a flier
as the contact number. Before that ships, the ask was simple — can an
admin actually see everyone who messages the bot, registered or not.

The underlying data already existed: `WhatsAppSession` upserts on every
inbound message (`WhatsappWebhookController.handleMessage` ->
`recordInboundMessage`), tracking phone + `lastInboundAt`. What was
missing was (1) a human name attached to each row, and (2) anywhere to
actually look at it.

1. **`WhatsAppSession.waProfileName`** (new, nullable) — Meta's webhook
   payload already includes `value.contacts[].profile.name` (the
   sender's WhatsApp display name) alongside `value.messages[]`; it was
   never read. Now extracted (matched by `wa_id`, not by array index —
   Meta doesn't guarantee `contacts[i]` pairs with `messages[i]`) and
   refreshed on every inbound message. Not a verified real name — it's
   just what WhatsApp reports — but turns a bare phone-number list into
   something a human can actually scan. Migration:
   `20260923090000_whatsapp_profile_name`.
2. **`GET /admin/whatsapp/contacts`** (new, `WhatsappAdminController`,
   AdminGuard/`x-admin-key` — same disclosed-manual pattern as KYC
   review). Lives in `WhatsappModule` rather than `WhatsappWebhookModule`
   since it only needs the global `PrismaService` for a direct
   cross-reference against `User.phone` — no `IdentityModule` import, so
   it doesn't touch the circular-dependency reasoning that keeps
   `WhatsappModule` lean (see `whatsapp.interface.ts`'s doc comment).
   Returns each contact's phone, WhatsApp display name, current
   conversation state, first-seen/last-message timestamps, and — if that
   phone matches a registered account — their app name and roles, so an
   admin can tell "signed-up user" from "flier lead who just texted in."
   Capped at the 500 most recently active, newest first.
3. **`whatsapp-admin.html`** (new, repo root) — same unlinked-static-page
   pattern as `kyc-admin.html`: admin key entered fresh each visit,
   never stored, `noindex, nofollow`. A single searchable table (by name
   or phone) rather than KYC's per-item review cards, since this is a
   read-only "who's out there" view, not an approve/reject workflow —
   there was nothing to action.

**Deliberately not built:** no reply-from-dashboard, no CSV export, no
pagination beyond the 500-row cap, no outbound messaging from this page
— none were asked for, and the ask was specifically "can we see," not
"can we manage."

---

## Product analytics dashboard — IMPLEMENTED

The ask: a robust view of what's happening in the product — active
accounts, last activity, site clicks, click-to-signup ratio, orders
(active/closed) — explicitly meant to tie in with the WhatsApp contacts
dashboard above, since WhatsApp is where a lot of "orders" actually
originate.

**Two things genuinely didn't exist and needed new instrumentation
before any number could be honest:**
1. **`User.lastLoginAt`** — nothing stamped "last seen" anywhere.
   Decision (confirmed with the user): login-only, not a per-request
   heartbeat — stamped in `IdentityService.login` and at `signup` (which
   counts as the first one). Cheaper than touching it on every
   authenticated request; "active" means "logged in recently."
2. **`SiteEvent`** (new model, `pageview` | `whatsapp_click`) — the
   marketing site (`index.html`) had zero analytics. Decision (confirmed
   with the user): full click tracking, not just a pageview counter.
   Every WhatsApp CTA on the site (`door_customer_hero`,
   `door_customer_bottom`, `raise_hand`, `pro_pitch`) now routes through
   a new `GET /go/whatsapp?cta=<id>&text=<msg>` redirect instead of a
   bare `wa.me` link — an external link can't be click-tracked directly,
   so the click has to pass through the server first. The destination
   number is server-configured (`WHATSAPP_CONTACT_NUMBER`, defaults to
   the number already hardcoded in `index.html`), never taken from the
   query string — the one thing that keeps a public redirect endpoint
   from being an open redirect. A pageview beacon
   (`POST /site-events`, fire-and-forget, `sendBeacon`-style via
   `fetch(..., {keepalive:true})`) fires once per page load. Migration:
   `20260923150000_analytics_dashboard`.

**`GET /admin/analytics/overview`** (new `AnalyticsModule`, AdminGuard —
same pattern as every other admin surface) returns one aggregated
payload for `dashboard.html`'s single page load: accounts (totals, role
split, individual/business, active 7d/30d, new 7d/30d, 30-day signup
trend, KYC funnel), orders (status breakdown, active vs. closed count,
30-day trend, GMV funded/released/refunded, realized fee revenue, top
categories, top client states), WhatsApp (contact totals, registered vs.
not, 30-day trend), site (pageviews, WhatsApp clicks by day and by CTA,
click→signup and pageview→signup ratios), disputes (open/ruled/closed,
rate), delivery failures, and retention (repeat clients/professionals).
Every number is derived from data the product already writes (plus the
two additions above) — nothing estimated.

**One thing recommended but deliberately NOT built**: WhatsApp broadcast
accept/decline rate. `WhatsappBroadcastService`/`WhatsappInviteService`
don't persist a decline anywhere today — a decline just clears the
pending-reply field and sends a message, with no row written. Faking
this number from data that doesn't exist would be worse than not having
it; flagged here as a real future addition (one write per decline) if
it's wanted later.

**`dashboard.html`** (new, repo root, same unlinked-admin-key pattern as
the other two pages) — built per the `dataviz` skill: form chosen before
color (stat tiles for headline numbers, 30-day line charts with a real
crosshair+tooltip for trends, single-hue ranked horizontal bars for
magnitude comparisons — never a distinct hue per category, since none of
these are "tell series apart" charts). Color is the Sorted brand green
throughout, matching the other two admin pages, rather than the skill's
generic default palette — a deliberate substitution the skill itself
calls out as the right move ("to target your brand, substitute this
file's values"). No date-range picker: the API computes a fixed 7-/30-day
window, so there's nothing for a filter to scope yet; flagged as a
natural next step if a custom range is ever needed. Verified by rendering
with mocked data before shipping (screenshots, including the tooltip
hover), not just eyeballing the source.

---

## WhatsApp intake: capture + human handoff — IMPLEMENTED

The ask: with the flier driving people to the WhatsApp bot as the contact
number, should the bot get "more intelligent" (the ask specifically named
OpenAI/"AI tokens") to take the order, confirm a human will reach out,
and let that human arrange pickup and agree cost/payment.

**Decision: no new AI vendor.** The bot already calls Claude (the same
integration "AI category classification" built) — a second provider
would mean a second API key and bill for zero functional gain. This
reuses that existing call, it doesn't add one.

**Replaces the guided WhatsApp gig-posting flow entirely** (product
decision, confirmed with the user — not layered alongside it). The old
category → location → price → assignment-mode → invitee-phone →
confirmation sequence, and the Gig it created and funded directly from
WhatsApp, is gone. A client describing a job now gets: free-text
capture, a best-effort category tag (same Claude call as before, now
informational only — it never blocks or gates), a confirmation that a
human will follow up to arrange pickup and price, and nothing else. No
price, location, or payment is collected by the bot. `WhatsappGigConversationService`
lost `startDraft`/`handleCategory`/`handleLocation`/`handlePrice`/
`handleAssignmentMode`/`handleInviteePhone`/`sendRecap`/`handleConfirmation`
(and the CATEGORY global keyword, which no longer has a step to
re-trigger) in favor of one `captureLead` method. Professional-facing
flows (browse/claim, reassignment, ratings) are untouched — this only
replaces the CLIENT gig-posting path.

**New `Lead` model** (`leads` module) — deliberately not a `Gig`: no
price, no escrow, no matching. A human converts it into a real Gig
through the app once they've actually talked to the client and agreed
pickup/price. Fields: phone, WhatsApp display name (reuses the same
capture as the WhatsApp contacts dashboard), the raw message, a
best-effort category guess, and a status (`new` → `contacted` →
`converted`/`closed`) moved by hand — there's no automation deciding
when a lead is "done." Migration: `20260923170000_leads`.

**Closing the loop the bot's own message promises:** "a human will
reach out shortly" is only true if a human finds out. New
`LEAD_NOTIFICATION_PHONE` config (unset → silent no-op, same pattern as
every other optional WhatsApp config) — when set, the bot best-effort
WhatsApps that number with the lead's details the moment it's captured,
so acting on it doesn't depend on remembering to check `leads.html`.

**`GET/PATCH /admin/leads`** (`LeadsAdminController`, AdminGuard) and
**`leads.html`** (new, repo root, same unlinked-admin-key pattern as the
other three pages) — status filter chips, one card per lead, a status
dropdown per card that PATCHes on change. Verified rendering with mocked
data before shipping.

**Deliberately not built:** the bot does not negotiate pickup time,
price, or payment under any circumstance — that's not an AI-capability
question, it's a "should an LLM make real money commitments
unsupervised" question, and the user's own framing already put a human
in that seat. No lead deduplication (a client who messages twice gets
two lead rows — merge by hand); no auto-conversion from Lead to Gig
(a human creates the real Gig through the app once terms are agreed).

---

## Split payment pivot — schema + PaymentsProvider interface (phase 1 of N)

**Why:** Paystack declined activation — offering escrow (receiving and
holding third-party funds before disbursing them) is a CBN-regulated
activity Sorted isn't licensed for. `PaystackProvider.createHoldingAccount`
+ `disburse` is exactly that shape: the client's full payment lands in
Sorted's own Paystack balance and is paid out to the professional later.
Paystack's own suggested fix is their Split Payment feature: the payment
splits to each destination AT SETTLEMENT, so Sorted's balance never
receives money that isn't its own cut.

**Decision (confirmed with the founder):** adopt Split Payment, and pair
it with a second change — charge the client only once they confirm the
job is done, not upfront at posting. This is a genuine trade-off, not
free: professionals currently have zero payment guarantee before starting
work under this shape, and there's no clean fix for that on Nigerian
payment rails specifically (most payers use bank transfer/USSD, not
saved cards, so a "pre-authorize now, capture later" card mechanic
wouldn't cover most transactions anyway). Accepted deliberately — same
trust-based posture as the WhatsApp lead-capture pivot, backed by the
existing ratings/track-record system rather than a financial guarantee.
Mitigate operationally (e.g. gate early access by KYC/rating), not by
pretending a technical safety net exists where it doesn't.

**This phase — schema + interface only, nothing wired up yet:**
- `User.paystackSubaccountCode` (migration
  `20260925090000_paystack_subaccount`) — a Paystack Subaccount wrapping
  the same `payoutBankCode`/`payoutAccountNumber`/`payoutAccountName` a
  professional already provides. Nothing sets this yet —
  `IdentityService.setPayoutDestination` doesn't call
  `createSubaccount` until the next phase.
- `PaymentsProvider` gains `createSubaccount` and `chargeWithSplit`
  alongside (not replacing) `createHoldingAccount`/`disburse` — those
  stay in place because `EscrowService` still runs the old
  hold-then-disburse flow until its own rewrite lands. `chargeWithSplit`
  replaces `createHoldingAccount` + `confirmFunding` + `disburse` as ONE
  call once wired up: the payer's charge and every destination's payout
  happen atomically at Paystack's end.
- `PaystackProvider`: `createSubaccount` (`POST /subaccount`);
  `chargeWithSplit` creates a fresh flat-amount Transaction Split per gig
  (`POST /split`, multi-destination — ready for a future HMO/pension
  carve-out alongside the professional's own cut) then references it by
  `split_code` at `POST /transaction/initialize`. Both unverified against
  a live Paystack call from this sandboxed environment — confirm exact
  request/response shape before relying on them, same caveat as every
  other Paystack method in this file.
- `ManualPilotProvider`: matching stubs, same "hand it to the founder"
  pattern as its existing `disburse`/`refund` — no real subaccount or
  split concept exists during the manual pilot.

**Not done yet (later phases):**
- `EscrowService` rewrite — no service calls `createSubaccount` or
  `chargeWithSplit` yet. `fundGig`/`confirmFunding`/`holdStake`/
  `releaseToProfessional`/`refundClient`/`freezeForDispute`/
  `resolveFrozen` are all unchanged and still work exactly as before.
- `GigStatus`/`EscrowState` enum changes (`escrow_pending` needs to stop
  meaning "charge before matching" — payment moves to the
  submitted→signed_off step instead).
- Disputes: before payment happens, a ruling for the professional can't
  force a charge on an uncooperative client via API — enforcement becomes
  reputational (rating/access), not financial. Needs designing, not just
  wiring — see the trade-off note above.
- Backfill: existing professionals with payout details on file need a
  one-time script to create their Paystack subaccount retroactively.
- Copy: the welcome email and any landing-page copy promising "money
  sits safely in escrow until it's verified" needs rewriting — that
  promise doesn't hold under this model. `FundEscrowScreen.tsx` (mobile)
  needs to move or disappear.
- Reply to Paystack's compliance email once there's something concrete
  to show — worth asking them directly whether a description of the plan
  is enough or they need to see it live first.

---

## Split payment pivot — EscrowService wired up (phase 2 of N)

**No new migration** — every schema change this phase reuses existing
enum values/columns with new meaning (see the comments added to
`EscrowState`, `GigStatus`, and `EscrowRecord.holdingAccountRef/Details`
in schema.prisma) rather than adding new ones. Verified with a real
`npx tsc --noEmit` + `nest build` + a live Nest bootstrap (DI graph
resolves cleanly, full route table confirmed) — not just read-through.

**New gig lifecycle:** `publishGig` now goes `draft -> open` directly —
no funding gate before a gig is claimable. `escrow_pending` is dead
(unreachable, left in the enum). Nothing is charged until a professional
submits work and the client approves it — that's the new payment moment.

**`EscrowService`, what changed:**
- `fundGig`/`confirmFunding`/`refundClient` deleted — no pre-charge step
  exists anymore, and there's nothing left to refund from (see disputes
  below).
- `holdStake` (claim) now creates the `EscrowRecord` itself — no money
  moves, same as before, just earlier in the lifecycle since there's no
  funding step to have created it first.
- `releaseToProfessional` is now THE payment moment: initiates
  `PaymentsProvider.chargeWithSplit` (lazily creating the professional's
  Paystack subaccount via a new `getOrCreateSubaccount` helper, backed by
  two new `IdentityService` methods —
  `get/setPaystackSubaccountCode`) and returns a `releaseCheckout`
  (checkout URL / account details) for the client to actually pay with —
  it does NOT mark the gig released; that only happens once the charge is
  confirmed.
- New `confirmRelease(gigId, providerRef)` — the only place a gig
  actually becomes "paid." Called by the Paystack webhook
  (`charge.success` now routes here instead of the deleted
  `confirmFunding`) or by a new admin-gated `POST /gigs/:id/confirm-release`
  route for the manual pilot. Records three ledger entries (fund in,
  release out, fee out) in one transaction — the charge and the payout
  happen together now, so the bookkeeping does too.
- `resolveFrozen`: every dispute is pre-payment under this model
  (`raiseDispute` only allows claimed/in_progress/submitted, all before
  `releaseToProfessional` has ever run), so there's never money sitting
  anywhere to move. `for_client` just closes the gig unpaid (reuses the
  `refunded` state/status — nothing was actually refunded, but it's the
  same real-world outcome and didn't justify a new enum value).
  `for_professional` re-attempts the same charge+split
  `releaseToProfessional` would have done. **This is a real, documented
  limit, not a bug: it can prompt the client to pay, it cannot force a
  charge on an uncooperative one** — see escrow.interface.ts's top
  comment for the full trade-off already confirmed with the founder.

**Moved, not just renamed:** `notifyGigIsOpen`/`sendInvite`/
`broadcastOpenGig`/`sendJobMessage` moved from `EscrowService` to
`GigsService` (`GigsModule` now imports `WhatsappModule` — a leaf module,
so no cycle). "A gig became open" is a publish-time event now, not a
funding-time one, and `GigsModule` importing `EscrowModule` to keep this
logic in Escrow instead would have created a real cycle (`EscrowModule`
already imports `GigsModule`). The one external caller
(`WhatsappGigConversationService`'s reassignment flow) now calls
`gigs.sendInvite` instead of `escrow.sendInvite`.

**Still not done (unchanged from phase 1's list, now more urgent):**
- Mobile/web: `FundEscrowScreen.tsx` calls a route (`/gigs/:id/fund`)
  that no longer exists — the app WILL break on that screen until it's
  updated to redirect to `releaseCheckout` at the sign-off step instead.
  Not touched this phase — backend-only, as asked.
- Copy: welcome email, landing page, and any other "money sits safely in
  escrow" language still needs rewriting.
- Backfill: existing professionals' subaccounts are created lazily
  (first release attempt), not retroactively — fine for a pilot with few
  transactions, worth a real backfill script before real volume.
- `PaystackProvider.createSubaccount`/`chargeWithSplit` are still
  unverified against a live Paystack call — this phase only proves the
  code compiles and the DI graph resolves, not that the actual Paystack
  API calls are shaped correctly. Test against Paystack's sandbox before
  flipping `PAYMENTS_PROVIDER_KEY` to `paystack` for real.

---

## Split payment pivot — mobile client (phase 3 of N)

**`FundEscrowScreen` deleted outright**, not just edited — its entire
premise (a funding step between publish and open) no longer exists.
Publishing now goes straight to `open`, so `PostGigScreen.handlePublish`
navigates back to `HomeFeed` instead of to a funding screen. Removed from
`GigStackParamList`/`MainNavigator`, and the dead `escrow_pending` "Fund
escrow →" link on `HomeFeedScreen` is gone with it (the status itself
stays in the `GigStatus` type — same "leave the dead value" policy as the
server enum).

**The payment-collection UI moved into `ReviewSignOffScreen`** — that's
where payment happens now. "Approve & pay" calls `releaseGig` (unchanged
endpoint, new meaning: THE payment moment, not a disbursal of
already-held funds), which returns `releaseCheckout` (a Paystack checkout
link, or manual-pilot transfer instructions — same shape
`FundEscrowScreen` used to render, ported over including the "not
automated escrow" disclosure banner). The screen then polls `getEscrow`
until `state === 'released'`, same polling shape `FundEscrowScreen` used
pre-pivot, just watching for a different terminal state.

`EscrowRecordView.holdingAccount` renamed to `releaseCheckout` in
`api/types.ts` (mirrors the server's own interface rename); `FundGigResult`
and `api/escrow.ts`'s `fundGig` deleted outright, nothing left calling
either.

**Verification:** `npx tsc --noEmit` passes clean across the whole mobile
app. **Not visually tested** — no simulator/emulator available in this
sandboxed environment, so the actual screen flow (proof review → approve
→ checkout → poll → released) has not been run by hand. Worth doing
before shipping, particularly the Paystack `Linking.openURL` handoff and
the return-to-app experience after paying.

**Still not done:** web client (same `FundEscrowScreen`-equivalent
pattern likely exists there — not checked yet), copy (welcome email,
landing page "escrow" language), professional subaccount backfill, and
live Paystack verification — unchanged from phase 2's list.

---

## Split payment pivot — web client (phase 4 of N)

Turned out simpler than mobile: `index.html` (the single-file app shell
embedded in the marketing page) never had a sign-off/payment screen at
all — `loadMineList` already said "Review and sign off from the Sorted
mobile app" for a `submitted` gig, so there was no payment UI to move
anywhere, only the pre-pivot funding UI to delete.

Removed `fundingCard`/`renderRequest`/`renderInstructions`/
`activeFundingPolls`/`stopAllFundingPolls` outright (~110 lines) — wired
to the now-deleted `POST /gigs/:id/fund`, polling a `state` value
(`awaiting_funding`) nothing transitions into anymore. `loadMineList`'s
`escrow_pending` branch is gone with it; its note for a `submitted` gig
now says "...sign off, and pay from the Sorted mobile app" since payment
happens at that same mobile-only step now. Publishing already just
navigated back to the `mine` tab with no funding-screen detour — nothing
to change there. Fixed the same "once it is funded" → "once it is
published" invite-banner copy as mobile's `PostGigScreen`.

**Verified for real, not just typechecked** — `node --check` on the
extracted inline script, then rendered the app shell's `mine` tab in
headless Chromium (Playwright) with mocked `/me` and `/gigs/mine`
responses including a `submitted` gig, screenshotted it, and confirmed
zero console/page errors and the new copy displaying correctly.

**Found, not fixed (confirms and sharpens the existing "Copy" item):**
scrolling the same page past the app shell, the marketing copy is far
more specific than "money sits safely in escrow" — there's a whole
"Fund it in escrow" step description, a "Sign off, get paid" section
mentioning the professional's stake being returned, an "Escrow-protected"
feature callout, AND a worked numeric example ("Client funds ₦120,000 /
Professional stake (held, refundable) ₦12,000 / Sorted fee ₦12,000 /
Professional earns ₦108,000 / Stake returned separately") that describes
the exact pre-pivot mechanics in detail. This is a real content rewrite,
not a find-and-replace — flagging the actual size of it now that it's
been seen directly, not deferring it as a vague "copy" line item anymore.

---

## Split payment pivot — copy (phase 5 of N)

Every "escrow"/"stake" mention actually shown to a user, rewritten.
Deliberately left alone: internal names (`EscrowService`, `EscrowModule`,
`getEscrow`, `/gigs/:id/escrow`, the `EscrowState`/`GigStatus` enum
values themselves) — those are code, not copy, and renaming them is a
much bigger refactor nobody asked for. Also left alone: `ClaimWorkScreen`'s
"Your stake" display — that was ALREADY disclosed as illustrative/
not-real before this pivot ("Sorted is not collecting a real stake
payment during this pilot — shown for reference only"), so it isn't
newly false; and the dead `escrow_pending`/`awaiting_funding` status-label
entries in `HomeFeedScreen`, `dashboard.html`, and `index.html`'s own
`STATUS_LABEL` maps, same "leave the unreachable value, don't chase every
reference" call made in phases 2–4.

**`index.html` (the landing page)** — the real content rewrite flagged at
the end of phase 4:
- "How it works" 3-step flow: step 2 ("Fund it in escrow") replaced with
  "Professional gets to work" (nothing charged yet); step 3 ("Sign off,
  get paid," which mentioned the professional's stake being returned —
  never real even pre-pivot, see above) rewritten to "Sign off, pay,
  done," describing what's actually true: payment and payout happen the
  same moment, on approval.
- "For professionals" pitch: "paid through escrow" → "paid the moment
  it's approved."
- "Transparent by design" math section: headline ("every naira accounted
  for before work even starts") was now backwards — work starts BEFORE
  any charge happens — changed to "every naira, fixed before you agree to
  anything," and added a line making the charge timing explicit. The
  worked example dropped both stake rows entirely (client pays once, at
  approval; splits into professional's payout and Sorted's fee — no
  separate stake line ever existed in the real payment flow).
  Re-rendered and screenshotted at 2x to confirm nothing broke visually
  after removing two rows — it didn't (the "strikethrough" look on the
  amounts in an earlier screenshot was just the ₦ glyph's own double bar,
  not a CSS bug — worth noting since it looked alarming at first glance).
- "Escrow-protected" trust callout → "Pay only on approval" (description
  underneath was already accurate, only the label was wrong).
- Directory modal subtext → explicit "you only pay once you approve the
  work" instead of the "escrow-protected" label.

**Mobile:** `DirectoryScreen.tsx` had the identical "escrow-protected
gig" subtext and a stale doc comment claiming hiring "still goes through
escrow" — both fixed to match. (`ReviewSignOffScreen`'s own copy was
already rewritten correctly in phase 3, alongside the screen itself.)

**Server:** the welcome email's "the money sits safely in escrow until
it's verified" → "nothing is charged until you sign off that it's
actually done" — same promise, accurate to what's actually true now.

**Verification:** `tsc --noEmit` clean on both server and mobile (all
edits were comments/strings, so this mostly confirms nothing else broke).
Re-rendered `index.html`'s four edited sections in headless Chromium at
2x scale and screenshotted each — zero console errors, copy displays as
intended, receipt layout holds with two rows removed.

**Still not done:** professional subaccount backfill and live Paystack
verification — the only items left from phase 2's original list. Mobile
visual testing (phase 3) and a `mobile/README.md` doc-consistency pass
were both explicitly deferred, not forgotten — the former needs a
simulator this environment doesn't have, the latter is dev reference
documentation, not user-facing copy, and out of scope for this phase.

---

## Account number verification (PaymentsProvider.resolveAccount)

Prompted by Paystack's own "Verify Account Number" docs (`/bank/resolve`,
free, Nigeria/Ghana) — confirms a bank code + account number actually
resolves to a real account before Sorted trusts it, catching a mistyped
account number at the point a professional enters it rather than deep
inside a `chargeWithSplit` failure at release time.

- `PaymentsProvider` gains `resolveAccount(bankCode, accountNumber):
  Promise<ResolvedAccount>` — `ResolvedAccount.accountName` is the
  provider's own name on file, or `null` when the provider can't verify
  at all.
- `PaystackProvider.resolveAccount` — `GET /bank/resolve`. Unverified
  against a live call, same caveat as `createSubaccount`/`chargeWithSplit`.
- `ManualPilotProvider.resolveAccount` — always returns `accountName:
  null` (no API to check against during the pilot) rather than
  fabricating a match — same trust-based posture as every other
  manual-pilot method.
- `IdentityService.setPayoutDestination` now calls `resolveAccount`
  before saving, and **fails closed**: any resolution error (account
  doesn't exist, invalid bank code, or the provider being unreachable)
  rejects the whole call. Real trade-off, stated plainly: a Paystack
  outage would also block saving payout details — accepted as the safer
  default for money-adjacent data. When resolved, the provider's
  `accountName` overwrites whatever the professional typed (Paystack's
  own name-on-file is the trust anchor, not free-text input); when the
  provider can't verify (manual pilot), the typed name is kept.
- `IdentityModule` now imports `PaymentsModule` — safe, no cycle
  (`PaymentsModule` is a leaf, same reasoning `GigsModule`'s own doc
  comment gives for importing `WhatsappModule` in phase 2).

**Verification:** `tsc --noEmit` and `nest build` clean; booted the
compiled server against a fake `DATABASE_URL` and confirmed all 40 routes
map with zero `Nest can't resolve`/`UnknownDependenciesException` errors
— specifically proving the new `IdentityModule → PaymentsModule` edge
resolves. (The boot then fails on `PrismaClientInitializationError:
Can't reach database server` — expected, same pre-existing "no local
Postgres in this sandbox" limitation as every earlier boot test this
session, unrelated to this change.)

No UI currently calls `PATCH /me/payout-destination` on mobile or web —
checked both before making this change, so there's no existing screen
whose behavior could break from a corrected `accountName` coming back.

---

## Bank list endpoint + payout account screen

Prompted by realizing the previous phase's `resolveAccount`/`createSubaccount`
work had nothing feeding it real data: `ProfileScreen.tsx` literally
rendered `<StatRow label="Payout accounts" value="Not built yet" />` —
there was no screen anywhere, mobile or web, where a professional could
enter their bank details at all.

**Backend:**
- `PaymentsProvider.listBanks(): Promise<Bank[]>` — the picker data a
  professional needs to know what `bankCode` to submit (`bankCode` is
  required by `resolveAccount`/`createSubaccount`/`PayoutDestination`,
  but nothing previously let a client discover valid codes).
  `PaystackProvider.listBanks` calls `GET /bank?currency=NGN` — unverified
  against a live call, same caveat as every other Paystack method.
  `ManualPilotProvider.listBanks` returns a **hand-typed fallback of ~15
  major banks** (Access, GTBank, Zenith, First Bank, UBA, ...) by their
  well-established codes — explicitly NOT Paystack's real list, NOT
  verified live, and deliberately not expanded further: the real fix is
  flipping to `paystack`, not growing this list.
- New `GET /taxonomy/banks` route on the existing `TaxonomyController` —
  same "reference data for a picker" role as `domains`/`submarkets`/
  `client-types` there already, even though this one comes from
  `PaymentsProvider` instead of Prisma.
- New `GET /me/payout-destination` route — `IdentityPort.
  getPayoutDestination` already existed (`EscrowService` reads it
  internally) but had no HTTP route, so a screen could write blind but
  never read back what's already saved. Added alongside the existing
  `PATCH`.
- Module wiring: `GigsModule` now imports `PaymentsModule` directly
  (`TaxonomyController` needs `PAYMENTS_PROVIDER` in its own DI scope —
  Nest doesn't re-export a module's imports transitively, so
  `IdentityModule` already importing `PaymentsModule` doesn't cover this).
  Same no-cycle reasoning as every other leaf-module import this pivot.

**Mobile:** `ProfileScreen.tsx` gains a "Payout account" card (professional
role only), inserted between Verification and Business account — bank
picker (chips, same pattern as the state picker), account number input,
account holder name input. Fetches the bank list and current destination
on mount alongside the existing KYC fetch; `PayoutDestination` view state
uses `undefined`/`null`/value to distinguish "still loading" from
"genuinely nothing saved yet" from "here's what's saved." The account
name field stays required client-side (matches the DTO) even though the
server overwrites it when Paystack can resolve one — during the manual
pilot it's the only name that ever gets saved, so it can't be optional.

**Verification:** `tsc --noEmit` clean on both server and mobile; booted
the compiled server and confirmed `/taxonomy/banks` and both `/me/payout-
destination` routes map with zero DI resolution errors (the new
`GigsModule → PaymentsModule` edge specifically). **Not visually tested**
— same no-simulator limitation as every other mobile UI change this
session.

**Still not done:** the equivalent web payout screen (index.html's
Profile panel has no payout section either — not touched this phase,
mobile only). Live Paystack verification for all of `resolveAccount`/
`createSubaccount`/`chargeWithSplit`/`listBanks` remains the single
biggest open item — none of it has hit a real Paystack call yet.

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
