/**
 * PLAN.md "Sorted-owned rider fleet" — Sorted's own courier workforce,
 * replacing (or running alongside, via DELIVERY_PROVIDER_KEY) KWIK for
 * submarkets that need a physical pickup/drop-off leg. See
 * delivery/delivery.interface.ts for the DeliveryProviderPort side of this
 * (SortedFleetDeliveryService) — this module owns everything a rider
 * themself does: going online, seeing jobs, and walking each job through
 * started -> arrived -> picked_up -> in_transit -> ended.
 */
export interface RiderJobView {
  id: string;
  leg: 'pickup_to_professional' | 'return_to_client';
  status: string;
  itemDescription: string;
  locationText: string;
  pieceCount: number | null;
}
