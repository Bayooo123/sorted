/**
 * PLAN.md "KWIK delivery integration" — courier dispatch for gigs whose
 * work needs a physical pickup/drop-off leg (e.g. Laundry & Dry Cleaning:
 * clothes have to physically travel between the client and the
 * professional's shop). KWIK is the only implementation in v1, but this
 * port exists so a second courier provider is a new adapter, not a rewrite
 * of the two call sites (EscrowService.holdStake, GigsService.submitForReview).
 *
 * Every method is best-effort by design, matching the WhatsApp notification
 * hooks elsewhere in this codebase: a courier that can't be dispatched
 * (missing coordinates, provider unconfigured, provider error) must never
 * fail the real state change (a claim, a submission) it's attached to.
 * Callers get `null` back, not a thrown error, and are expected to log a
 * DeliveryTask row with a failureReason either way — see DeliveryService.
 */

export interface DeliveryLocation {
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
}

export type DeliveryLeg = 'pickup_to_professional' | 'return_to_client';

export interface CreateDeliveryTaskInput {
  leg: DeliveryLeg;
  pickup: DeliveryLocation;
  dropoff: DeliveryLocation;
  itemDescription: string;
}

export interface DeliveryTaskResult {
  providerJobId: string;
  trackingLink?: string;
  /**
   * PLAN.md "Sorted-owned rider fleet" — set only by SortedFleetDeliveryService,
   * when a rider was actually found and assigned at creation time. Null/unset
   * means either a non-rider provider (KWIK) or a sorted_fleet task left
   * `unassigned` for RiderService.setOnline's claim-pending-work step to pick
   * up later.
   */
  riderId?: string;
  /**
   * PLAN.md "Sorted-owned rider fleet" — the plaintext 6-digit pickup code,
   * ONLY for a pickup_to_professional leg assigned to a rider at creation.
   * DeliveryService hashes this before it's ever written to the DB (never
   * stored raw) and sends the plaintext to the client once, here.
   */
  pickupCode?: string;
  /**
   * Overrides DeliveryService.recordTask's default `providerJobId ? 'upcoming' : 'failed'`
   * status guess. SortedFleetDeliveryService uses this to record 'unassigned'
   * (task exists, no rider online yet) rather than 'failed' — KWIK leaves
   * this unset and keeps the old default.
   */
  status?: DeliveryTaskStatus;
}

/**
 * Mirrors KWIK's job_status values (see the "Task Statuses" table in their
 * API docs) under our own names, so nothing outside this module needs to
 * know KWIK's numeric codes. picked_up/in_transit are Sorted-fleet-only —
 * see this type's usage in schema.prisma's DeliveryTaskStatus enum doc
 * comment for why KWIK never produces either.
 */
export type DeliveryTaskStatus =
  | 'upcoming'
  | 'started'
  | 'arrived'
  | 'picked_up'
  | 'in_transit'
  | 'ended'
  | 'failed'
  | 'unassigned'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'deleted';

export interface DeliveryProviderPort {
  /** "kwik" or "sorted_fleet" — see DeliveryService.recordTask, which stamps DeliveryTask.provider with this. */
  readonly providerKey: string;
  /** Returns null (never throws) if the task couldn't be created — see this file's top comment. */
  createTask(input: CreateDeliveryTaskInput): Promise<DeliveryTaskResult | null>;
  /** Returns null if the status can't be fetched right now. */
  getTaskStatus(providerJobId: string): Promise<DeliveryTaskStatus | null>;
}

export const DELIVERY_PROVIDER_PORT = 'DELIVERY_PROVIDER_PORT';
