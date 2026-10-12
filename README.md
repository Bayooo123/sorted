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

## Website (sorted.com.ng)

Plain static files at the repo root, no build step:

| Path | What |
|---|---|
| `/` (`index.html`) | Landing page for Sorted dry cleaning, in the mobile app's design (cream / deep green / lime, Bricolage Grotesque + IBM Plex Mono). |
| `/app` | The Sorted mobile app's web build. `vercel.json` proxies it from the `sorted-app-preview` Vercel project (repo Bayooo123/AFRICA, `sorted-app/`), so the app deploys on its own. `/app/api/*` goes to the API. |
| `/classic` (`classic.html`) | The previous landing page and web client for all job categories (post a gig, claim, pay). The installable PWA (`manifest.json`) opens here. |
| `/dashboard`, `/kyc-admin`, `/leads`, `/whatsapp-admin` | Admin pages, unchanged. |

`sw.js` never touches `/app` or `/api` requests, so the app always gets fresh data.

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
