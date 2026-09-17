import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DELIVERY_PROVIDER_PORT, DeliveryLeg, DeliveryLocation, DeliveryProviderPort } from './delivery.interface';

/**
 * PLAN.md "KWIK delivery integration" — the only submarket that needs a
 * courier leg in v1. A plain string check, not a schema flag, since this
 * is a product decision about which trades need physical transport, not
 * a structural property of Submarket — same reasoning as the taxonomy
 * seed data itself being plain rows rather than hardcoded categories.
 */
const DELIVERY_ELIGIBLE_SUBMARKET_KEY = 'laundry-dry-cleaning';

/**
 * Orchestrates courier dispatch for a gig. Deliberately resolves
 * everything itself from `gigId`/`clientId`/`professionalId` via Prisma
 * directly, rather than making EscrowService/GigsService assemble
 * location data — this module has no dependency on GigsModule or
 * IdentityModule, so it stays a clean leaf (same shape as
 * WhatsappModule/PaymentsModule) and the call sites stay a single line,
 * matching the existing best-effort notification hooks in this codebase
 * (see EscrowService.notifyProfessionalOfCompletion for the pattern this
 * follows: fire-and-forget, catch-and-log, never fail the real
 * transaction it's attached to).
 *
 * Always leaves a DeliveryTask row behind, including a failureReason when
 * dispatch couldn't happen, so a missing delivery is visible in the data
 * rather than a silent gap.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DELIVERY_PROVIDER_PORT) private readonly provider: DeliveryProviderPort,
  ) {}

  static isDeliveryEligible(submarketKey: string): boolean {
    return submarketKey === DELIVERY_ELIGIBLE_SUBMARKET_KEY;
  }

  /** Client's dirty laundry -> professional's shop. Call once a claim is accepted (EscrowService.holdStake). */
  async dispatchPickupLeg(gigId: string, clientId: string, professionalId: string): Promise<void> {
    await this.dispatch(gigId, clientId, professionalId, 'pickup_to_professional');
  }

  /** Professional's shop -> client. Call once the professional submits proof of completed work (GigsService.submitForReview). */
  async dispatchReturnLeg(gigId: string, clientId: string, professionalId: string): Promise<void> {
    await this.dispatch(gigId, clientId, professionalId, 'return_to_client');
  }

  private async dispatch(gigId: string, clientId: string, professionalId: string, leg: DeliveryLeg): Promise<void> {
    const gig = await this.prisma.gig.findUniqueOrThrow({
      where: { id: gigId },
      select: { description: true, locationText: true, locationGeoLat: true, locationGeoLng: true, submarket: { select: { key: true } } },
    });
    if (!DeliveryService.isDeliveryEligible(gig.submarket.key)) return;

    const [client, professional] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, phone: true } }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: professionalId },
        select: { name: true, phone: true, professionalAddressText: true, professionalAddressLat: true, professionalAddressLng: true },
      }),
    ]);

    const clientLocation: DeliveryLocation | null =
      gig.locationGeoLat != null && gig.locationGeoLng != null && client.phone
        ? { name: client.name ?? 'Client', phone: client.phone, address: gig.locationText, lat: gig.locationGeoLat, lng: gig.locationGeoLng }
        : null;

    const professionalLocation: DeliveryLocation | null =
      professional.professionalAddressLat != null && professional.professionalAddressLng != null && professional.phone && professional.professionalAddressText
        ? {
            name: professional.name ?? 'Professional',
            phone: professional.phone,
            address: professional.professionalAddressText,
            lat: professional.professionalAddressLat,
            lng: professional.professionalAddressLng,
          }
        : null;

    if (!clientLocation || !professionalLocation) {
      const reason = !clientLocation
        ? 'client location has no geocoded coordinates or phone — WhatsApp-originated gigs commonly lack this, see PLAN.md'
        : "professional has no registered shop address/coordinates — they haven't set professionalAddressText/Lat/Lng yet";
      this.logger.warn(`Skipping KWIK dispatch for gig ${gigId} (${leg}): ${reason}`);
      await this.recordTask(gigId, leg, null, reason);
      return;
    }

    const [pickup, dropoff] = leg === 'pickup_to_professional' ? [clientLocation, professionalLocation] : [professionalLocation, clientLocation];

    const result = await this.provider.createTask({ leg, pickup, dropoff, itemDescription: gig.description });
    if (!result) {
      await this.recordTask(gigId, leg, null, 'KWIK dispatch failed or provider not configured — see server logs');
      return;
    }

    await this.recordTask(gigId, leg, result.providerJobId, null, result.trackingLink);
  }

  private async recordTask(
    gigId: string,
    leg: DeliveryLeg,
    providerJobId: string | null,
    failureReason: string | null,
    trackingLink?: string,
  ): Promise<void> {
    await this.prisma.deliveryTask.create({
      data: {
        gigId,
        leg,
        providerJobId,
        failureReason,
        trackingLink,
        status: providerJobId ? 'upcoming' : 'failed',
      },
    });
  }
}
