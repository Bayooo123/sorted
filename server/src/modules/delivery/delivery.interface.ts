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
}

/**
 * Mirrors KWIK's job_status values (see the "Task Statuses" table in their
 * API docs) under our own names, so nothing outside this module needs to
 * know KWIK's numeric codes.
 */
export type DeliveryTaskStatus =
  | 'upcoming'
  | 'started'
  | 'arrived'
  | 'ended'
  | 'failed'
  | 'unassigned'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'deleted';

export interface DeliveryProviderPort {
  /** Returns null (never throws) if the task couldn't be created — see this file's top comment. */
  createTask(input: CreateDeliveryTaskInput): Promise<DeliveryTaskResult | null>;
  /** Returns null if the status can't be fetched right now. */
  getTaskStatus(providerJobId: string): Promise<DeliveryTaskStatus | null>;
}

export const DELIVERY_PROVIDER_PORT = 'DELIVERY_PROVIDER_PORT';
