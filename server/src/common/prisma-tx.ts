import { Prisma } from '@prisma/client';

/**
 * Shared type for the handful of cross-module Port methods that need to
 * participate in a caller's transaction (HANDOFF.md §9: "all balance
 * changes inside DB transactions" — a money-moving flow that spans two
 * modules, e.g. Escrow confirming funding while also transitioning Gig
 * status and writing a LedgerEntry, must do all three atomically, not as
 * three separate round-trips). Optional and defaults to the module's own
 * PrismaService when omitted, so non-transactional callers are unaffected.
 *
 * This does leak a Prisma type into otherwise-Prisma-agnostic Port
 * interfaces (GigsPort.transitionStatus, LedgerPort.record) — a deliberate,
 * narrow exception, not a precedent for passing Prisma clients around
 * generally.
 */
export type PrismaTx = Prisma.TransactionClient;
