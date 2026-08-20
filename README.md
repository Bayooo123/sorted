# Sorted

This repo holds three independent pieces, split at the top level so each
deploys/runs on its own terms — no dashboard overrides needed:

- **`/` (repo root)** — the marketing/waitlist landing page. Plain static
  HTML (`index.html`), no build step, no `package.json` at this level.
  Vercel's default project settings (Root Directory = `/`) serve it as-is.
  This is what fixes the `404: DEPLOYMENT_NOT_FOUND` the "sorted" Vercel
  project was returning — that project had nothing to deploy because the
  whole repo was empty.
- **`server/`** — the NestJS + Prisma API described in `HANDOFF.md`. Per
  `HANDOFF.md` §2 this deploys to Railway/Render, not Vercel; when that's
  set up, point that service's root directory at `server/`.
- **`mobile/`** — the React Native (Expo) app. This is the actual product
  (`HANDOFF.md` §2) — the landing page above is waitlist-only. See
  [`mobile/README.md`](./mobile/README.md) for what's wired to the real
  API vs. still mocked, screen by screen.

Start here:
- [`HANDOFF.md`](./HANDOFF.md) — the CTO handoff: architecture decision, the
  nine module boundaries, data model, escrow state machine, build order.
- [`PLAN.md`](./PLAN.md) — endpoints/interfaces/screens plan for slices 1–3,
  written per `HANDOFF.md` §10. Stop-for-review point before any
  Payments/Escrow logic.
- [`PRD.md`](./PRD.md) — product requirements for the mobile app. Screens,
  flows, and mobile-specific requirements derived from `HANDOFF.md`/
  `PLAN.md`; flags where `SPEC.md`/`/screens` (referenced by `HANDOFF.md`
  but not in this repo) still need to be reconciled in.
- [`mobile/README.md`](./mobile/README.md) — what's actually built:
  screen-by-screen, which ones are wired to the real API vs. mocked.

## Landing page

`index.html` at the repo root. No dependencies, no build. Edit it directly.

It's an installable PWA: `manifest.json`, `sw.js` (network-first for the
page, cache-first for static assets), and icons in `icons/` +
`apple-touch-icon.png`. Note this is a deviation from `HANDOFF.md` §2,
which specifies React Native (Expo) for the actual product — PWA was
chosen for the landing page specifically to ship an installable "front
door" without an app-store review cycle. The real transacting app (post a
gig, escrow, sign-off) still doesn't exist as a frontend anywhere yet;
this is marketing/waitlist only.

The waitlist form is live: it inserts into `public.waitlist` in a
dedicated Supabase project (org REFORMA, project `sorted`) via PostgREST,
using a publishable key that's safe to expose client-side. RLS on that
table allows INSERT only for `anon` — no SELECT policy exists, so the
signup list isn't readable through the public key, only via the Supabase
dashboard or service-role key.

## API

```bash
cd server
npm install
cp .env.example .env       # fill in DATABASE_URL at minimum
npx prisma generate
npx nest start --watch
```

Nine Nest modules (`server/src/modules/*`), each exposing only its
documented interface. **Identity, Gigs, and Taxonomy are implemented for
real** (HTTP routes, business logic, Prisma-backed) — the other six
(Matching's assignment step, Payments, Escrow, Verification, Disputes,
Ledger, Reputation) are still typed stub methods
(`NotImplementedException`), no HTTP routes. Full Prisma schema
(`server/prisma/schema.prisma`) is in place. No migration run against a
live DB yet. `npx nest build` and `npx prisma validate` both pass. See
`PLAN.md` for the slice-by-slice detail and exact endpoint list.

### Module map

| Module | Owns | Interface | Seam |
|---|---|---|---|
| Identity | users, auth, KYC, payout dest | `IdentityPort` | `IdentityVerifier` strategy |
| Gigs | gig entity, lifecycle, criteria | `GigsPort` | `GigIntake` (source), `GigTemplate` (recurrence) |
| Matching | pricing + professional assignment | `MatchingStrategy` | swap `FixedPriceAccept` for auction/dynamic pricing |
| Payments | the money rail (Monnify) | `PaymentsProvider` | swap/add providers |
| Escrow ★ | hold-and-release state machine | `EscrowPort` | `platform_fee_bps` config per gig |
| Verification | proof collection + evaluation | `VerificationStrategy` | swap per gig type |
| Disputes | freeze, neutral, ruling | `DisputesPort` | thin now, real freeze always |
| Ledger ★ | append-only money log | `LedgerPort` | foundation for future secondary market |
| Reputation & Notifications | track record, event delivery | `ReputationPort`, `NotificationsPort` | channel-agnostic notify() |

Full detail in `HANDOFF.md` §3. Modules talk to each other only through
these interfaces — never by reaching into another module's Prisma tables.
