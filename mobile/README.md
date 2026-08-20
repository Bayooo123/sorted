# Sorted — Mobile app

React Native (Expo), TypeScript. The actual product (`HANDOFF.md` §2) —
the repo root's landing page is waitlist-only.

```bash
cd mobile
npm install
npm run start   # then press 'a' for Android, 'i' for iOS, 'w' for web
```

Point at a running `server/` instance with `EXPO_PUBLIC_API_URL` (defaults
to `http://localhost:3000`, which works for the Android emulator/iOS
simulator on the same machine; use your LAN IP for a physical device).

## What's real vs. mocked

Built against `HANDOFF.md`'s Aug 2026 revision and the mobile screens
handoff (11 screens, Client/Professional terminology). Server-side, only
Identity, Gigs, and Taxonomy have HTTP controllers (`PLAN.md` — Matching,
Payments, Escrow, Verification, Disputes, Ledger, Reputation are
providers-only, no routes yet). This app is honest about that split:

**Fully wired to the real API:**
- Screen 01–02 — phone sign-in, OTP verify (`POST /auth/otp/request`,
  `POST /auth/otp/verify`)
- Screen 03 — account type + category pickers (`POST /me/role-profile`,
  `GET /taxonomy/submarkets`)
- Screen 05 — post a gig, including the multi-criterion list and
  materials-mode toggle the handoff calls out as not-yet-designed
  (`POST /gigs`, `POST /gigs/:id/publish`)

**UI built, but backed by a session-only local cache, not the server:**
- Screen 04 — Home / gig feed
- Screen 10 — Browse / market feed (dev-only loaded/empty/loading toggle,
  `__DEV__`-gated, per the handoff's own instruction to remove it from
  the shipped build)

`GigsService.listGigs` is still a `NotImplementedException` stub
(`PLAN.md`, slice 5) and there's no "list my gigs" endpoint either — see
`src/state/GigsCacheContext.tsx` for the stopgap and what to replace it
with once slice 5 ships.

**UI built, actions disabled — no HTTP route exists yet:**
- Screen 06 — Fund escrow ★ (Payments/Escrow module)
- Screen 07 — Review & sign off ★, including the inspection-request
  toggle from `HANDOFF.md` §3.6
- Screen 08 — Ledger
- Screen 09 — Profile (Reputation numbers; account fields real, stats
  placeholder)
- Screen 11 — Claim + stake + work ★ (real camera picker for proof
  photos; submit has nowhere to go yet)

Every mocked/disabled spot has an in-app banner explaining exactly what's
missing and which `HANDOFF.md`/`PLAN.md` slice unblocks it — check those
before wiring, the field/endpoint names are already matched.

**Not built at all** — the handoff's own "screens not yet started" list:
gig detail (pre-claim), dispute flow, KYC/BVN gate, withdraw/payout flow,
timeout/abandonment notice. Sequence these next per that list.

## Structure

```
src/
  api/          typed fetch client + one file per backend module consumed
  auth/         session state (SecureStore-backed JWT, current user)
  state/        GigsCacheContext — see "What's real vs. mocked" above
  theme/        design tokens (HANDOFF.md §6 + --error from the handoff)
  components/   shared UI primitives (Button, TextField, Card, Banner, Pill)
  navigation/   Auth stack, Main tabs (role-driven, not a fixed 3-way split
                — HANDOFF.md §11 leaves whether Hybrid ships in v1 open)
  screens/      one file per screen, numbered per the handoff in a comment
```

## Terminology

Client / Professional everywhere, per the handoff's terminology lock — no
`payer`/`solver`/generic-`user` in code, copy, or file names. The backend
was renamed to match in the same pass that built this app (see `PLAN.md`).
