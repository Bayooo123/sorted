import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WHATSAPP_PORT, WhatsAppPort } from '../whatsapp/whatsapp.interface';
import { CreateDeliveryTaskInput, DeliveryProviderPort, DeliveryTaskResult, DeliveryTaskStatus } from './delivery.interface';
import { generateSixDigitCode } from './pickup-code.util';

const ACTIVE_RIDER_TASK_STATUSES: DeliveryTaskStatus[] = ['upcoming', 'started', 'arrived', 'picked_up', 'in_transit'];

/**
 * PLAN.md "Sorted-owned rider fleet" — DeliveryProviderPort implementation
 * backed by Sorted's own RiderProfile roster instead of KWIK. Active only
 * when DELIVERY_PROVIDER_KEY=sorted_fleet (see delivery.module.ts); DeliveryService
 * calls this exactly the same way it calls KwikDeliveryService, so the two
 * call sites (EscrowService.holdStake, GigsService.submitForReview) never
 * change regardless of which provider is live.
 *
 * "Available" in v1 means online=true with zero currently-active
 * DeliveryTasks — there is no GPS/location tracking for riders yet, so
 * assignment is a simple longest-idle-first round robin, not nearest-rider.
 * A genuinely concurrent-safe claim (two dispatches racing for the same
 * rider) isn't addressed here either — v1 rider volume is low enough that
 * this is an accepted gap, not a design decision; see RiderService's own
 * doc comment on the same tradeoff for setOnline's claim-pending-work step.
 */
@Injectable()
export class SortedFleetDeliveryService implements DeliveryProviderPort {
  private readonly logger = new Logger(SortedFleetDeliveryService.name);
  readonly providerKey = 'sorted_fleet';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
  ) {}

  async createTask(input: CreateDeliveryTaskInput): Promise<DeliveryTaskResult | null> {
    const providerJobId = `rider_job_${randomUUID()}`;
    const rider = await this.findAvailableRider();

    if (!rider) {
      this.logger.warn(`No online rider available for a ${input.leg} job right now — recording unassigned`);
      return { providerJobId, status: 'unassigned' };
    }

    await this.prisma.riderProfile.update({ where: { userId: rider.userId }, data: { updatedAt: new Date() } });
    await this.notifyRiderOfNewJob(rider.phone, input);

    const result: DeliveryTaskResult = { providerJobId, riderId: rider.userId, status: 'upcoming' };
    if (input.leg === 'pickup_to_professional') {
      result.pickupCode = generateSixDigitCode();
    }
    return result;
  }

  /** No live tracking link for an in-house rider (no third-party map/webhook to point at) — v1 has none. */
  async getTaskStatus(): Promise<DeliveryTaskStatus | null> {
    return null;
  }

  private async findAvailableRider(): Promise<{ userId: string; phone: string | null } | null> {
    const candidate = await this.prisma.riderProfile.findFirst({
      where: { online: true, user: { riderDeliveryTasks: { none: { status: { in: ACTIVE_RIDER_TASK_STATUSES } } } } },
      orderBy: { updatedAt: 'asc' },
      select: { userId: true, user: { select: { phone: true } } },
    });
    return candidate ? { userId: candidate.userId, phone: candidate.user.phone } : null;
  }

  private async notifyRiderOfNewJob(phone: string | null, input: CreateDeliveryTaskInput): Promise<void> {
    if (!phone) return;
    const text = `New Sorted delivery job 🛵\nPick up: ${input.pickup.name}, ${input.pickup.address} (${input.pickup.phone})\nDrop off: ${input.dropoff.name}, ${input.dropoff.address}\nOpen the Sorted rider app to get started.`;
    try {
      const sessionOpen = await this.whatsapp.isSessionOpen(phone);
      if (sessionOpen) {
        await this.whatsapp.sendMessage(phone, text);
      } else {
        const sent = await this.whatsapp.sendTemplate(phone, 'sorted_rider_new_job', 'en', [input.pickup.name, input.pickup.address, input.dropoff.name]);
        if (!sent) this.logger.warn(`Could not reach rider ${phone} outside the WhatsApp session window — sorted_rider_new_job template missing/unapproved`);
      }
    } catch (err) {
      this.logger.warn(`Rider job-offer notification failed for ${phone}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
