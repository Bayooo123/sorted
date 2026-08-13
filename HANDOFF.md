# Sorted — Product Development Handoff (CTO)

**To:** Jude Odey, CTO
**From:** Founding team
**Re:** What to build for v1 (MVP), and how to build it so v2–v4 slot in without a rewrite
**Build method:** Jude + Claude Code
**Companion artifacts:** `SPEC.md` (product/UX), `/screens` (11 mockups — the v1 surface), pitch deck

---

## 0. How to read this document

This is not a screen list. It's the system: what the MVP does, why it's shaped this way, and — for every subsystem — **the seam that lets the known-future version replace it without demolition.**

The governing principle is one line, and it resolves the usual MVP tension:

> **Build the MVP small. But at every seam where we already know change is coming, put a clean boundary instead of a hardcoded assumption.**

We are *not* building the future now. We are building the present in a way that doesn't have to be torn up. Extension **points**, not extensions. When in doubt, ship the simple thing behind a clean interface. §3 lists exactly where those interfaces go; §8 shows what plugs into each one later.

**Working with Claude Code:** favour structure the agent can hold in one context window — a modular monolith with explicit module interfaces documents itself, so the agent (and the next engineer) can reason about one module without loading the whole system. Heavily comment the seams. Keep the money paths (§5) under close human review; let the agent move faster on the non-money modules.

---

## 1. Architecture decision: modular monolith

**Decision: a single deployable Node/TypeScript service, internally partitioned into modules with well-drawn boundaries and explicit interfaces between them. One Postgres database. One React Native app.**

Why this, and not microservices:
- **Lean-team fit.** Jude + an agent should not be running service discovery, inter-service auth, distributed tracing, and 6 deploy pipelines. A monolith is one deploy, one log stream, one place to reason about.
- **We get the extension seams anyway.** The benefit people chase with microservices — replaceable components — comes from *clean module boundaries*, not from network boundaries. We draw the boundaries as **module interfaces inside the monolith**. A module can later be extracted into a service if scale ever demands it, precisely because its boundary is already clean.
- **Money integrity is easier in one DB.** Escrow correctness relies on ACID transactions across gig/escrow/ledger state. In a monolith that's one local transaction. Split across services and you're into distributed-transaction / saga complexity you do not want while handling other people's money on a small team.
- **Reversible.** This decision has a cheap exit: if one module (say, matching, once it's a heavy auction engine) needs its own scaling, its clean interface means it lifts out into a service later. We are not locked in.

The rule that makes it work: **modules talk to each other only through their published interfaces, never by reaching into each other's tables or internals.** The compiler and the folder structure enforce this. This is the single most important architectural discipline in the codebase — it's what keeps "modular monolith" from decaying into "big ball of mud."

---

## 2. Stack

- **Language/runtime:** Node.js + **TypeScript** (types are a correctness tool for a money app; non-negotiable).
- **API framework:** NestJS. *Chosen deliberately over bare Express* — its module system enforces the boundaries in §3 structurally (each module is a Nest module with explicit providers/exports), which is exactly the discipline we're relying on. It also gives the agent a consistent shape to generate into.
- **DB:** **PostgreSQL** + **Prisma**. ACID for money. No document store for core data.
- **Mobile:** **React Native (Expo)** — Android-first market, one codebase for iOS+Android, matches the phone mockups.
- **Auth:** phone + OTP (phone-first market). 
- **Payments:** **Monnify**, wrapped behind our own `PaymentsProvider` interface (§3.4, §5). Monnify ships an MCP server (`@monnify/mcp-server`) Claude Code can use directly for virtual accounts, disbursements, transaction queries.
- **Storage:** S3-compatible (Cloudflare R2) for proof media.
- **Hosting:** Railway/Render + managed Postgres. One service. No k8s, no queue in v1 (see §7 for the one place a job-runner is needed).

---

## 3. The module map (the boundaries)

Nine modules. Each has: a **responsibility**, a **public interface** (what other modules may call), and a **seam** (the known extension point). Modules never touch each other's tables.

### 3.1 Identity
- **Owns:** users, phone+OTP auth, roles (payer/solver), KYC status, payout bank details, `monnify_customer_ref`.
- **Interface:** `getUser`, `verifyIdentity`, `getPayoutDestination`, `assertRole`.
- **Seam:** KYC is a **strategy** — v1 = Monnify BVN/NIN. Interface `IdentityVerifier` so additional/【stricter verification (liveness, document upload) drops in per user tier later. Roles are flags, so new actor types (Neutral, NGO-broker, corporate-admin) are added without reshaping User.

### 3.2 Gigs
- **Owns:** the gig entity, its lifecycle/status machine, and the **locked criteria**.
- **Interface:** `createGig`, `publishGig` (locks criteria), `getGig`, `transitionStatus`, `listGigs(filter)`.
- **Seam — INTAKE:** a gig must **not assume a human payer created it.** Creation goes through an `GigIntake` interface with a `source` on every gig (`self_posted` in v1). Future feeders — signal detection, institutional submissions, sensor triggers — implement the same intake interface and produce gigs the rest of the system treats identically. *This is the seam that lets the original "signal-driven problem market" vision arrive as an addition, not a rewrite.*
- **Seam — RECURRENCE:** model a gig as optionally an instance of a `GigTemplate` (nullable `template_id`). v1 only ever creates single instances; the column existing means recurring contracts (cleaning, retainers) become "generate instances from a template on a schedule" rather than a schema migration.
- **Seam — TAXONOMY:** `domain`, `submarket`, `payer_type` are **data, not enums hardcoded in logic** (seed table). New submarkets/payer types are rows, not deploys.

### 3.3 Matching
- **Owns:** how a gig gets a price and a solver.
- **Interface:** `MatchingStrategy` → `priceGig(gig)`, `assignSolver(gig, claim)`.
- **Seam:** v1 implementation = `FixedPriceAccept` (payer sets bounty; first credible solver who stakes claims it). Known futures — **reverse auction** (solvers bid down), then **signal/dynamic pricing** — are *alternate implementations of the same interface.* Because pricing/assignment lives **only** here and nowhere in the Gig model, swapping the strategy never touches gigs, escrow, or UI contracts. *This is the cleanest, highest-value seam in the system — protect it.*

### 3.4 Payments (Monnify wrapped)
- **Owns:** all contact with the money rail. **Nothing else in the codebase imports the Monnify SDK.**
- **Interface:** `PaymentsProvider` → `createHoldingAccount(gig)`, `confirmFunding(ref)`, `disburse(splits[])`, `refund(ref)`, `verifyWebhook(payload)`.
- **Seam:** Monnify is *an implementation*, not the interface. A second provider (redundancy, or a future **procurement/government funding flow** with entirely different mechanics) is a new class behind the same interface. Escrow logic (§3.5) calls the interface, never Monnify directly — so the escrow state machine is provider-agnostic.

### 3.5 Escrow  ★ (the money core — see §5)
- **Owns:** the hold-and-release **state machine** that sits *between* Payments (the rail) and Gigs (the work). This is Sorted's actual product.
- **Interface:** `fundGig`, `holdStake`, `releaseToSolver`, `refundPayer`, `freezeForDispute`, `resolveFrozen`.
- **Seam:** fee is `platform_fee_bps` **config per gig** (1000=10%, 500=launch rate) — not a constant. Stake %, small-job floor: config too. The state machine is explicit and closed (§5) so new states (e.g. `partial_release` for milestone gigs) are added deliberately, never improvised.

### 3.6 Verification
- **Owns:** deciding whether a criterion is "met."
- **Interface:** `VerificationStrategy` → `collectProof(criterion)`, `evaluate(criterion, proof)`.
- **Seam:** v1 = `PayerSignoff` (payer taps met/not-met against photo per locked criterion). Known futures — tamper-evident media, third-party/site inspection, automated checks per problem-type — are alternate strategies behind the same interface. Because "how done is proven" is isolated here, richer verification never touches escrow or gigs. Different gig types can carry different strategies later.

### 3.7 Disputes
- **Owns:** the neutral-arbitration flow; freezing money; recording rulings and penalties.
- **Interface:** `raiseDispute`, `assignNeutral`, `recordRuling`, `applyPenalty`.
- **Seam:** v1 can be **thin** — even admin-assisted neutral assignment — BUT the **freeze must be real**: while a dispute is open, Escrow state = `dispute_hold` and release is impossible. The interface is built so a full neutral-panel + internal appeal tier (per the arbitration design) slots in later without changing how money freezes.

### 3.8 Ledger  ★
- **Owns:** the append-only record of every naira movement.
- **Interface:** `record(entry)` (append only), `getGigLedger`, `getBalance`.
- **Seam:** because it's a complete, immutable audit of positions and outcomes, it's also the **foundation the future secondary market stands on** — tradeable "verified completed gig" positions become an addition on top of clean ledger + gig-ownership, not a data migration. Build it rigorously now and v-future is additive.

### 3.9 Reputation & Notifications
- **Reputation owns:** the compounding track record — `jobs_completed`, `dispute_rate` (the moat metric). Interface `getReputation`, `recordOutcome`. Seam: scoring is a function that can grow richer without schema change.
- **Notifications owns:** OTP, gig/escrow/dispute events. Interface `notify(user, event)`. Seam: channel-agnostic (SMS in v1; push/WhatsApp/email are added channels behind the same call).

---

## 4. Data model (Prisma)

Skeleton below. ★ = money-integrity fields the agent must not remove. Extension-seam fields are annotated.

```
User            id, phone(unique), name, role_flags, kyc_status, identity_ref,
                monnify_customer_ref, payout_bank, created_at
                // reputation derived via module 3.9

GigTemplate     id, payer_id, spec(json), recurrence(nullable)   // SEAM: recurrence — unused in v1
Gig             id, payer_id, source ★(self_posted|…SEAM: intake),
                template_id(nullable ★ SEAM: recurrence),
                title, description, domain, submarket, payer_type,   // taxonomy = FK to seed tables
                location_text, location_geo(nullable),
                materials_mode(bounty_covers|solver_supplies),
                bounty_kobo ★, status ★(draft|escrow_pending|open|claimed|
                  in_progress|submitted|signed_off|disputed|released|refunded|cancelled),
                matching_strategy(default 'fixed_price'  SEAM: matching),
                created_at, published_at
Criterion       id, gig_id, order_index, text, locked ★(true at publish, immutable),
                verification_strategy(default 'payer_signoff'  SEAM: verification),
                proof_url(nullable), met(nullable)
Claim           id, gig_id, solver_id, staked(bool), status, claimed_at
EscrowRecord ★  id, gig_id(unique), provider(default 'monnify'  SEAM: payments),
                holding_account_ref, bounty_kobo, stake_kobo, stake_held,
                platform_fee_bps ★(config, not constant), fee_kobo, solver_payout_kobo,
                state ★(awaiting_funding|funded|stake_held|releasing|released|
                  refunded|dispute_hold), disbursement_ref(nullable), state_changed_at
Dispute         id, gig_id, raised_by, reason, neutral_id(nullable),
                ruling(nullable), penalty_kobo(nullable), status, created_at
LedgerEntry ★   id, gig_id, type(fund|stake|release|refund|fee|penalty|payout),
                amount_kobo, direction(in|out), provider_ref, event_id(unique ★),
                created_at   // APPEND ONLY — never update/delete
```

**Money-integrity rules (enforce, don't hope):**
- Money is **integer kobo**, never float.
- Balance-changing ops run **inside a DB transaction** — all-or-nothing.
- `LedgerEntry` is **append-only**; `event_id` unique → idempotency.
- `Criterion.locked` and `Gig.status` transitions enforced **server-side** against an allowed-transition map.
- Taxonomy (`submarket`, `payer_type`) are **FK to seed tables**, so growth = data.

---

## 5. Escrow state machine ★ — specified, not improvised

Assembled from Monnify primitives (Reserved Account = hold, Disbursement = release, `incomeSplitConfig` = auto-fee). Every transition writes a `LedgerEntry` and is **idempotent on `event_id`**.

```
PUBLISH        criteria lock · Gig=escrow_pending · Escrow=awaiting_funding
               Payments.createHoldingAccount(gig)
FUND           payer transfers bounty → Monnify webhook
               verifyWebhook (IP-allowlist + signature + amount/ref match)
               → Escrow=funded · Gig=open · Ledger(fund,in)      [mockup 06]
CLAIM+STAKE    solver stakes ~10% → held
               → stake_held · Gig=claimed→in_progress · Ledger(stake,in)  [mockup 09]
SUBMIT         proof per criterion · Gig=submitted · no money moves
SIGN-OFF (happy)  payer marks each criterion met
               → Escrow=releasing
               Payments.disburse(splits): solver 90% + Sorted fee 10%
               return stake to solver
               → released · Gig=released · Ledger(release,fee,payout,stake-return)  [10,11]
DISPUTE        either party → Escrow=dispute_hold · MONEY FROZEN
               neutral rules vs LOCKED criteria:
                 for_solver → release (as happy path)
                 for_payer  → refund payer; solver stake forfeit (penalty)
                 split      → partial per ruling
                 payer bad-faith withholding → penalty to payer; solver still paid
TIMEOUT        solver abandons/late → stake forfeit; reopen or refund payer (job-runner, §7)
```

**Webhook safety = the highest-correctness property in the app:** IP-allowlisted to Monnify, signature/hash verified, **idempotent** (store `event_id`, no-op on replay). A double-processed release = paying twice. Disbursement carries an idempotency key.

**Fee math** (₦85,000 gig, mockups): payer funds ₦85,000 · solver stakes ₦8,500 · sign-off → solver ₦76,500 + ₦8,500 stake back · Sorted ₦8,500. Floor: `max(bps×bounty, ₦300)`.

---

## 6. Design tokens (extracted from the mockups — use exactly)

```
--green-primary:#027A61  --green-deep:#007B5C  --green-bright:#04C29C
--green-mint-bg:#C8FFF6  --green-mint-pale:#D2FFFD
--bg-app:#F4FAF8  --surface:#FFFFFF  --border:#E0E6E4
--text-primary:#0C1F1B  --text-body:#3A4A47  --text-muted:#7E8F8D
```
Logo: mint rounded-square + primary-green check. Wordmark "SORTED", bold serif, caps. Tagline "Consider it sorted." Body: Inter/system sans. Match `/screens` 1:1.

---

## 7. Build order (Jude + Claude Code)

Model → module interface → API → screen, one working slice at a time. Money slices under close human review.

1. **Foundation** — repo, Nest modules skeleton (empty, boundaries defined), Prisma schema (§4), Postgres, Monnify env scaffolding. *No logic.*
2. **Identity** — phone+OTP, roles. (Safe first slice.)
3. **Gigs + intake seam** — post-a-gig (mockups 02–05), criteria lock, `source` field, taxonomy seed tables. Matching = `FixedPriceAccept` behind the interface.
4. **Payments module + Escrow funding** ★ — Monnify behind `PaymentsProvider`; §5 PUBLISH→FUND with full webhook safety; escrow-locked screen (06). **First money slice — supervise.**
5. **Market/browse** — mockup 07 (Physical/Digital, submarket+payer filters), gig detail (08).
6. **Claim + stake + work** ★ — §5 CLAIM/SUBMIT; solver checklist + proof upload (09).
7. **Sign-off + release** ★ — §5 SIGN-OFF; disburse w/ split; complete (11); reputation +1. **Supervise.**
8. **Disputes** — freeze (real) + neutral assignment + ruling. Thin is OK; **freeze is not optional.**
9. **KYC gate** — Monnify BVN/NIN gating payouts.
10. **Job-runner** — the one scheduled worker: timeout/abandonment sweeps. (Node cron in-process is fine at v1 scale; no external queue.)

---

## 8. What the future plugs into (so Jude builds the seams knowingly)

| Known future | Plugs into (seam) | Why no rewrite |
|---|---|---|
| Reverse auction, then dynamic/signal pricing | `MatchingStrategy` (3.3) | pricing/assignment isolated in one module |
| Signal / sensor / institutional problem detection | `GigIntake` + `source` (3.2) | rest of system treats all gigs identically regardless of origin |
| Recurring contracts (cleaning, retainers) | `GigTemplate.template_id` (3.2/4) | generate instances from template; schema already allows it |
| Corporate / NGO / **government-procurement** funding | `PaymentsProvider` (3.4) | Monnify is one impl; new funding flow is another |
| Richer verification (tamper-evident, inspection, automated) | `VerificationStrategy` (3.6) | "how done is proven" swappable per gig type |
| Full neutral panel + internal appeal tier | Disputes interface (3.7) | freeze/ruling contract stable; process deepens behind it |
| **Secondary market** in verified outcomes | Ledger + gig-ownership (3.8) | immutable positions already modelled; trading is additive |
| New cities / currencies | config + taxonomy tables (4) | Lagos/NGN are data, never hardcoded constants |
| Web app, more notification channels | Notifications (3.9) + shared API | mobile & web consume the same module interfaces |

**None of these are built in v1.** They are the reason the boundaries in §3 exist. If Claude Code proposes collapsing a seam "to move faster," that's the one kind of speed-up to refuse — the seams are the deliverable as much as the screens are.

---

## 9. Non-negotiable checklist (money app)

- [ ] Money in integer kobo; no floats anywhere.
- [ ] All balance changes inside DB transactions.
- [ ] LedgerEntry append-only; `event_id` unique; idempotent.
- [ ] Monnify webhooks IP-allowlisted, signature-verified, idempotent.
- [ ] Criteria immutable post-publish (server-enforced).
- [ ] Gig.status via allowed-transition map (server-enforced).
- [ ] No release while `dispute_hold`.
- [ ] **Only the Payments module imports Monnify.** Nothing else.
- [ ] **Modules interact only via published interfaces** — no cross-module table access.
- [ ] Disbursement idempotency-keyed (double-release protection).
- [ ] Secrets in env; separate test/live keys.
- [ ] Money-path Claude Code sessions start read-only; diff reviewed before apply.

---

## 10. First Claude Code session prompt

> Read `HANDOFF.md`, `SPEC.md`, and `/screens`. Don't write code. Produce: (1) the NestJS module skeleton reflecting the nine modules in §3, each as an empty Nest module exposing only its documented interface; (2) the full Prisma schema from §4 including the seam fields; (3) a written plan for slices 1–3 in §7 with endpoints, module interfaces, and the screens they back. Stop for review. Do not implement any Payments/Escrow logic (§5) until I approve the plan. Treat the module boundaries in §3 as fixed — do not collapse them for speed.

---

*Source of truth: §3 (boundaries), §5 + §9 (money). If code contradicts these, they win. The MVP is small on purpose; the boundaries are big on purpose.*
