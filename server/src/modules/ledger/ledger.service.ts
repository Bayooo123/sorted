import { Injectable } from '@nestjs/common';
import { LedgerEntry } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaTx } from '../../common/prisma-tx';
import { addKobo, kobo, Kobo } from '../../common/money';
import { LedgerEntryInput, LedgerEntryView, LedgerPort } from './ledger.interface';

/**
 * Implemented alongside the manual-pilot funding flow (EscrowService).
 * record() is the only write, ever — no update/delete path exists here on
 * purpose (HANDOFF.md §3.8/§9: append-only). eventId's unique DB
 * constraint (prisma/schema.prisma) makes a replayed call a safe no-op via
 * upsert's update:{} branch, rather than a duplicate row or a thrown error
 * — matters for a real webhook retry later, and costs nothing to have now.
 */
@Injectable()
export class LedgerService implements LedgerPort {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: LedgerEntryInput, tx?: PrismaTx): Promise<LedgerEntryView> {
    const client = tx ?? this.prisma;
    const row = await client.ledgerEntry.upsert({
      where: { eventId: entry.eventId },
      create: {
        gigId: entry.gigId,
        type: entry.type,
        amountKobo: BigInt(entry.amountKobo),
        direction: entry.direction,
        providerRef: entry.providerRef,
        eventId: entry.eventId,
      },
      update: {}, // idempotent no-op on replay — append-only, never update
    });
    return this.toView(row);
  }

  async getGigLedger(gigId: string): Promise<LedgerEntryView[]> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { gigId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async getBalance(gigId: string): Promise<Kobo> {
    const rows = await this.prisma.ledgerEntry.findMany({ where: { gigId } });
    const amounts = rows.map((r) => kobo(r.direction === 'in' ? Number(r.amountKobo) : -Number(r.amountKobo)));
    return amounts.length > 0 ? addKobo(...amounts) : kobo(0);
  }

  private toView(row: LedgerEntry): LedgerEntryView {
    return {
      id: row.id,
      gigId: row.gigId,
      type: row.type as LedgerEntryView['type'],
      amountKobo: kobo(Number(row.amountKobo)),
      direction: row.direction as LedgerEntryView['direction'],
      providerRef: row.providerRef,
      eventId: row.eventId,
      createdAt: row.createdAt,
    };
  }
}
