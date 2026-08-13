# Sorted

This repo has two independent deployables, split at the top level so each
can deploy with its platform's zero-config defaults — no dashboard
overrides needed on either side:

- **`/` (repo root)** — the marketing/waitlist landing page. Plain static
  HTML (`index.html`), no build step, no `package.json` at this level.
  Vercel's default project settings (Root Directory = `/`) serve it as-is.
  This is what fixes the `404: DEPLOYMENT_NOT_FOUND` the "sorted" Vercel
  project was returning — that project had nothing to deploy because the
  whole repo was empty.
- **`server/`** — the NestJS + Prisma API described in `HANDOFF.md`. Per
  `HANDOFF.md` §2 this deploys to Railway/Render, not Vercel; when that's
  set up, point that service's root directory at `server/`.

Start here:
- [`HANDOFF.md`](./HANDOFF.md) — the CTO handoff: architecture decision, the
  nine module boundaries, data model, escrow state machine, build order.
- [`PLAN.md`](./PLAN.md) — endpoints/interfaces/screens plan for slices 1–3,
  written per `HANDOFF.md` §10. Stop-for-review point before any
  Payments/Escrow logic.

## Landing page

`index.html` at the repo root. No dependencies, no build. Edit it directly.
The waitlist form is client-side only right now — see the comment in its
`<script>` tag; it isn't wired to a real signup endpoint yet.

## API

```bash
cd server
npm install
cp .env.example .env       # fill in DATABASE_URL at minimum
npx prisma generate
npx nest start --watch
```

Skeleton only: nine Nest modules (`server/src/modules/*`), each exposing
just its documented interface as typed stubs, plus the full Prisma schema
(`server/prisma/schema.prisma`). No business logic, no HTTP routes, no
migration run yet. `npx nest build` and `npx prisma validate` both pass.

### Module map

| Module | Owns | Interface | Seam |
|---|---|---|---|
| Identity | users, auth, KYC, payout dest | `IdentityPort` | `IdentityVerifier` strategy |
| Gigs | gig entity, lifecycle, criteria | `GigsPort` | `GigIntake` (source), `GigTemplate` (recurrence) |
| Matching | pricing + solver assignment | `MatchingStrategy` | swap `FixedPriceAccept` for auction/dynamic pricing |
| Payments | the money rail (Monnify) | `PaymentsProvider` | swap/add providers |
| Escrow ★ | hold-and-release state machine | `EscrowPort` | `platform_fee_bps` config per gig |
| Verification | proof collection + evaluation | `VerificationStrategy` | swap per gig type |
| Disputes | freeze, neutral, ruling | `DisputesPort` | thin now, real freeze always |
| Ledger ★ | append-only money log | `LedgerPort` | foundation for future secondary market |
| Reputation & Notifications | track record, event delivery | `ReputationPort`, `NotificationsPort` | channel-agnostic notify() |

Full detail in `HANDOFF.md` §3. Modules talk to each other only through
these interfaces — never by reaching into another module's Prisma tables.
