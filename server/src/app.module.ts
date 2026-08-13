import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { IdentityModule } from './modules/identity/identity.module';
import { GigsModule } from './modules/gigs/gigs.module';
import { MatchingModule } from './modules/matching/matching.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { EscrowModule } from './modules/escrow/escrow.module';
import { VerificationModule } from './modules/verification/verification.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { ReputationNotificationsModule } from './modules/reputation-notifications/reputation-notifications.module';

/**
 * Composition root. The nine modules below correspond 1:1 to HANDOFF.md §3.
 * Import order here is documentation order, not a dependency order — modules
 * depend on each other only through the interfaces each module exports, never
 * by importing another module's internals or touching its Prisma tables.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    IdentityModule,
    GigsModule,
    MatchingModule,
    PaymentsModule,
    EscrowModule,
    VerificationModule,
    DisputesModule,
    LedgerModule,
    ReputationNotificationsModule,
  ],
})
export class AppModule {}
