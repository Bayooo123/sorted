# Sorted

Escrowed gig marketplace — modular monolith (NestJS + TypeScript + Prisma/Postgres).

Start here:
- [`HANDOFF.md`](./HANDOFF.md) — the CTO handoff: architecture decision, the
  nine module boundaries, data model, escrow state machine, build order.
- [`PLAN.md`](./PLAN.md) — endpoints/interfaces/screens plan for slices 1–3,
  written per `HANDOFF.md` §10. Stop-for-review point before any
  Payments/Escrow logic.

## Status

Skeleton only: nine Nest modules (`src/modules/*`), each exposing just its
documented interface as typed stubs, plus the full Prisma schema
(`prisma/schema.prisma`). No business logic, no HTTP routes, no migration
run yet. `npx nest build` and `npx prisma validate` both pass.

## Getting started

```bash
npm install
cp .env.example .env       # fill in DATABASE_URL at minimum
npx prisma generate
npx nest start --watch
```

## Module map

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
