import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WHATSAPP_PORT, WhatsAppPort } from '../whatsapp/whatsapp.interface';
import { DeliveryTaskStatus } from '../delivery/delivery.interface';
import { comparePickupCode, generateSixDigitCode, hashPickupCode, PICKUP_CODE_TTL_MS } from '../delivery/pickup-code.util';
import { RiderJobView } from './rider.interface';

const PICKUP_CODE_MAX_ATTEMPTS = 5;
const ACTIVE_STATUSES: DeliveryTaskStatus[] = ['upcoming', 'started', 'arrived', 'picked_up', 'in_transit'];

/**
 * PLAN.md "Sorted-owned rider fleet". A rider walks each DeliveryTask
 * through: upcoming -> started (heading to the origin) -> arrived (at the
 * origin) -> picked_up (collected — code-verified for a pickup_to_professional
 * leg, since that's the client handoff; just counted for a return_to_client
 * leg, since that's the professional's shop) -> in_transit (heading to the
 * destination) -> ended (dropped off).
 *
 * Deliberately no DB-level compare-and-swap on these transitions (contrast
 * EscrowService's updateMany-based CAS on money moves) — a rider only ever
 * acts on their own job from their own device, so the race EscrowService
 * guards against doesn't really arise here. requireMyTask below is the only
 * check that matters: the job belongs to this rider.
 */
@Injectable()
export class RiderService {
  private readonly logger = new Logger(RiderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
  ) {}

  async becomeRider(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.roleFlags.includes('rider')) {
      await this.prisma.user.update({ where: { id: userId }, data: { roleFlags: { push: 'rider' } } });
    }
    await this.prisma.riderProfile.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  private async requireRiderProfile(userId: string) {
    const profile = await this.prisma.riderProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Register as a rider first.');
    return profile;
  }

  async setOnline(userId: string, online: boolean): Promise<{ online: boolean }> {
    await this.requireRiderProfile(userId);
    const updated = await this.prisma.riderProfile.update({ where: { userId }, data: { online } });
    if (online) {
      this.claimPendingWork(userId).catch((err) => {
        this.logger.warn(`claimPendingWork failed for rider ${userId}: ${err instanceof Error ? err.message : err}`);
      });
    }
    return { online: updated.online };
  }

  /**
   * SortedFleetDeliveryService.createTask leaves a task `unassigned` when no
   * rider was online at dispatch time. The first rider to come back online
   * claims the oldest pending one. Same "not addressed yet" caveat on
   * concurrent races as that class's own doc comment — v1 rider volume is
   * low enough that two riders simultaneously calling setOnline(true) and
   * racing for the same task is an accepted gap, caught by the updateMany
   * guard below (loser's count is 0 and it just does nothing) rather than
   * truly prevented.
   */
  private async claimPendingWork(riderId: string): Promise<void> {
    const task = await this.prisma.deliveryTask.findFirst({
      where: { provider: 'sorted_fleet', status: 'unassigned', riderId: null },
      orderBy: { createdAt: 'asc' },
      include: { gig: { select: { clientId: true, description: true } } },
    });
    if (!task) return;

    const claimed = await this.prisma.deliveryTask.updateMany({
      where: { id: task.id, riderId: null },
      data: { riderId, status: 'upcoming' },
    });
    if (claimed.count === 0) return; // another rider got it first

    if (task.leg === 'pickup_to_professional') {
      const code = generateSixDigitCode();
      const pickupCodeHash = await hashPickupCode(code);
      await this.prisma.deliveryTask.update({
        where: { id: task.id },
        data: { pickupCodeHash, pickupCodeExpiresAt: new Date(Date.now() + PICKUP_CODE_TTL_MS) },
      });
      const client = await this.prisma.user.findUnique({ where: { id: task.gig.clientId }, select: { phone: true } });
      if (client?.phone) {
        await this.whatsapp
          .sendMessage(client.phone, `Your Sorted pickup code is *${code}*. Give this to the rider when they arrive to collect your items.`)
          .catch((err) => this.logger.warn(`Pickup-code notification failed: ${err instanceof Error ? err.message : err}`));
      }
    }

    const rider = await this.prisma.user.findUnique({ where: { id: riderId }, select: { phone: true } });
    if (rider?.phone) {
      await this.whatsapp
        .sendMessage(rider.phone, `New Sorted delivery job 🛵 — open the rider app for pickup details ("${task.gig.description}").`)
        .catch((err) => this.logger.warn(`Rider job-offer notification failed: ${err instanceof Error ? err.message : err}`));
    }
  }

  async listMyJobs(userId: string): Promise<RiderJobView[]> {
    await this.requireRiderProfile(userId);
    const tasks = await this.prisma.deliveryTask.findMany({
      where: { riderId: userId, status: { in: ACTIVE_STATUSES } },
      include: { gig: { select: { description: true, locationText: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return tasks.map((t) => ({
      id: t.id,
      leg: t.leg,
      status: t.status,
      itemDescription: t.gig.description,
      locationText: t.gig.locationText,
      pieceCount: t.pieceCount,
    }));
  }

  private async requireMyTask(userId: string, taskId: string) {
    const task = await this.prisma.deliveryTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Job not found.');
    if (task.riderId !== userId) throw new ForbiddenException('Not your job.');
    return task;
  }

  private assertStatus(current: string, expected: string): void {
    if (current !== expected) throw new BadRequestException(`Job is "${current}", expected "${expected}".`);
  }

  async start(userId: string, taskId: string): Promise<void> {
    const task = await this.requireMyTask(userId, taskId);
    this.assertStatus(task.status, 'upcoming');
    await this.prisma.deliveryTask.update({ where: { id: taskId }, data: { status: 'started' } });
    if (task.leg === 'pickup_to_professional') {
      await this.notifyGigClient(task.gigId, '🛵 Your rider is on the way to pick up your clothes.');
    }
  }

  async arrive(userId: string, taskId: string): Promise<void> {
    const task = await this.requireMyTask(userId, taskId);
    this.assertStatus(task.status, 'started');
    await this.prisma.deliveryTask.update({ where: { id: taskId }, data: { status: 'arrived' } });
    if (task.leg === 'pickup_to_professional') {
      await this.notifyGigClient(task.gigId, '📍 Your rider has arrived. Please hand over your items and share your pickup code.');
    } else {
      await this.notifyGigProfessional(task.gigId, '📍 A Sorted rider has arrived to collect the cleaned items.');
    }
  }

  async confirmPickup(userId: string, taskId: string, pieceCount: number, code?: string): Promise<void> {
    const task = await this.requireMyTask(userId, taskId);
    this.assertStatus(task.status, 'arrived');

    if (task.leg === 'pickup_to_professional') {
      if (!task.pickupCodeHash) throw new BadRequestException('No pickup code on file for this job.');
      if (task.pickupCodeExpiresAt && task.pickupCodeExpiresAt < new Date()) throw new BadRequestException('Pickup code expired — contact support.');
      if (task.pickupCodeAttempts >= PICKUP_CODE_MAX_ATTEMPTS) throw new BadRequestException('Too many attempts — contact support.');

      const matches = code ? await comparePickupCode(code, task.pickupCodeHash) : false;
      if (!matches) {
        await this.prisma.deliveryTask.update({ where: { id: taskId }, data: { pickupCodeAttempts: { increment: 1 } } });
        throw new BadRequestException('Incorrect pickup code.');
      }
    }

    await this.prisma.deliveryTask.update({ where: { id: taskId }, data: { status: 'picked_up', pieceCount } });
  }

  async goInTransit(userId: string, taskId: string): Promise<void> {
    const task = await this.requireMyTask(userId, taskId);
    this.assertStatus(task.status, 'picked_up');
    await this.prisma.deliveryTask.update({ where: { id: taskId }, data: { status: 'in_transit' } });
    if (task.leg === 'pickup_to_professional') {
      await this.notifyGigProfessional(task.gigId, `🛵 Your rider is on the way to you now${task.pieceCount ? ` with ${task.pieceCount} item(s)` : ''}.`);
    } else {
      await this.notifyGigClient(task.gigId, '🚚 Your clothes are on the way back to you!');
    }
  }

  async complete(userId: string, taskId: string): Promise<void> {
    const task = await this.requireMyTask(userId, taskId);
    this.assertStatus(task.status, 'in_transit');
    await this.prisma.deliveryTask.update({ where: { id: taskId }, data: { status: 'ended' } });

    if (task.leg === 'pickup_to_professional') {
      // PLAN.md "Autonomous notification/order-status architecture" — the
      // dry cleaner's receipt IS this rider drop-off; the gig's bounty is
      // already the agreed price (flat-bounty model, set at gig creation),
      // so there's no separate invoicing step to wait on before telling
      // the client what they owe.
      await this.notifyPriceConfirmed(task.gigId);
    } else {
      await this.notifyGigClient(task.gigId, '✅ Delivered! Thanks for using Sorted.');
    }
  }

  private async notifyGigClient(gigId: string, text: string): Promise<void> {
    const gig = await this.prisma.gig.findUnique({ where: { id: gigId }, select: { client: { select: { phone: true } } } });
    if (!gig?.client.phone) return;
    await this.whatsapp.sendMessage(gig.client.phone, text).catch((err) => {
      this.logger.warn(`Client notification failed for gig ${gigId}: ${err instanceof Error ? err.message : err}`);
    });
  }

  private async notifyGigProfessional(gigId: string, text: string): Promise<void> {
    const claim = await this.prisma.claim.findFirst({ where: { gigId, status: 'active' }, select: { professional: { select: { phone: true } } } });
    if (!claim?.professional.phone) return;
    await this.whatsapp.sendMessage(claim.professional.phone, text).catch((err) => {
      this.logger.warn(`Professional notification failed for gig ${gigId}: ${err instanceof Error ? err.message : err}`);
    });
  }

  private async notifyPriceConfirmed(gigId: string): Promise<void> {
    const gig = await this.prisma.gig.findUnique({ where: { id: gigId }, select: { bountyKobo: true, client: { select: { phone: true } } } });
    if (!gig?.client.phone) return;
    const naira = (Number(gig.bountyKobo) / 100).toLocaleString('en-NG');
    await this.whatsapp
      .sendMessage(gig.client.phone, `🧺 Your items have arrived at the dry cleaner. Total: ₦${naira} — already covered by your order.`)
      .catch((err) => {
        this.logger.warn(`Price notification failed for gig ${gigId}: ${err instanceof Error ? err.message : err}`);
      });
  }
}
